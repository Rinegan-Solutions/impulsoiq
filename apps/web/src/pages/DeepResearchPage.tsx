/**
 * Deep Research — Swarm company research with an explicit token approval gate.
 *
 * Confirm starts the run asynchronously (API Gateway cannot wait on a Swarm).
 * This page polls the agent_run on 1m, then 3m, then 5m gaps.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Search, Zap } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { agentRunsApi, intentApi } from '@/api/client';
import type { AgentRun } from '@/api/schemas';
import { useNow } from '@/lib/useNow';

const STRATEGIES = [
  { key: 'firmographic',   label: 'Firmographic',   desc: 'Revenue, headcount, industry matches' },
  { key: 'technographic',  label: 'Technographic',  desc: 'Similar tech stack & challenges' },
  { key: 'news_signals',   label: 'Intent Signals', desc: 'Funding, hiring, growth events' },
  { key: 'lookalike',      label: 'Lookalike',      desc: 'Closest matches to closed-won deals' },
];

const ease = [0.22, 1, 0.36, 1] as const;

/** Wait 1 minute, then 3, then 5, then keep checking every 5 minutes. */
const POLL_GAPS_MS = [60_000, 180_000, 300_000];
const POLL_CAP_MS = 30 * 60_000;

function formatWait(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return r ? `${m}m ${r}s` : `${m}m`;
}

