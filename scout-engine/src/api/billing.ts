// scout-engine/src/api/billing.ts
// Checkout and billing portal session creation. Price ids come from the
// Stripe source of truth (.access/.stripe-credentials-and-price-id.md) via env vars;
// this file never creates or hardcodes new Stripe prices.
import { Router, type Router as ExpressRouter } from 'express';
import Stripe from 'stripe';
import { db } from '../db/index.js';
import { stripePriceIdForPlan } from '../lib/plans.js';
import { dashboardAuthMiddleware, type DashboardRequest } from './middleware/dashboard-auth.js';

export const billingRouter: ExpressRouter = Router();

const VALID_PAID_PLANS = new Set(['monitor', 'govern', 'team']);

function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

function dashboardUrl(): string {
  return process.env.SCOUT_DASHBOARD_URL || 'http://localhost:3000';
}

billingRouter.use(dashboardAuthMiddleware);

billingRouter.post('/checkout', async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      res.status(500).json({ error: 'internal', message: 'Stripe is not configured on this server.' });
      return;
    }

    const organizationId = (req as DashboardRequest).organizationId!;
    const { plan, success_url, cancel_url } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof plan !== 'string' || !VALID_PAID_PLANS.has(plan)) {
      res.status(400).json({ error: 'internal', message: 'plan must be one of monitor, govern, team.' });
      return;
    }

    const priceId = stripePriceIdForPlan(plan);
    if (!priceId) {
      res.status(500).json({ error: 'internal', message: `No Stripe price configured for plan ${plan}.` });
      return;
    }

    const organization = await db('organizations').where({ id: organizationId }).first();
    if (!organization) {
      res.status(404).json({ error: 'not_found', message: 'Organization not found.' });
      return;
    }

    let customerId: string | null = organization.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: organization.name,
        metadata: { organization_id: organizationId },
      });
      customerId = customer.id;
      await db('organizations')
        .where({ id: organizationId })
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: (typeof success_url === 'string' && success_url) || `${dashboardUrl()}/dashboard/settings?checkout=success`,
      cancel_url: (typeof cancel_url === 'string' && cancel_url) || `${dashboardUrl()}/dashboard/settings?checkout=cancelled`,
      metadata: { organization_id: organizationId, plan },
      subscription_data: { metadata: { organization_id: organizationId, plan } },
    });

    res.json({ url: session.url, id: session.id });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

billingRouter.get('/portal', async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      res.status(500).json({ error: 'internal', message: 'Stripe is not configured on this server.' });
      return;
    }

    const organizationId = (req as DashboardRequest).organizationId!;
    const organization = await db('organizations').where({ id: organizationId }).first();
    if (!organization?.stripe_customer_id) {
      res.status(400).json({ error: 'internal', message: 'No Stripe customer on file for this organization yet.' });
      return;
    }

    const returnUrl = (req.query.return_url as string) || `${dashboardUrl()}/dashboard/settings`;
    const session = await stripe.billingPortal.sessions.create({
      customer: organization.stripe_customer_id,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});
