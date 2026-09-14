import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Pause, Play, XCircle, RefreshCw, ShieldOff } from 'lucide-react';
import { agentRunsApi, controlApi, intentApi } from '@/api/client';
import type { AgentRun } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';
import { AGENT_LABEL } from '@/lib/agentLabels';
import { useNow } from '@/lib/useNow';
import { subscribeAgentActions, appsyncConfigured } from '@/lib/appsync';

const FEED_POLL_MS = 15_000;

// Labels moved to lib/agentLabels.ts so the run detail view and the research
// history render the same names as this table.

const STATUS_TEXT: Record<AgentRun['status'], string> = {
  pending:   'queued',
  running:   'started',
  paused:    'paused',
  completed: 'completed',
  failed:    'failed',
};

interface FeedEntry {
  key: string;
  at: number;
  agentType: AgentRun['agentType'];
  text: string;
  failed: boolean;
}

function toFeed(runs: AgentRun[]): FeedEntry[] {
  return runs
    .map((r) => {
      const who = [r.firstName, r.lastName].filter(Boolean).join(' ') || r.agentType;
      const at = new Date(r.endedAt ?? r.startedAt).getTime();
      const block = r.error && /consent|dnc|window|paused|kill/i.test(r.error) ? ` · ${r.error}` : '';
      const detail = r.status === 'failed' && r.error ? ` · ${r.error}` : block;
      return {
        key: `${r.id}:${r.status}:${r.error ?? ''}`,
        at: Number.isNaN(at) ? 0 : at,
        agentType: r.agentType,
        text: `${who} · ${STATUS_TEXT[r.status]}${detail}`,
        failed: r.status === 'failed',
      };
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 15);
}

function clockTime(ms: number, now: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return new Date(now).toDateString() === d.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

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
const AGENT_CLS: Record<string, string> = {
  research_enrichment: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  outreach:      'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  voice:         'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  nurture:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  clarification: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  coordinator:   'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};
const FALLBACK_AGENT_CLS = 'bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-400';

export default function AgentControlPanel() {
  const [params] = useSearchParams();
  const campaignFilter = params.get('campaign');
  const runFilter = params.get('run');
  const [runs, setRuns]       = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<'all'|AgentRun['status']>('all');
  // Status was the only axis, so a research run was buried among dozens of
  // outreach and voice runs with no way to say "show me the research".
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [live, setLive]       = useState(false);
  const [liveDetail, setLiveDetail] = useState(appsyncConfigured() ? 'Connecting…' : 'Poll fallback');
  const [notice, setNotice]   = useState<string | null>(null);
  const [accountPaused, setAccountPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const [usage, setUsage]     = useState<{ period: string | null; items: { resource: unknown; used: number; quota: number }[] } | null>(null);
  const now = useNow(30_000);

  const loadRuns = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [res, pause, meter] = await Promise.all([
        agentRunsApi.list(1, 100),
        controlApi.pauseStatus().catch((): { paused?: boolean; reason?: string } => ({ paused: false })),
        agentRunsApi.usage().catch(() => null),
      ]);
      setRuns(res.items);
      setAccountPaused(Boolean(pause.paused) || pause.reason === 'account_kill');
      setPauseReason(pause.paused ? String(pause.reason ?? 'paused') : null);
      if (meter) setUsage(meter);
    } catch { /* keep last good table */ }
    finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => {
    loadRuns();
    const t = setInterval(() => { void loadRuns(true); }, FEED_POLL_MS);
    return () => clearInterval(t);
  }, [loadRuns]);

  useEffect(() => {
    if (!campaignFilter && !runFilter) return;
    void intentApi.recordEvent('run_inspected', {
      campaignId: campaignFilter,
      runId: runFilter,
    }).catch(() => { /* activation log is best-effort */ });
  }, [campaignFilter, runFilter]);

  useEffect(() => {
    const unsub = subscribeAgentActions(
      () => { void loadRuns(true); },
      (isLive, detail) => {
        setLive(isLive);
        setLiveDetail(isLive ? 'Live push' : (detail ?? 'Poll fallback'));
      },
    );
    return unsub;
  }, [loadRuns]);

  const feed = useMemo(() => toFeed(runs), [runs]);

  async function handleAction(run: AgentRun, action: 'pause'|'resume'|'kill') {
    try {
      const result = action === 'pause'
        ? await controlApi.pauseRun(run.id)
        : action === 'resume'
          ? await controlApi.resumeRun(run.id)
          : await controlApi.killRun(run.id);
      if (result.callMayComplete && result.note) setNotice(result.note);
      else if (result.error) setNotice(result.error);
      else setNotice(null);
      await loadRuns();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Control action failed');
    }
  }

  async function handleAccountKill() {
    if (!window.confirm('Stop every running execution for this workspace and pause outbound?')) return;
    try {
      await controlApi.killTenant();
      setNotice('Account-wide kill is in effect. Outbound is paused until you clear it.');
      await loadRuns();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Account kill failed');
    }
  }

  async function handleClearKill() {
    try {
      await controlApi.clearTenantKill();
      setNotice('Account-wide kill cleared. Existing paused runs still need Resume.');
      await loadRuns();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not clear kill');
    }
  }

  const scoped = runs.filter((r) => {
    if (runFilter) return r.id === runFilter;
    if (campaignFilter) return r.campaignId === campaignFilter;
    return true;
  });
  const byStatus = filter === 'all' ? scoped : scoped.filter(r => r.status === filter);
  const filtered = agentFilter === 'all' ? byStatus : byStatus.filter(r => r.agentType === agentFilter);
  // Only offer types this workspace has actually run — a dropdown of 14 agents
  // most of which return nothing is a worse list than a short honest one.
  const agentTypes = Array.from(new Set(scoped.map(r => r.agentType))).sort();
  const runCount = scoped.filter(r => r.status === 'running').length;

  return (
    <AppShell>
      <SEO title="Agent Control Panel — ImpulsoIQ" description="Real-time AI agent monitoring and control" />
      <div className="px-4 sm:px-6 py-6">

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Agent Control Panel</h1>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className={cn('w-1.5 h-1.5 rounded-full', live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400')} />
              <p className={cn('text-[0.82rem] font-medium', live ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500')}>
                {runCount} agents running
              </p>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <p className="text-[0.82rem] text-slate-400 dark:text-slate-600">{runs.length} total runs</p>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <p className="text-[0.82rem] text-slate-400 dark:text-slate-600">
                {live ? 'Live' : 'Polling every 15s (fallback)'} — {liveDetail}
              </p>
            </div>
            <p className="text-[0.75rem] text-slate-500 dark:text-slate-500 mt-2 max-w-2xl">
              Pause and kill call StopExecution. Standard Step Functions cannot freeze in place; Resume starts a new execution from the stored input.
            </p>
            {(campaignFilter || runFilter) && (
              <p className="text-[0.75rem] text-indigo-600 dark:text-indigo-400 mt-1">
                Showing {runFilter ? `run ${runFilter}` : `campaign ${campaignFilter}`}.{' '}
                <Link to="/control-panel" className="underline">Show all</Link>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {accountPaused ? (
              <button onClick={handleClearKill}
                className="h-8 px-3 rounded-xl border border-amber-300 dark:border-amber-500/40 text-[0.75rem] font-semibold text-amber-700 dark:text-amber-400">
                Clear account kill
              </button>
            ) : (
              <button onClick={handleAccountKill}
                className="h-8 px-3 rounded-xl border border-red-200 dark:border-red-500/30 flex items-center gap-1.5 text-[0.75rem] font-semibold text-red-600 dark:text-red-400">
                <ShieldOff size={12} /> Kill all
              </button>
            )}
            <button onClick={() => loadRuns()} aria-label="Refresh runs" className="w-8 h-8 rounded-xl border border-slate-200 dark:border-white/[0.1] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-white/20 transition-all">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {accountPaused && (
          <div className="mb-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-[0.82rem] text-red-800 dark:text-red-200">
            Outbound is paused{pauseReason ? `: ${pauseReason.replace(/_/g, ' ')}` : ''}. Email and SMS will not send until this flag clears.
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-[0.82rem] text-amber-800 dark:text-amber-200">
            {notice}
          </div>
        )}

        {usage && usage.items.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {usage.items.map((item) => (
              <span key={String(item.resource)} className="text-[0.7rem] font-medium px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/[0.05] text-slate-600 dark:text-slate-400">
                {String(item.resource)} {item.used}/{item.quota || '—'}
                {usage.period ? ` · ${usage.period}` : ''}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5">

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
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

              {agentTypes.length > 1 && (
                <>
                  <label className="sr-only" htmlFor="agent-filter">Filter by agent</label>
                  <select
                    id="agent-filter"
                    value={agentFilter}
                    onChange={e => setAgentFilter(e.target.value)}
                    className="h-[34px] px-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-[0.78rem] font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  >
                    <option value="all">All agents</option>
                    {agentTypes.map(t => (
                      <option key={t} value={t}>{AGENT_LABEL[t] ?? t}</option>
                    ))}
                  </select>
                </>
              )}
            </div>

            <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
              <div className="grid px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 bg-slate-50/60 dark:bg-white/[0.02]"
                style={{ gridTemplateColumns: '1fr 80px 80px 90px 100px' }}>
                <span>Contact / run</span><span>Status</span><span>Agent</span><span>Started</span><span className="text-right">Actions</span>
              </div>

              {loading ? (
                <div className="py-12 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">Loading runs…</div>
              ) : filtered.length === 0 ? (
                <div className="py-12 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">
                  No {filter !== 'all' ? filter : ''} runs{agentFilter !== 'all' ? ` for ${AGENT_LABEL[agentFilter] ?? agentFilter}` : ''}
                </div>
              ) : (
                filtered.map((r, i) => {
                  const elapsed = Math.floor((now - new Date(r.startedAt).getTime()) / 60000);
                  const who = [r.firstName, r.lastName].filter(Boolean).join(' ') || (r.contactId ? 'Unknown contact' : 'Workspace run');
                  return (
                    <motion.div key={r.id} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*0.03}}
                      className="grid px-4 py-3 border-b border-slate-50 dark:border-white/[0.03] last:border-0 items-center text-[0.8rem] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors group"
                      style={{ gridTemplateColumns: '1fr 80px 80px 90px 100px' }}>
                      {/* The whole identity cell is the link: a run's output was
                          previously unreachable from this table. Cost stays out of
                          the row -- it was raw JSON.stringify here, which is what
                          the detail page renders properly. */}
                      <Link to={`/control-panel/${r.id}`} className="min-w-0 group/row">
                        <p className="font-semibold text-slate-800 dark:text-slate-200 truncate group-hover/row:text-indigo-600 dark:group-hover/row:text-indigo-400 transition-colors">
                          {who}
                        </p>
                        <p className="text-[0.7rem] text-slate-400 dark:text-slate-600 truncate">
                          {r.error || AGENT_LABEL[r.agentType] || r.agentType}
                        </p>
                      </Link>
                      <span className={cn('inline-flex items-center gap-1.5 text-[0.63rem] font-bold px-1.5 py-0.5 rounded-lg w-fit', STATUS_CLS[r.status])}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[r.status])} />
                        {r.status}
                      </span>
                      <span className={cn('text-[0.65rem] font-bold px-1.5 py-0.5 rounded w-fit', AGENT_CLS[r.agentType] ?? FALLBACK_AGENT_CLS)}>
                        {AGENT_LABEL[r.agentType] ?? r.agentType}
                      </span>
                      <span className="text-[0.72rem] text-slate-400 dark:text-slate-600">{elapsed}m ago</span>
                      <div className="flex items-center gap-1 justify-end">
                        {r.status === 'running' && (
                          <button onClick={() => handleAction(r, 'pause')}
                            className="w-6 h-6 rounded-md bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400 hover:scale-110 transition-transform" title="Pause (stops the execution)">
                            <Pause size={10} />
                          </button>
                        )}
                        {r.status === 'paused' && (
                          <button onClick={() => handleAction(r, 'resume')}
                            className="w-6 h-6 rounded-md bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-400 hover:scale-110 transition-transform" title="Resume (new execution from stored input)">
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

          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden flex flex-col h-fit">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-white/[0.05] flex-shrink-0">
              <h3 className="text-[0.88rem] font-bold text-slate-900 dark:text-white">Recent activity</h3>
              <span className={cn(
                'flex items-center gap-1.5 text-[0.7rem] font-semibold px-2 py-0.5 rounded-full border',
                live
                  ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
                  : 'text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/[0.04] border-slate-200 dark:border-white/[0.08]',
              )}>
                {live ? 'Live' : <><RefreshCw size={10} /> Poll {FEED_POLL_MS / 1000}s</>}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 max-h-[520px]" role="log" aria-live="polite">
              {!loading && feed.length === 0 && (
                <p className="py-10 text-center text-[0.8rem] text-slate-400 dark:text-slate-600">No agent activity yet</p>
              )}
              <AnimatePresence initial={false}>
                {feed.map(e => (
                  <motion.div key={e.key} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:0.25}}
                    className="flex items-baseline gap-2 px-2 py-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors text-[0.73rem] font-mono">
                    <span className="text-slate-400 dark:text-slate-600 text-[0.65rem] flex-shrink-0 w-[54px]">{clockTime(e.at, now)}</span>
                    <span className={cn('text-[0.6rem] font-bold px-1.5 py-0.5 rounded flex-shrink-0 w-[60px] text-center', AGENT_CLS[e.agentType] ?? FALLBACK_AGENT_CLS)}>
                      {AGENT_LABEL[e.agentType] ?? e.agentType}
                    </span>
                    <span className={cn('truncate text-[0.7rem]', e.failed ? 'text-red-500 dark:text-red-400' : 'text-slate-600 dark:text-slate-400')}>{e.text}</span>
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