export default function DeepResearchPage() {
  const [goal, setGoal] = useState('');
  const [icp, setIcp]   = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [inspectHref, setInspectHref] = useState('/control-panel');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [nextCheckAt, setNextCheckAt] = useState<number | null>(null);
  const pollIndex = useRef(0);
  const startedAt = useRef<number | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (cancelled) return;
      try {
        const latest = await agentRunsApi.get(runId);
        if (cancelled) return;
        if (latest) setRun(latest);
        if (latest?.status === 'completed' || latest?.status === 'failed') {
          setNextCheckAt(null);
          return;
        }
      } catch {
        // Keep waiting — a transient read failure should not kill the Swarm wait.
      }
      if (cancelled) return;
      const elapsed = Date.now() - (startedAt.current ?? Date.now());
      if (elapsed >= POLL_CAP_MS) {
        setNextCheckAt(null);
        return;
      }
      const gap = POLL_GAPS_MS[Math.min(pollIndex.current, POLL_GAPS_MS.length - 1)];
      pollIndex.current += 1;
      setNextCheckAt(Date.now() + gap);
      timer = setTimeout(() => { void check(); }, gap);
    };

    const firstGap = POLL_GAPS_MS[0];
    pollIndex.current = 1;
    setNextCheckAt(Date.now() + firstGap);
    timer = setTimeout(() => { void check(); }, firstGap);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  async function preview() {
    const researchGoal = goal.trim();
    if (!researchGoal) {
      setError('Write a research goal first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await intentApi.deepResearch({ researchGoal, icp, approved: false });
      setEstimate(res.estimatedTokens ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not estimate cost.');
    } finally {
      setBusy(false);
    }
  }

  async function runApproved() {
    const researchGoal = goal.trim();
    if (!researchGoal) return;
    setBusy(true);
    setError(null);
    try {
      const res = await intentApi.deepResearch({ researchGoal, icp, approved: true });
      if (!res.id) {
        setError('Research started but no run id was returned.');
        return;
      }
      pollIndex.current = 0;
      startedAt.current = Date.now();
      setRun({
        id: res.id,
        tenantId: '',
        agentType: 'deep_research',
        status: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
        error: null,
      } as AgentRun);
      setInspectHref(res.inspectHref || `/control-panel?run=${res.id}`);
      setRunId(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research run failed.');
    } finally {
      setBusy(false);
    }
  }

  const running = Boolean(runId) && run?.status !== 'completed' && run?.status !== 'failed';
  const timedOutWaiting = Boolean(runId) && running && startedAt.current != null
    && Date.now() - startedAt.current >= POLL_CAP_MS && nextCheckAt == null;

  return (
    <AppShell>
      <SEO title="Deep Research — ImpulsoIQ" description="Multi-strategy company research" />
      <div className="px-4 sm:px-6 py-6 max-w-[900px]">

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }}>
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-2">
            Deep Research
          </div>
          <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-1">
            Multi-strategy company research
          </h1>
          <p className="text-[0.84rem] text-slate-500 dark:text-slate-400">
            Four research strategies run in parallel. You must approve the token estimate before the Swarm starts.
            A run usually takes several minutes — we check after 1 minute, then 3, then every 5.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05, ease }} className="mt-7 space-y-4">
          <div>
            <label htmlFor="research-goal" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Research goal</label>
            <textarea
              id="research-goal"
              rows={3}
              placeholder='e.g. "Find companies like our best FinTech customers — Series A/B, 50-300 employees, using Salesforce"'
              value={goal}
              onChange={e => { setGoal(e.target.value); setEstimate(null); }}
              disabled={running}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-[0.9rem] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition resize-none disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="research-icp" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              ICP description <span className="font-normal text-slate-400">(optional — improves firmographic matching)</span>
            </label>
            <input
              id="research-icp"
              type="text"
              placeholder="e.g. B2B SaaS, 100-500 employees, revenue $10M-$50M, decision-maker VP Sales or CRO"
              value={icp}
              onChange={e => setIcp(e.target.value)}
              disabled={running}
              className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition disabled:opacity-60"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {STRATEGIES.map(s => (
              <div key={s.key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-[0.75rem]">
                <Zap size={11} className="text-indigo-600 dark:text-indigo-400" />
                <span className="font-semibold text-indigo-700 dark:text-indigo-300">{s.label}</span>
                <span className="text-indigo-500 dark:text-indigo-500">· {s.desc}</span>
              </div>
            ))}
          </div>

          {error && (
            <p className="text-[0.82rem] text-amber-700 dark:text-amber-300">{error}</p>
          )}

          {estimate != null && !runId && (
            <p className="text-[0.84rem] text-slate-600 dark:text-slate-300">
              This Swarm uses about <span className="font-semibold">{estimate.toLocaleString()}</span> tokens across four strategies. Approve to start — results arrive when the Swarm finishes.
            </p>
          )}

          {running && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/25 bg-indigo-50/70 dark:bg-indigo-500/10 px-4 py-3 text-[0.84rem] text-slate-700 dark:text-slate-300">
              <p className="flex items-center gap-2 font-semibold text-indigo-800 dark:text-indigo-200">
                <Loader2 size={15} className="animate-spin" />
                Research is running
              </p>
              <p className="mt-1 text-slate-600 dark:text-slate-400">
                {nextCheckAt
                  ? `Next status check in ${formatWait(nextCheckAt - now)}.`
                  : timedOutWaiting
                    ? 'Still running after 30 minutes. Watch the Control Panel for completion.'
                    : 'Checking status…'}
              </p>
              <Link to={inspectHref} className="inline-block mt-2 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                Open in Control Panel
              </Link>
            </div>
          )}

          {run?.status === 'failed' && (
            <p className="text-[0.82rem] text-red-600 dark:text-red-400">
              {run.error || 'The research run failed.'}{' '}
              <Link to={inspectHref} className="font-semibold underline">Open in Control Panel</Link>
            </p>
          )}

          {run?.status === 'completed' && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/70 dark:bg-emerald-500/10 px-4 py-3 text-[0.84rem] text-slate-700 dark:text-slate-300">
              <p className="font-semibold text-emerald-800 dark:text-emerald-200">Research finished.</p>
              <Link to={inspectHref} className="inline-block mt-2 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                View the run
              </Link>
            </div>
          )}

          {!runId && (estimate == null ? (
            <button
              type="button"
              disabled={busy || !goal.trim()}
              onClick={() => void preview()}
              className="inline-flex items-center gap-2 px-6 py-3 font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 disabled:opacity-40"
            >
              <Search size={15} />
              Estimate cost
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runApproved()}
              className="inline-flex items-center gap-2 px-6 py-3 font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 disabled:opacity-40"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              Approve and run
            </button>
          ))}
        </motion.div>
      </div>
    </AppShell>
  );
}
