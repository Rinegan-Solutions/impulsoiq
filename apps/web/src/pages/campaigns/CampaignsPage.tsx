import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Play, Pause, MoreHorizontal, ChevronRight, Zap } from 'lucide-react';
import { campaignsApi } from '@/api/client';
import type { Campaign } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  active:    { label: 'Active',    dot: 'bg-emerald-500 animate-pulse', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  paused:    { label: 'Paused',    dot: 'bg-amber-500',                  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'         },
  completed: { label: 'Completed', dot: 'bg-indigo-500',                 cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400'     },
  draft:     { label: 'Draft',     dot: 'bg-slate-400',                  cls: 'bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-400'          },
  cancelled: { label: 'Cancelled', dot: 'bg-red-500',                    cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'                 },
};

function ProgressBar({ value, max, status }: { value: number; max: number; status: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const color = status === 'active' ? 'bg-indigo-500' : status === 'paused' ? 'bg-amber-400' : 'bg-indigo-400';
  return (
    <div>
      <div className="flex justify-between text-[0.7rem] text-slate-400 dark:text-slate-600 mb-1">
        <span>{value.toLocaleString()} / {max.toLocaleString()}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/[0.07] overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full', color)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

function StatPill({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-[0.95rem] font-extrabold tabular-nums', highlight ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-slate-200')}>{value}</p>
      <p className="text-[0.65rem] text-slate-400 dark:text-slate-600 mt-0.5">{label}</p>
    </div>
  );
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<string>('all');

  async function load() {
    setLoading(true);
    try {
      const res = await campaignsApi.list();
      setCampaigns(res.items);
    } catch { /* error */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function toggleStatus(c: Campaign) {
    try {
      const updated = c.status === 'active'
        ? await campaignsApi.pause(c.id)
        : await campaignsApi.resume(c.id);
      setCampaigns(prev => prev.map(x => x.id === updated.id ? updated : x));
    } catch { /* error */ }
  }

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);
  const counts   = { all: campaigns.length, active: campaigns.filter(c=>c.status==='active').length, paused: campaigns.filter(c=>c.status==='paused').length, completed: campaigns.filter(c=>c.status==='completed').length };

  return (
    <AppShell>
      <SEO title="Campaigns — ImpulsoIQ" description="AI campaign management" />
      <div className="px-4 sm:px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Campaigns</h1>
            <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">{counts.active} active · {counts.paused} paused · {counts.completed} completed</p>
          </div>
          <button className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5 transition-all">
            <Plus size={15} /> New campaign
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 mb-5 bg-slate-100 dark:bg-white/[0.04] rounded-xl p-1 w-fit">
          {(['all', 'active', 'paused', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-[0.8rem] font-semibold transition-all capitalize',
                filter === f
                  ? 'bg-white dark:bg-[#0d1526] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {f === 'all' ? 'All' : f} {f !== 'all' && <span className="ml-1 text-[0.7rem] opacity-60">{counts[f]}</span>}
            </button>
          ))}
        </div>

        {/* Cards */}
        {loading ? (
          <div className="py-20 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">Loading campaigns…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((c, i) => {
              const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft;
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5 hover:shadow-md dark:hover:border-white/[0.1] transition-all group"
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn('inline-flex items-center gap-1.5 text-[0.65rem] font-bold px-2 py-0.5 rounded-lg', cfg.cls)}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                          {cfg.label}
                        </span>
                      </div>
                      <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white truncate">{c.name}</h3>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {(c.status === 'active' || c.status === 'paused') && (
                        <button
                          onClick={() => toggleStatus(c)}
                          title={c.status === 'active' ? 'Pause' : 'Resume'}
                          className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-white/[0.07] flex items-center justify-center text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        >
                          {c.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
                        </button>
                      )}
                      <button className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-white/[0.07] flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        <MoreHorizontal size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mb-4">
                    <ProgressBar value={c.contactsTouched} max={c.contactsTotal} status={c.status} />
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-100 dark:border-white/[0.05]">
                    <StatPill label="Open rate"  value={`${c.openRate}%`} />
                    <StatPill label="Reply rate" value={`${c.replyRate}%`} highlight />
                    <StatPill label="Calls"      value={c.callsMade} />
                    <StatPill label="Meetings"   value={c.meetingsBooked} highlight />
                  </div>

                  {/* Footer link */}
                  <button className="mt-3 w-full flex items-center justify-center gap-1.5 text-[0.75rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline opacity-0 group-hover:opacity-100 transition-opacity">
                    View details <ChevronRight size={12} />
                  </button>
                </motion.div>
              );
            })}

            {/* New campaign placeholder */}
            <motion.button
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: filtered.length * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="bg-slate-50 dark:bg-white/[0.015] border-2 border-dashed border-slate-200 dark:border-white/[0.07] rounded-2xl p-5 flex flex-col items-center justify-center gap-2 min-h-[180px] hover:border-indigo-400 dark:hover:border-indigo-500/50 hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5 transition-all group"
            >
              <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Zap size={16} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <span className="text-[0.82rem] font-semibold text-slate-500 dark:text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                Launch new campaign
              </span>
            </motion.button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
