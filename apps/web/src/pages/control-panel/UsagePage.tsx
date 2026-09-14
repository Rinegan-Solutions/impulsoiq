import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { agentRunsApi } from '@/api/client';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';

function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Math.round(n * 1000) / 10}%`;
}

export default function UsagePage() {
  const [usage, setUsage] = useState<{ period: string | null; items: { resource: unknown; used: number; quota: number }[]; error?: string } | null>(null);
  const [quality, setQuality] = useState<{
    consentBlocks: number; bounces: number; calls: number; answered: number;
    connectRate: number | null; schemaValidationPassRate: number | null; schemaFailures: number;
  } | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; runs: number; emails: number; calls: number; bounces?: number; consentBlocks?: number; callSeconds?: number }[]>([]);

  useEffect(() => {
    void agentRunsApi.usage().then(setUsage).catch(() => setUsage(null));
    void agentRunsApi.quality().then(setQuality).catch(() => setQuality(null));
    void agentRunsApi.campaignUsage().then(setCampaigns).catch(() => setCampaigns([]));
  }, []);

  return (
    <AppShell>
      <SEO title="Usage — ImpulsoIQ" description="Metering and deliverability for this workspace" />
      <div className="px-4 sm:px-6 py-6 max-w-3xl">
        <h1 className="text-[1.25rem] font-extrabold text-slate-900 dark:text-white">Usage</h1>
        <p className="text-[0.82rem] text-slate-500 mt-1 mb-5">
          {usage?.period ? `Period ${usage.period}` : 'Current metering window'} · send pause and consent blocks belong here, not invented KPIs.
        </p>
        {usage?.error && <p className="text-amber-700 text-sm">{usage.error}</p>}

        {quality && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] px-3 py-3">
              <p className="text-[0.65rem] uppercase text-slate-400 font-bold">Consent blocks</p>
              <p className="text-[1.1rem] font-extrabold tabular-nums">{quality.consentBlocks}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] px-3 py-3">
              <p className="text-[0.65rem] uppercase text-slate-400 font-bold">Bounces</p>
              <p className="text-[1.1rem] font-extrabold tabular-nums">{quality.bounces}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] px-3 py-3">
              <p className="text-[0.65rem] uppercase text-slate-400 font-bold">Connect rate</p>
              <p className="text-[1.1rem] font-extrabold tabular-nums">{pct(quality.connectRate)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] px-3 py-3">
              <p className="text-[0.65rem] uppercase text-slate-400 font-bold">Call schema pass</p>
              <p className="text-[1.1rem] font-extrabold tabular-nums">{pct(quality.schemaValidationPassRate)}</p>
            </div>
          </div>
        )}

        <h2 className="text-[0.9rem] font-bold mb-2">Metered resources</h2>
        {usage && usage.items.length === 0 && !usage.error && (
          <p className="text-[0.84rem] text-slate-400 mb-4">No usage rows yet. Counts appear after billed actions.</p>
        )}
        <ul className="space-y-2 mb-8">
          {usage?.items.map((item) => (
            <li key={String(item.resource)} className="flex justify-between rounded-xl border border-slate-200 dark:border-white/[0.08] px-4 py-3 text-sm">
              <span className="font-semibold text-slate-800 dark:text-slate-100">{String(item.resource)}</span>
              <span className="tabular-nums text-slate-500">{item.used} / {item.quota || '—'}</span>
            </li>
          ))}
        </ul>

        <h2 className="text-[0.9rem] font-bold mb-2">Per campaign</h2>
        {campaigns.length === 0 && <p className="text-[0.84rem] text-slate-400">No campaigns yet.</p>}
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li key={c.id} className="rounded-xl border border-slate-200 dark:border-white/[0.08] px-4 py-3 text-sm flex justify-between gap-3">
              <Link to={`/control-panel?campaign=${c.id}`} className="font-semibold text-indigo-600 hover:underline">{c.name}</Link>
              <span className="text-slate-500 tabular-nums">
                {c.runs} runs · {c.emails} emails · {c.calls} calls
                {c.callSeconds ? ` · ${Math.ceil(c.callSeconds / 60)} min` : ''}
                {c.bounces ? ` · ${c.bounces} bounces` : ''}
                {c.consentBlocks ? ` · ${c.consentBlocks} consent blocks` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
