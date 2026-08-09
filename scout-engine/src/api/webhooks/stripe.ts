// scout-engine/src/api/webhooks/stripe.ts
// Stripe webhook handler. Must be mounted with express.raw({ type: 'application/json' })
// so the raw body is available for signature verification; never JSON-parse this route.
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { db } from '../../db/index.js';
import type { PlanName } from '../../lib/plans.js';

function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

function planFromPriceId(priceId: string | null | undefined): PlanName | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_MONITOR_PRICE_ID) return 'monitor';
  if (priceId === process.env.STRIPE_GOVERN_PRICE_ID) return 'govern';
  if (priceId === process.env.STRIPE_TEAM_PRICE_ID) return 'team';
  return null;
}

export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    res.status(500).json({ error: 'internal', message: 'Stripe webhook is not configured on this server.' });
    return;
  }

  const signature = req.headers['stripe-signature'];
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature as string, webhookSecret);
  } catch (err) {
    res.status(400).json({
      error: 'internal',
      message: `Webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const organizationId = session.metadata?.organization_id;
        const plan = session.metadata?.plan as PlanName | undefined;
        if (organizationId) {
          const subscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null;
          const customerId = typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id ?? null;

          const updates: Record<string, unknown> = {
            subscription_status: 'active',
            updated_at: new Date().toISOString(),
          };
          if (plan) updates.plan = plan;
          if (subscriptionId) updates.stripe_subscription_id = subscriptionId;
          if (customerId) updates.stripe_customer_id = customerId;

          await db('organizations').where({ id: organizationId }).update(updates);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const organizationId = subscription.metadata?.organization_id;
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = planFromPriceId(priceId);
        const status = subscription.status === 'active' || subscription.status === 'trialing'
          ? 'active'
          : subscription.status;

        const updates: Record<string, unknown> = { subscription_status: status, updated_at: new Date().toISOString() };
        if (plan) updates.plan = plan;

        if (organizationId) {
          await db('organizations').where({ id: organizationId }).update(updates);
        } else {
          await db('organizations').where({ stripe_subscription_id: subscription.id }).update(updates);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const organizationId = subscription.metadata?.organization_id;
        const updates = { plan: 'free', subscription_status: 'canceled', updated_at: new Date().toISOString() };

        if (organizationId) {
          await db('organizations').where({ id: organizationId }).update(updates);
        } else {
          await db('organizations').where({ stripe_subscription_id: subscription.id }).update(updates);
        }
        break;
      }

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
}
