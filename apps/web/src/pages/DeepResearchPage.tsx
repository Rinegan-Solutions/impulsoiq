/**
 * Deep Research Page — Phase 4B.
 *
 * UI for submitting open-ended Swarm research goals and reviewing results.
 * The page follows the cost-governance requirement: shows cost estimate and
 * requires explicit approval before the Swarm runs.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Zap, AlertCircle, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
const TOTAL_ESTIMATED_TOKENS = 37_000;
const ESTIMATED_COST_USD     = (TOTAL_ESTIMATED_TOKENS * 0.000003).toFixed(4);

const STRATEGIES = [
  { key: 'firmographic',   label: 'Firmographic',   desc: 'Revenue, headcount, industry matches' },
  { key: 'technographic',  label: 'Technographic',  desc: 'Similar tech stack & challenges' },
  { key: 'news_signals',   label: 'Intent Signals',  desc: 'Funding, hiring, growth events' },
  { key: 'lookalike',      label: 'Lookalike',       desc: 'Closest matches to closed-won deals' },
];

interface ResearchResult {
  rank:        number;
  company:     string;
  reasons:     string[];
  strategies:  string[];
  confidence:  number;
}

// ── Mock research results for demo ───────────────────────────────────────────
const MOCK_RESULTS: ResearchResult[] = [
  { rank: 1, company: 'Northstar Analytics',   reasons: ['Series B FinTech, 180 employees', 'Active hiring in sales ops', 'Using similar CRM stack'], strategies: ['firmographic', 'news_signals', 'technographic'], confidence: 0.91 },
  { rank: 2, company: 'Meridian SaaS Group',   reasons: ['250 employees, $40M ARR range', 'Similar ICP to Acme Corp deal'], strategies: ['firmographic', 'lookalike'], confidence: 0.87 },
  { rank: 3, company: 'Apex Growth Co.',       reasons: ['Recently funded $28M Series A', 'B2B SaaS, 90 employees'], strategies: ['news_signals', 'firmographic'], confidence: 0.84 },
  { rank: 4, company: 'Circlepoint Ventures',  reasons: ['Tech stack overlap (Salesforce + HubSpot)', 'Lookalike to Circlepoint closed deal'], strategies: ['technographic', 'lookalike'], confidence: 0.79 },
  { rank: 5, company: 'Strata Dynamics',       reasons: ['Series A HealthTech, rapid head-count growth'], strategies: ['news_signals'], confidence: 0.74 },
];

type Phase = 'input' | 'estimate' | 'running' | 'results';

export default function DeepResearchPage() {
  const [phase, setPhase]   = useState<Phase>('input');
  const [goal, setGoal]     = useState('');
  const [icp, setIcp]       = useState('');
  const [results, setResults] = useState<ResearchResult[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  const ease = [0.22, 1, 0.36, 1] as const;

  function handleEstimate() {
    if (!goal.trim()) return;
    setPhase('estimate');
  }

  async function handleApprove() {
    setPhase('running');
    // Simulate Swarm run (4 parallel sub-agents + synthesis)
    await new Promise(r => setTimeout(r, 3500));
    setResults(MOCK_RESULTS);
    setPhase('results');
  }

  return (
    <AppShell>
      <SEO title="Deep Research — ImpulsoIQ" description="Swarm-powered multi-strategy company research" />
      <div className="px-4 sm:px-6 py-6 max-w-[900px]">

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }}>
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-2">
            Deep Research · Swarm
          </div>
          <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-1">
            Multi-strategy company research
          </h1>
          <p className="text-[0.84rem] text-slate-500 dark:text-slate-400">
            4 AI sub-agents run in parallel — firmographic, technographic, intent signals, and lookalike — then synthesise a single ranked output.
          </p>
        </motion.div>

        <AnimatePresence mode="wait">

          {/* ── Phase: Input ── */}
          {phase === 'input' && (
            <motion.div key="input" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease }} className="mt-7 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Research goal</label>
                <textarea
                  rows={3}
                  placeholder='e.g. "Find companies like our best FinTech customers — Series A/B, 50-300 employees, using Salesforce"'
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-[0.9rem] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">ICP description <span className="font-normal text-slate-400">(optional — improves firmographic matching)</span></label>
                <input
                  type="text"
                  placeholder="e.g. B2B SaaS, 100-500 employees, revenue $10M-$50M, decision-maker VP Sales or CRO"
                  value={icp}
                  onChange={e => setIcp(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
                />
              </div>

              {/* Strategy pills */}
              <div className="flex flex-wrap gap-2 pt-1">
                {STRATEGIES.map(s => (
                  <div key={s.key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-[0.75rem]">
                    <Zap size={11} className="text-indigo-600 dark:text-indigo-400" />
                    <span className="font-semibold text-indigo-700 dark:text-indigo-300">{s.label}</span>
                    <span className="text-indigo-500 dark:text-indigo-500">· {s.desc}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleEstimate}
                disabled={!goal.trim()}
                className="inline-flex items-center gap-2 px-6 py-3 font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5 disabled:opacity-40 disabled:transform-none transition-all"
              >
                <Search size={15} />
                Estimate cost & run
              </button>
            </motion.div>
          )}

          {/* ── Phase: Cost estimate + approval ── */}
          {phase === 'estimate' && (
            <motion.div key="estimate" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease }} className="mt-7">
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-2xl p-5 mb-5">
                <div className="flex items-start gap-3">
                  <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[0.9rem] font-bold text-amber-800 dark:text-amber-200 mb-1">Cost estimate — approval required</p>
                    <p className="text-[0.82rem] text-amber-700 dark:text-amber-300 leading-relaxed">
                      This Swarm research will spawn <strong>4 sub-agents in parallel</strong> plus a synthesis step, using approximately <strong>{TOTAL_ESTIMATED_TOKENS.toLocaleString()} tokens</strong> (~<strong>${ESTIMATED_COST_USD}</strong>).
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5 mb-5">
                <p className="text-[0.78rem] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-wider mb-3">Strategies that will run</p>
                <div className="space-y-2.5">
                  {STRATEGIES.map(s => (
                    <div key={s.key} className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                        <Zap size={11} className="text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div>
                        <span className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-200">{s.label}</span>
                        <span className="text-[0.78rem] text-slate-400 dark:text-slate-600 ml-2">{s.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleApprove}
                  className="inline-flex items-center gap-2 px-6 py-3 font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5 transition-all"
                >
                  <Check size={15} />
                  Approve & run research
                </button>
                <button onClick={() => setPhase('input')} className="text-[0.84rem] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Phase: Running ── */}
          {phase === 'running' && (
            <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-10 flex flex-col items-center py-12">
              <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-indigo-100 dark:border-indigo-900" />
                <div className="absolute inset-0 rounded-full border-4 border-t-indigo-600 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                <Zap size={20} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="text-[1rem] font-bold text-slate-900 dark:text-white mb-2">Swarm in progress</p>
              <p className="text-[0.84rem] text-slate-500 dark:text-slate-400 mb-6">4 sub-agents running in parallel…</p>
              <div className="flex gap-3">
                {STRATEGIES.map((s, i) => (
                  <motion.div
                    key={s.key}
                    initial={{ opacity: 0.3 }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.6, delay: i * 0.4, repeat: Infinity }}
                    className="px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-500/15 text-[0.72rem] font-semibold text-indigo-700 dark:text-indigo-300"
                  >
                    {s.label}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Phase: Results ── */}
          {phase === 'results' && (
            <motion.div key="results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease }} className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-[0.95rem] font-bold text-slate-900 dark:text-white">Research results</h3>
                  <p className="text-[0.78rem] text-slate-400 dark:text-slate-600 mt-0.5">{results.length} companies · ranked by convergent signal strength</p>
                </div>
                <button onClick={() => { setPhase('input'); setGoal(''); setResults([]); }}
                  className="text-[0.78rem] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                  New research
                </button>
              </div>

              <div className="space-y-2.5">
                {results.map((r, i) => (
                  <motion.div
                    key={r.rank}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07, ease }}
                    className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden hover:shadow-md dark:hover:border-white/[0.1] transition-all cursor-pointer"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    <div className="flex items-center gap-4 px-5 py-3.5">
                      <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-[0.72rem] font-bold flex items-center justify-center flex-shrink-0">
                        #{r.rank}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5">
                          <p className="text-[0.88rem] font-bold text-slate-800 dark:text-slate-200">{r.company}</p>
                          <div className="flex gap-1">
                            {r.strategies.map(s => (
                              <span key={s} className="text-[0.62rem] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                                {STRATEGIES.find(x => x.key === s)?.label}
                              </span>
                            ))}
                          </div>
                        </div>
                        <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-0.5">
                          {r.reasons[0]}
                        </p>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-[0.88rem] font-bold text-indigo-600 dark:text-indigo-400">{Math.round(r.confidence * 100)}%</p>
                          <p className="text-[0.65rem] text-slate-400 dark:text-slate-600">confidence</p>
                        </div>
                        {expanded === i ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                      </div>
                    </div>
                    <AnimatePresence>
                      {expanded === i && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 pb-4 border-t border-slate-100 dark:border-white/[0.04] pt-3">
                            <ul className="space-y-1.5">
                              {r.reasons.map((reason, j) => (
                                <li key={j} className="flex items-start gap-2 text-[0.8rem] text-slate-600 dark:text-slate-400">
                                  <span className="mt-1.5 w-1 h-1 rounded-full bg-indigo-400 flex-shrink-0" />
                                  {reason}
                                </li>
                              ))}
                            </ul>
                            <button className="mt-3 inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                              <Zap size={12} />
                              Add to campaign
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </AppShell>
  );
}
