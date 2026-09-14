import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { insightsApi } from '@/api/client';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';

type ChannelRow = { type: string; total: number; agent: number; human: number };
type OutcomeRow = { outcome?: string | null; n: number };
type Efficacy = {
  channels: ChannelRow[];
  callOutcomes: OutcomeRow[];
  omitted: string[];
  omittedReason: string;
};

export default function AnalyticsPage() {
  const [data, setData] = useState<Efficacy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    insightsApi.channelEfficacy()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load analytics'))
      .finally(() => setLoading(false));
  }, []);

  const max = Math.max(1, ...(data?.channels.map((c) => c.total) ?? [0]));

  return (
    <AppShell>
      <SEO title="Analytics — ImpulsoIQ" description="Channel counts from activity and call outcomes" />
      <div className="px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Analytics</h1>
          <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">
            Counts from <code className="text-[0.75rem]">activity</code> and <code className="text-[0.75rem]">call_result</code>. Email open and reply rates are not shown — the schema has no event for them.
          </p>
        </div>

        {loading && (
          <p className="text-[0.84rem] text-slate-400">Loading channel counts…</p>
        )}
        {error && (
          <p className="text-[0.84rem] text-amber-700 dark:text-amber-300">{error}</p>
        )}

        {!loading && !error && data && data.channels.length === 0 && data.callOutcomes.length === 0 && (
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-12 text-center">
            <TrendingUp className="mx-auto mb-4 text-slate-300 dark:text-slate-700" size={32} />
            <p className="text-[0.95rem] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              No outbound activity yet
            </p>
            <p className="text-[0.84rem] text-slate-400 dark:text-slate-600 max-w-md mx-auto">
              Email, SMS, and call counts appear after agents or humans write activities. Call outcomes appear after CALL-E results land.
            </p>
          </div>
        )}

        {data && (data.channels.length > 0 || data.callOutcomes.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5">
              <h2 className="text-[0.9rem] font-bold text-slate-900 dark:text-white mb-4">Channel volume</h2>
              <div className="space-y-3">
                {data.channels.map((c) => (
                  <div key={c.type}>
                    <div className="flex justify-between text-[0.78rem] mb-1">
                      <span className="font-semibold capitalize text-slate-700 dark:text-slate-300">{c.type}</span>
                      <span className="tabular-nums text-slate-500">{c.total} · agent {c.agent} · human {c.human}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(c.total / max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5">
              <h2 className="text-[0.9rem] font-bold text-slate-900 dark:text-white mb-4">Call outcomes</h2>
              {data.callOutcomes.length === 0 ? (
                <p className="text-[0.8rem] text-slate-400">No call_result rows yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.callOutcomes.map((o) => (
                    <li key={String(o.outcome)} className="flex justify-between text-[0.82rem]">
                      <span className="text-slate-600 dark:text-slate-400">{o.outcome || 'unset'}</span>
                      <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-200">{o.n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {data && (
          <p className="mt-6 text-[0.75rem] text-slate-400 dark:text-slate-600">
            Not computed: {data.omitted.join(', ')}. {data.omittedReason} Pipeline attribution lives on{' '}
            <Link to="/dashboard" className="text-indigo-600 dark:text-indigo-400 font-semibold">Overview</Link>.
          </p>
        )}
      </div>
    </AppShell>
  );
}
