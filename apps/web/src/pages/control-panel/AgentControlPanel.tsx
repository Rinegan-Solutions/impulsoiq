import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pause, Play, XCircle, RefreshCw } from 'lucide-react';
import { agentRunsApi } from '@/api/client';
import type { AgentRun } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';
import { useNow } from '@/lib/useNow';

type FeedType = 'research'|'outreach'|'voice'|'crm'|'coord';
const FEED_DATA: {type: FeedType; msg: string}[] = [
  {type:'research', msg:'Enriched Sarah Chen · Acme Corp · 3 intent signals found'},
  {type:'coord',    msg:'Coordinator: routing Marcus Webb → Outreach agent'},
  {type:'outreach', msg:'Email sent → Priya Nair · "Q4 growth efficiency" subject line'},
  {type:'voice',    msg:'Call completed: Jennifer Park · demo booked 2026-09-05 14:00'},
  {type:'crm',      msg:'Deal created: Circlepoint · $48,000 · Stage: Qualified'},
  {type:'research', msg:'Found: Daniel Osei · CRO · raised $45M Series B'},
  {type:'outreach', msg:'Follow-up SMS → Aiko Tanaka · consent verified · reply-to on'},
  {type:'voice',    msg:'Voicemail: Carlos Rivera · retry scheduled 4h · transcript saved'},
  {type:'crm',      msg:'Contact score raised: Rania Khalid 72 → 87 · 3× email opens'},
  {type:'coord',    msg:'Approval gate triggered: Northvault $120K — awaiting review'},
  {type:'outreach', msg:'Sequence paused: Lisa Chen replied → routed to human AE'},
];

