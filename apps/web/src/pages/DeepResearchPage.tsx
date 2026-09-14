/**
 * Deep Research — Swarm company research with an explicit token approval gate.
 *
 * The agent refuses unless `approved=true`. Preview returns the estimate; Confirm
 * invokes agent-invoker and lands on the Control Panel for that run.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Zap } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { intentApi } from '@/api/client';

const STRATEGIES = [
  { key: 'firmographic',   label: 'Firmographic',   desc: 'Revenue, headcount, industry matches' },
  { key: 'technographic',  label: 'Technographic',  desc: 'Similar tech stack & challenges' },
  { key: 'news_signals',   label: 'Intent Signals', desc: 'Funding, hiring, growth events' },
  { key: 'lookalike',      label: 'Lookalike',      desc: 'Closest matches to closed-won deals' },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function DeepResearchPage() {
  const navigate = useNavigate();
  const [goal, setGoal] = useState('');
  const [icp, setIcp]   = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (res.message) setError(null);
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
      navigate(res.inspectHref || `/control-panel?run=${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research run failed.');
    } finally {
      setBusy(false);
    }
  }

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
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-[0.9rem] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition resize-none"
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
              className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
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

          {estimate != null && (
            <p className="text-[0.84rem] text-slate-600 dark:text-slate-300">
              This Swarm uses about <span className="font-semibold">{estimate.toLocaleString()}</span> tokens across four strategies. Approve to run, then inspect the agent run.
            </p>
          )}

          {estimate == null ? (
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
              <Search size={15} />
              Approve and run
            </button>
          )}
        </motion.div>
      </div>
    </AppShell>
  );
}
