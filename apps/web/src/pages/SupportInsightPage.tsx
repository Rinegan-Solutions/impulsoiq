/**
 * Support Insight Page — Phase 9A.
 *
 * Support health dashboard. Non-agentic — renders the report written by
 * the Support Insight Agent. Same pattern as the DashboardPage forecasting
 * section (Phase 3A), applied to support operations.
 *
 * Industry benchmark targets shown inline (v4 §9A):
 *   Deflection:  40% target / 59% top-quartile
 *   Resolution:  66% target / 80% best-in-class
 *   CSAT:        4.1/5 AI baseline / 4.25/5 hybrid target
 *   SLA breach:  < 5%
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, AlertTriangle, CheckCircle2,
  Star, BookOpen, Clock, ChevronRight,
} from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

// ── Mock support insight data ─────────────────────────────────────────────────

const MOCK_REPORT = {
  period:          '2026-09',
  generatedAt:     new Date().toISOString(),
  stats: {
    totalTickets:       312,
    totalConversations: 287,
    deflectionRate:     0.38,   // below 0.40 target → flag
    resolutionRate:     0.71,
    csatAvg:            4.2,
    csatByTier:         { '0': 4.4, '1': 4.1, '2': 3.8, '3': 3.2 },
    slaBreachRate:      0.04,   // below 5% target → ok
    firstResponseSecs:  2_340,  // 39 min
    avgHandleSecs:      7_200,  // 2 hrs
    backlogByQueue:     { 'General': 18, 'Billing': 7, 'Escalations': 2 },
    tierDistribution:   { '0': 98, '1': 142, '2': 51, '3': 21 },
  },
  anomalies: [
    { metric: 'deflection_rate', value: 0.38, target: 0.40, severity: 'warning',
      message: 'Deflection rate 38% is below target 40% (industry median 41%)' },
  ],
  narratives: [
    'September deflection rate is 38% — just below the 40% target. Billing questions are the main drag: 7 open billing tickets vs 2 escalations, suggesting the billing KB section needs new articles.',
    'Resolution rate of 71% is above the 66% industry baseline. Your Tier-1 draft acceptance rate is healthy — reps are sending AI drafts with minimal edits.',
    'CSAT average 4.2/5 is above the 4.1/5 AI baseline. Tier-3 CSAT (3.2/5) shows room to improve how senior escalations are handled post-resolution.',
    'SLA breach rate 4% is within the < 5% target. First response time averaging 39 minutes is also within the 60-minute target.',
  ],
  kbGapCount: 3,
};

const KB_GAPS = [
  { title: 'How to cancel a subscription', frequency: 7, type: 'repeated_confidence_gate_failure' },
  { title: 'Billing cycle and invoice timing', frequency: 5, type: 'repeated_confidence_gate_failure' },
  { title: 'API rate limits and quota management', frequency: 3, type: 'article_never_reviewed' },
];

// ── Metric card ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  label:     string;
  value:     string;
  target:    string;
  met:       boolean;
  icon:      React.ElementType;
  iconColor: string;
  iconBg:    string;
  detail?:   string;
}

function MetricCard({ label, value, target, met, icon: Icon, iconColor, iconBg, detail }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', iconBg)}>
          <Icon size={16} className={iconColor} />
        </div>
        <span className={cn('text-[0.65rem] font-bold px-1.5 py-0.5 rounded flex items-center gap-1',
          met ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400')}>
          {met ? <CheckCircle2 size={9} /> : <AlertTriangle size={9} />}
          {met ? 'On target' : 'Below target'}
        </span>
      </div>
      <p className="text-[1.8rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-0.5">{value}</p>
      <p className="text-[0.75rem] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-[0.7rem] text-slate-400 dark:text-slate-600 mt-1">Target: {target}</p>
      {detail && <p className="text-[0.7rem] text-slate-400 dark:text-slate-600">{detail}</p>}
    </motion.div>
  );
}

const ease = [0.22, 1, 0.36, 1] as const;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SupportInsightPage() {
  const [report] = useState(MOCK_REPORT);
  const s        = report.stats;

  const frMins = Math.round((s.firstResponseSecs ?? 0) / 60);
  const tierColors: Record<string, string> = {
    '0': 'bg-emerald-500', '1': 'bg-indigo-500', '2': 'bg-amber-500', '3': 'bg-red-500',
  };

  return (
    <AppShell>
      <SEO title="Support Insight — ImpulsoIQ" description="Support operations health dashboard" />
      <div className="px-4 sm:px-6 py-6 max-w-[1600px] mx-auto">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className="mb-6">
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-1">Phase 9 · Support Insight</div>
          <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Support Health</h1>
          <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">
            {report.period} · Generated {new Date(report.generatedAt).toLocaleDateString()}
          </p>
        </motion.div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard label="Deflection rate"   value={`${(s.deflectionRate*100).toFixed(0)}%`}
            target="40% (top-quartile: 59%)"   met={s.deflectionRate >= 0.40}
            icon={TrendingUp}  iconColor="text-indigo-600 dark:text-indigo-400" iconBg="bg-indigo-100 dark:bg-indigo-500/15" />
          <MetricCard label="Resolution rate"   value={`${(s.resolutionRate*100).toFixed(0)}%`}
            target="66% (best-in-class: 80%)"  met={s.resolutionRate >= 0.66}
            icon={CheckCircle2} iconColor="text-emerald-600 dark:text-emerald-400" iconBg="bg-emerald-100 dark:bg-emerald-500/15" />
          <MetricCard label="CSAT average"      value={`${s.csatAvg ?? '—'}/5`}
            target="4.1 AI baseline · 4.25 hybrid" met={(s.csatAvg ?? 0) >= 4.1}
            icon={Star}        iconColor="text-amber-600 dark:text-amber-400" iconBg="bg-amber-100 dark:bg-amber-500/15"
            detail={`First response: ${frMins} min (target < 60)`} />
          <MetricCard label="SLA breach rate"   value={`${(s.slaBreachRate*100).toFixed(0)}%`}
            target="< 5%"                       met={s.slaBreachRate < 0.05}
            icon={Clock}       iconColor="text-violet-600 dark:text-violet-400" iconBg="bg-violet-100 dark:bg-violet-500/15" />
        </div>

        {/* Narratives + Tier distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 mb-4">

          {/* Agent narratives */}
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5">
            <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <TrendingUp size={15} className="text-indigo-500" /> Insight narratives
            </h3>
            <ul className="space-y-3">
              {report.narratives.map((n, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08, ease }}
                  className="flex items-start gap-2.5 text-[0.84rem] text-slate-600 dark:text-slate-400">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-indigo-400 flex-shrink-0" />
                  {n}
                </motion.li>
              ))}
            </ul>
          </div>

          {/* Tier distribution */}
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5">
            <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white mb-4">Tickets by tier</h3>
            <div className="space-y-3">
              {Object.entries(s.tierDistribution).map(([tier, count]) => {
                const pct = Math.round((count / s.totalTickets) * 100);
                const csat = (s.csatByTier as Record<string, number>)[tier];
                const labels: Record<string, string> = { '0': 'Auto-resolved', '1': 'Draft reviewed', '2': 'Human required', '3': 'Hard escalated' };
                return (
                  <div key={tier}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[0.78rem] font-semibold text-slate-700 dark:text-slate-300">{labels[tier] ?? `Tier ${tier}`}</span>
                      <span className="text-[0.72rem] text-slate-400">{count} · {csat ? `CSAT ${csat}` : ''}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/[0.07] overflow-hidden">
                      <motion.div className={cn('h-full rounded-full', tierColors[tier] ?? 'bg-slate-400')}
                        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.7, delay: Number(tier) * 0.1, ease: [0.22, 1, 0.36, 1] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Backlog + KB gaps */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Backlog by queue */}
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5">
            <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white mb-4">Open backlog by queue</h3>
            <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
              {Object.entries(s.backlogByQueue).map(([queue, count]) => (
                <div key={queue} className="flex items-center justify-between py-2.5">
                  <span className="text-[0.84rem] text-slate-700 dark:text-slate-300 font-medium">{queue}</span>
                  <span className={cn('text-[0.84rem] font-bold',
                    count > 10 ? 'text-red-600 dark:text-red-400' :
                    count > 5  ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400')}>
                    {count} open
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* KB gap backlog (9B) */}
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
              <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BookOpen size={14} className="text-amber-500" /> KB gap backlog
              </h3>
              <span className="text-[0.72rem] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/20">
                {report.kbGapCount} gaps
              </span>
            </div>
            <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
              {KB_GAPS.map((gap, i) => (
                <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.06 }}
                  className="flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer group">
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-200 truncate">{gap.title}</p>
                    <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 mt-0.5">
                      {gap.type === 'repeated_confidence_gate_failure'
                        ? `${gap.frequency} confidence gate rejections`
                        : 'Article never reviewed'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[0.65rem] font-bold bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
                      Write article
                    </span>
                    <ChevronRight size={13} className="text-slate-300 dark:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-50 dark:border-white/[0.04] text-[0.72rem] text-slate-400 dark:text-slate-600">
              Each gap creates an approval-queue item → human confirms before any article is written.
            </div>
          </div>

        </div>
      </div>
    </AppShell>
  );
}
