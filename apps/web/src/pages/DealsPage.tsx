import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, MoreHorizontal } from 'lucide-react';
import { dealsApi } from '@/api/client';
import type { Deal } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

const STAGES: Deal['stage'][] = [
  'Prospecting', 'Qualified', 'Demo Booked', 'Proposal', 'Negotiating', 'Closed Won',
];

const STAGE_COLOR: Record<Deal['stage'], string> = {
  Prospecting: 'border-slate-300 dark:border-slate-600',
  Qualified:   'border-indigo-400',
  'Demo Booked':'border-violet-500',
  Proposal:    'border-amber-400',
  Negotiating: 'border-orange-500',
  'Closed Won':'border-emerald-500',
};

const STAGE_HEAD: Record<Deal['stage'], string> = {
  Prospecting:  'text-slate-500 dark:text-slate-400',
  Qualified:    'text-indigo-600 dark:text-indigo-400',
  'Demo Booked':'text-violet-600 dark:text-violet-400',
  Proposal:     'text-amber-600 dark:text-amber-400',
  Negotiating:  'text-orange-600 dark:text-orange-400',
  'Closed Won': 'text-emerald-600 dark:text-emerald-400',
};

function fmt(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n}`;
}

function initials(company: string) {
  return company.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

const AVATAR_COLORS = [
  'from-indigo-400 to-violet-500', 'from-emerald-400 to-cyan-500',
  'from-amber-400 to-orange-500',  'from-violet-400 to-pink-500',
  'from-cyan-400 to-indigo-500',   'from-rose-400 to-violet-500',
];

export default function DealsPage() {
  const [deals, setDeals]     = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dealsApi.list()
      .then(r => setDeals(r.items))
      .catch(() => void 0)
      .finally(() => setLoading(false));
  }, []);

  const byStage = (stage: Deal['stage']) => deals.filter(d => d.stage === stage);
  const stageValue = (stage: Deal['stage']) => byStage(stage).reduce((s, d) => s + d.amount, 0);
  const totalPipeline = deals.filter(d => d.stage !== 'Closed Won').reduce((s, d) => s + d.amount, 0);
  const totalWon      = deals.filter(d => d.stage === 'Closed Won').reduce((s, d) => s + d.amount, 0);

  return (
    <AppShell>
      <SEO title="Deals — ImpulsoIQ" description="Pipeline and deal management" />
      <div className="px-4 sm:px-6 py-6 flex flex-col h-full">

        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div>
            <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Deals</h1>
            <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">
              <span className="text-indigo-600 dark:text-indigo-400 font-semibold">${(totalPipeline/1000).toFixed(0)}K</span> open pipeline ·{' '}
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">${(totalWon/1000).toFixed(0)}K</span> closed won
            </p>
          </div>
          <button className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5 transition-all">
            <Plus size={15} /> Add deal
          </button>
        </div>

        {/* Kanban board */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[0.84rem] text-slate-400 dark:text-slate-600">Loading pipeline…</div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4 flex-1 scrollbar-hide">
            {STAGES.map(stage => {
              const stageDeal = byStage(stage);
              const val       = stageValue(stage);
              return (
                <div key={stage} className="flex-none w-[260px] flex flex-col">
                  {/* Column header */}
                  <div className={cn('flex items-center justify-between px-3 py-2.5 rounded-xl bg-white dark:bg-[#0d1526] border-l-2 mb-2.5', STAGE_COLOR[stage])}>
                    <div>
                      <p className={cn('text-[0.78rem] font-bold', STAGE_HEAD[stage])}>{stage}</p>
                      <p className="text-[0.68rem] text-slate-400 dark:text-slate-600">
                        {stageDeal.length} deal{stageDeal.length !== 1 ? 's' : ''}{val > 0 ? ` · ${fmt(val)}` : ''}
                      </p>
                    </div>
                    <button className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.07] transition-colors">
                      <Plus size={12} />
                    </button>
                  </div>

                  {/* Deal cards */}
                  <div className="flex flex-col gap-2 flex-1">
                    {stageDeal.map((deal, i) => (
                      <motion.div
                        key={deal.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-xl p-3.5 hover:shadow-md dark:hover:border-white/[0.1] hover:-translate-y-0.5 transition-all cursor-pointer group"
                      >
                        <div className="flex items-start justify-between mb-2.5">
                          <div className={cn('w-8 h-8 rounded-xl bg-gradient-to-br text-white text-[0.65rem] font-bold flex items-center justify-center flex-shrink-0', AVATAR_COLORS[i % AVATAR_COLORS.length])}>
                            {initials(deal.accountName ?? deal.name)}
                          </div>
                          <button className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.07] transition-all">
                            <MoreHorizontal size={12} />
                          </button>
                        </div>
                        <p className="text-[0.82rem] font-semibold text-slate-800 dark:text-slate-200 leading-snug mb-0.5">{deal.name}</p>
                        <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 mb-2.5">{deal.accountName ?? '—'}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-[0.84rem] font-extrabold text-slate-900 dark:text-white tabular-nums">{fmt(deal.amount)}</span>
                          {deal.closeDate && (
                            <span className="text-[0.68rem] text-slate-400 dark:text-slate-600">
                              {new Date(deal.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </motion.div>
                    ))}

                    {stageDeal.length === 0 && (
                      <div className="flex items-center justify-center h-20 rounded-xl border-2 border-dashed border-slate-200 dark:border-white/[0.05] text-[0.75rem] text-slate-400 dark:text-slate-700">
                        No deals
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