const FEED_CLS: Record<FeedType, string> = {
  research: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  outreach: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  voice:    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  crm:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  coord:    'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};
const FEED_LABEL: Record<FeedType, string> = { research:'Research', outreach:'Outreach', voice:'Voice', crm:'CRM', coord:'Coord' };

const STATUS_CLS: Record<AgentRun['status'], string> = {
  running:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  paused:    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  completed: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400',
  pending:   'bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-400',
  failed:    'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
};
const STATUS_DOT: Record<AgentRun['status'], string> = {
  running:'bg-emerald-500 animate-pulse', paused:'bg-amber-500', completed:'bg-indigo-500', pending:'bg-slate-400', failed:'bg-red-500',
};
const AGENT_CLS: Record<AgentRun['agentType'], string> = {
  research: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  outreach: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  voice:    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  crm:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  coord:    'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};

export default function AgentControlPanel() {
  const [runs, setRuns]       = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<'all'|AgentRun['status']>('all');
  const [feed, setFeed]       = useState<Array<{type: FeedType; msg: string; time: string}>>([]);
  const feedIdx = useRef(0);
  // Ticking clock so "elapsed" on each running agent advances live.
  const now = useNow(30_000);

  function makeEntry(offset = 0) {
    const d = FEED_DATA[feedIdx.current++ % FEED_DATA.length];
    const t = new Date(Date.now() - offset);
    const time = [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
    return { ...d, time };
  }

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await agentRunsApi.list();
      setRuns(res.items);
    } catch { /* error */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadRuns();
    const initial = Array.from({length: 7}, (_, i) => makeEntry((7-i)*2000));
    setFeed(initial);
    const t = setInterval(() => setFeed(p => [...p, makeEntry()].slice(-12)), 2500);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAction(run: AgentRun, action: 'pause'|'resume'|'kill') {
    try {
      const updated =
        action === 'pause'  ? await agentRunsApi.pause(run.id)  :
        action === 'resume' ? await agentRunsApi.resume(run.id) :
        await agentRunsApi.kill(run.id);
      setRuns(prev => prev.map(r => r.id === updated.id ? updated : r));
    } catch { /* error */ }
  }

  const filtered = filter === 'all' ? runs : runs.filter(r => r.status === filter);
  const runCount = runs.filter(r => r.status === 'running').length;

  return (
    <AppShell>
      <SEO title="Agent Control Panel — ImpulsoIQ" description="Real-time AI agent monitoring and control" />
      <div className="px-4 sm:px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Agent Control Panel</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[0.82rem] text-emerald-600 dark:text-emerald-400 font-medium">{runCount} agents running</p>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <p className="text-[0.82rem] text-slate-400 dark:text-slate-600">{runs.length} total runs</p>
            </div>
          </div>
          <button onClick={loadRuns} className="w-8 h-8 rounded-xl border border-slate-200 dark:border-white/[0.1] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-white/20 transition-all">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5">

          {/* Run table */}
          <div className="space-y-3">
            {/* Filter tabs */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/[0.04] rounded-xl p-1 w-fit">
              {(['all','running','paused','completed','failed'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={cn('px-3 py-1.5 rounded-lg text-[0.78rem] font-semibold transition-all capitalize',
                    filter === f ? 'bg-white dark:bg-[#0d1526] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
                  {f}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
              <div className="grid px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 bg-slate-50/60 dark:bg-white/[0.02]"
                style={{ gridTemplateColumns: '1fr 80px 80px 80px 100px' }}>
                <span>Contact</span><span>Status</span><span>Agent</span><span>Started</span><span className="text-right">Actions</span>
              </div>

              {loading ? (
                <div className="py-12 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">Loading runs…</div>
              ) : filtered.length === 0 ? (
                <div className="py-12 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">No {filter !== 'all' ? filter : ''} runs</div>
              ) : (
                filtered.map((r, i) => {
                  const elapsed = Math.floor((now - new Date(r.startedAt).getTime()) / 60000);
                  return (
                    <motion.div key={r.id} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*0.03}}
                      className="grid px-4 py-3 border-b border-slate-50 dark:border-white/[0.03] last:border-0 items-center text-[0.8rem] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors group"
                      style={{ gridTemplateColumns: '1fr 80px 80px 80px 100px' }}>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{r.contactName}</p>
                        <p className="text-[0.7rem] text-slate-400 dark:text-slate-600 truncate">{r.company}</p>
                      </div>
                      <span className={cn('inline-flex items-center gap-1.5 text-[0.63rem] font-bold px-1.5 py-0.5 rounded-lg w-fit', STATUS_CLS[r.status])}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[r.status])} />
                        {r.status}
                      </span>
                      <span className={cn('text-[0.65rem] font-bold px-1.5 py-0.5 rounded w-fit', AGENT_CLS[r.agentType])}>{r.agentType}</span>
                      <span className="text-[0.72rem] text-slate-400 dark:text-slate-600">{elapsed}m ago</span>
                      <div className="flex items-center gap-1 justify-end">
                        {r.status === 'running' && (
                          <button onClick={() => handleAction(r, 'pause')}
                            className="w-6 h-6 rounded-md bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400 hover:scale-110 transition-transform" title="Pause">
                            <Pause size={10} />
                          </button>
                        )}
                        {r.status === 'paused' && (
                          <button onClick={() => handleAction(r, 'resume')}
                            className="w-6 h-6 rounded-md bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-400 hover:scale-110 transition-transform" title="Resume">
                            <Play size={10} />
                          </button>
                        )}
                        {(r.status === 'running' || r.status === 'paused') && (
                          <button onClick={() => handleAction(r, 'kill')}
                            className="w-6 h-6 rounded-md bg-red-100 dark:bg-red-500/15 flex items-center justify-center text-red-500 dark:text-red-400 hover:scale-110 transition-transform" title="Kill">
                            <XCircle size={10} />
                          </button>
                        )}
                        {(r.status === 'completed' || r.status === 'failed') && (
                          <span className="text-[0.7rem] text-slate-400 dark:text-slate-600">Done</span>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>

          {/* Live activity feed */}
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden flex flex-col h-fit">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-white/[0.05] flex-shrink-0">
              <h3 className="text-[0.88rem] font-bold text-slate-900 dark:text-white">Live Feed</h3>
              <span className="flex items-center gap-1.5 text-[0.7rem] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Real-time
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 max-h-[520px]" role="log" aria-live="polite">
              <AnimatePresence initial={false}>
                {feed.map((e, i) => (
                  <motion.div key={i} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:0.25}}
                    className="flex items-baseline gap-2 px-2 py-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors text-[0.73rem] font-mono">
                    <span className="text-slate-400 dark:text-slate-600 text-[0.65rem] flex-shrink-0 w-[54px]">{e.time}</span>
                    <span className={cn('text-[0.6rem] font-bold px-1.5 py-0.5 rounded flex-shrink-0 w-[56px] text-center', FEED_CLS[e.type])}>
                      {FEED_LABEL[e.type]}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400 truncate text-[0.7rem]">{e.msg}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

        </div>
      </div>
    </AppShell>
  );
}
