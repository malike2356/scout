'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PLANS } from '@/lib/plans';
import { TopBar } from '@/components/TopBar';
import { ErrorState, LoadingState } from '@/components/LoadingAndError';
import type { AlertSettings } from '@/lib/types';

export default function SettingsPage() {
  const { organization, refreshOrg } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [channelsBusy, setChannelsBusy] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [channelSettings, setChannelSettings] = useState<AlertSettings>({
    alert_email: '',
    telegram_chat_id: '',
    slack_webhook_url: '',
  });

  async function load() {
    setLoading(true);
    setError(null);
    setSaveNotice(null);
    try {
      await refreshOrg();
      const settings = await api.alertSettings();
      setChannelSettings({
        alert_email: settings.alert_email ?? '',
        telegram_chat_id: settings.telegram_chat_id ?? '',
        slack_webhook_url: settings.slack_webhook_url ?? '',
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load organization');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpgrade(plan: string) {
    setBusyPlan(plan);
    setError(null);
    try {
      const res = await api.checkout({
        plan,
        success_url: `${window.location.origin}/dashboard/settings?checkout=success`,
        cancel_url: `${window.location.origin}/dashboard/settings?checkout=cancelled`,
      });
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start checkout');
    } finally {
      setBusyPlan(null);
    }
  }

  async function handlePortal() {
    setPortalBusy(true);
    setError(null);
    try {
      const res = await api.billingPortal();
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open billing portal');
    } finally {
      setPortalBusy(false);
    }
  }

  async function handleSaveChannels() {
    setChannelsBusy(true);
    setError(null);
    setSaveNotice(null);
    try {
      const res = await api.updateAlertSettings(channelSettings);
      const saved = res.settings ?? res.alert_settings ?? channelSettings;
      setChannelSettings({
        alert_email: saved.alert_email ?? '',
        telegram_chat_id: saved.telegram_chat_id ?? '',
        slack_webhook_url: saved.slack_webhook_url ?? '',
      });
      setSaveNotice('Trusted operator channels saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save trusted operator channels');
    } finally {
      setChannelsBusy(false);
    }
  }

  const currentPlan = organization?.plan ?? 'free';
  const telegramLinked = Boolean(channelSettings.telegram_chat_id);
  const emailLinked = Boolean(channelSettings.alert_email);
  const slackLinked = Boolean(channelSettings.slack_webhook_url);

  return (
    <>
      <TopBar title="Settings" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? <LoadingState label="Loading settings" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading ? (
          <div className="flex flex-col gap-6">
            <div className="panel px-5 py-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Organization</h2>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-faint">Name</dt>
                  <dd className="text-ink">{organization?.name ?? '--'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-faint">Current plan</dt>
                  <dd className="capitalize text-ink">{currentPlan}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-faint">Subscription status</dt>
                  <dd className="capitalize text-ink">{organization?.subscription_status ?? 'inactive'}</dd>
                </div>
              </dl>
            </div>

            <div className="panel px-5 py-4">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Trusted operator channels</h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    Link the channels your operators already use so alerts and emergency control stay
                    in one place.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSaveChannels}
                  disabled={channelsBusy}
                  className="rounded-sm bg-accent px-3 py-1.5 text-sm font-semibold text-base transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {channelsBusy ? 'Saving...' : 'Save channels'}
                </button>
              </div>

              {saveNotice ? (
                <div className="mb-4 rounded-sm border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-ink">
                  {saveNotice}
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-3">
                <ChannelSummary
                  label="Email alerts"
                  detail={channelSettings.alert_email || 'Not linked'}
                  linked={emailLinked}
                />
                <ChannelSummary
                  label="Telegram"
                  detail={channelSettings.telegram_chat_id || 'Not linked'}
                  linked={telegramLinked}
                />
                <ChannelSummary
                  label="Slack"
                  detail={channelSettings.slack_webhook_url || 'Not linked'}
                  linked={slackLinked}
                />
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <Field
                  label="Alert email"
                  value={channelSettings.alert_email}
                  onChange={(value) => setChannelSettings((prev) => ({ ...prev, alert_email: value }))}
                  placeholder="ops@example.com"
                  hint="Used for digest and fallback alert delivery."
                />
                <Field
                  label="Telegram chat ID"
                  value={channelSettings.telegram_chat_id}
                  onChange={(value) =>
                    setChannelSettings((prev) => ({ ...prev, telegram_chat_id: value }))
                  }
                  placeholder="123456789"
                  hint="Paste the operator chat or group ID linked to Scout."
                />
                <Field
                  label="Slack webhook URL"
                  value={channelSettings.slack_webhook_url}
                  onChange={(value) =>
                    setChannelSettings((prev) => ({ ...prev, slack_webhook_url: value }))
                  }
                  placeholder="https://hooks.slack.com/services/..."
                  hint="Optional; used when Slack is part of the operator loop."
                />
              </div>

              <p className="mt-3 text-xs text-ink-muted">
                WhatsApp operator linking is not exposed in this dashboard build yet.
              </p>
            </div>

            <div className="panel px-5 py-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Plans</h2>
                <button
                  type="button"
                  onClick={handlePortal}
                  disabled={portalBusy}
                  className="rounded-sm border border-base-border px-3 py-1.5 text-sm text-ink-muted hover:border-accent/50 hover:text-accent disabled:opacity-50"
                >
                  {portalBusy ? 'Opening...' : 'Manage billing'}
                </button>
              </div>

              <div className="grid grid-cols-4 gap-4">
                {PLANS.map((plan) => {
                  const isCurrent = plan.id === currentPlan;
                  return (
                    <div
                      key={plan.id}
                      className={`flex flex-col gap-3 rounded-md border px-4 py-4 ${
                        isCurrent ? 'border-accent/50 bg-accent-soft' : 'border-base-border bg-base-panel2'
                      }`}
                    >
                      <div>
                        <h3 className="text-sm font-semibold text-ink">{plan.name}</h3>
                        <p className="text-lg font-semibold text-ink">{plan.price}</p>
                        <p className="mt-1 text-xs text-ink-muted">{plan.tagline}</p>
                      </div>
                      <ul className="flex flex-col gap-1 text-xs text-ink-muted">
                        {plan.features.map((feature) => (
                          <li key={feature}>- {feature}</li>
                        ))}
                      </ul>
                      {plan.id === 'free' ? (
                        <span className="mt-auto rounded-sm border border-base-border px-3 py-1.5 text-center text-xs text-ink-faint">
                          Default plan
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={isCurrent || busyPlan === plan.id}
                          onClick={() => handleUpgrade(plan.id)}
                          className="mt-auto rounded-sm bg-accent px-3 py-1.5 text-xs font-semibold text-base transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isCurrent
                            ? 'Current plan'
                            : busyPlan === plan.id
                              ? 'Redirecting...'
                              : `Upgrade to ${plan.name}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}

function ChannelSummary({
  label,
  detail,
  linked,
}: {
  label: string;
  detail: string;
  linked: boolean;
}) {
  return (
    <div className="rounded-md border border-base-border bg-base-panel2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{label}</h3>
        <span
          className={`rounded-sm px-2 py-0.5 text-[11px] uppercase tracking-wide ${
            linked
              ? 'border border-accent/30 bg-accent-soft text-accent'
              : 'border border-base-border text-ink-muted'
          }`}
        >
          {linked ? 'Linked' : 'Not linked'}
        </span>
      </div>
      <p className="mt-2 break-all text-xs text-ink-muted">{detail}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-base-border bg-base-panel px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent/50"
      />
      <span className="text-xs text-ink-muted">{hint}</span>
    </label>
  );
}
