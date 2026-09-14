/**
 * Notifications.
 *
 * WHAT IT SHOWS, AND WHY ONLY THIS
 * Work that is BLOCKED ON THE PERSON READING IT — agent actions waiting for a
 * human decision (crm-read's list_pending_approvals). That is the only
 * notification-shaped data the platform actually holds today: there is no
 * notification table, and no read/unread state anywhere.
 *
 * So the badge is a count of outstanding approvals, not of "unread items", and
 * opening the panel does not mark anything read — it cannot, and pretending
 * otherwise would make the badge lie the moment a second browser tab existed.
 * A bell that invented activity to look busy would be worse than no bell.
 *
 * Accounts without the Control mode get a 403 from the operation; that is a
 * normal answer for them, not an error, and the bell simply stays quiet.
 *
 * FINISHED RUNS ARE LISTED BUT NOT COUNTED
 * A long run (Deep Research and friends) is started and then left — current
 * agentic-UX guidance is explicit that such runs need "a notification system so
 * the user can leave the surface and come back". They appear in the panel for 24
 * hours, linked to their findings. They deliberately do NOT add to the badge:
 * with no read state, a counted item would nag forever, and the badge would stop
 * meaning "something is blocked on you" — which is the only thing that earns an
 * interruption.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { activitiesApi, agentRunsApi } from '@/api/client';
import { ApiError } from '@/api/http';
import type { Activity, AgentRun } from '@/api/schemas';
import { agentFullLabel, LONG_RUNNING_AGENTS } from '@/lib/agentLabels';
import { cn } from '@/lib/utils';

/** Approvals are not push-delivered, so the count is refreshed on a slow poll. */
const REFRESH_MS = 60_000;
const MAX_SHOWN = 6;
/** How long a finished run stays worth mentioning. */
const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000;

function describe(item: Activity): string {
  const who = [item.firstName, item.lastName].filter(Boolean).join(' ')
    || item.email
    || item.accountName
    || 'a contact';
  return item.subject?.trim() || `${item.type} for ${who}`;
}

function whenLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsBell() {
  const [items, setItems] = useState<Activity[]>([]);
  const [finished, setFinished] = useState<AgentRun[]>([]);
  const [open, setOpen] = useState(false);
  const [denied, setDenied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await activitiesApi.pendingApprovals());
      setDenied(false);
    } catch (err) {
      // 403 means this role has no approvals surface — expected, stay quiet.
      if (err instanceof ApiError && err.status === 403) setDenied(true);
      setItems([]);
    }

    try {
      const page = await agentRunsApi.list(1, 50);
      const cutoff = Date.now() - FINISHED_WINDOW_MS;
      setFinished(page.items.filter((r) => {
        if (!LONG_RUNNING_AGENTS.has(r.agentType)) return false;
        if (r.status !== 'completed' && r.status !== 'failed') return false;
        const at = new Date(r.endedAt ?? r.startedAt).getTime();
        return !Number.isNaN(at) && at >= cutoff;
      }));
    } catch {
      setFinished([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (denied && finished.length === 0) return null;

  const count = items.length;
  const label = count === 0
    ? 'Notifications'
    : `Notifications, ${count} approval${count === 1 ? '' : 's'} waiting`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(p => !p); if (!open) void load(); }}
        aria-label={label}
        aria-expanded={open}
        className={cn(
          'relative w-9 h-9 rounded-full flex items-center justify-center transition-colors',
          open
            ? 'bg-slate-100 dark:bg-white/[0.08] text-slate-900 dark:text-white'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-white',
        )}
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[0.6rem] font-bold flex items-center justify-center ring-2 ring-white dark:ring-[#020617]">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-[calc(100%+10px)] w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.1] rounded-2xl shadow-xl shadow-slate-900/10 dark:shadow-black/50 z-[100] overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06]">
              <p className="text-[0.82rem] font-bold text-slate-900 dark:text-white">Notifications</p>
            </div>

            {count === 0 ? (
              <p className="px-4 py-6 text-center text-[0.8rem] text-slate-400 dark:text-slate-600">
                Nothing needs your approval.
              </p>
            ) : (
              <>
                <ul className="max-h-80 overflow-y-auto py-1" aria-live="polite">
                  {items.slice(0, MAX_SHOWN).map((item) => (
                    <li key={item.id}>
                      <Link
                        to="/approvals"
                        onClick={() => setOpen(false)}
                        className="block px-4 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                      >
                        <p className="text-[0.82rem] font-medium text-slate-800 dark:text-slate-100 line-clamp-2">
                          {describe(item)}
                        </p>
                        <p className="text-[0.72rem] text-slate-400 dark:text-slate-600">
                          {item.actorType === 'agent' ? 'Agent' : 'Teammate'} · {whenLabel(item.occurredAt)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/approvals"
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2.5 border-t border-slate-100 dark:border-white/[0.06] text-[0.8rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                >
                  {count > MAX_SHOWN ? `Review all ${count} approvals →` : 'Review approvals →'}
                </Link>
              </>
            )}

            {finished.length > 0 && (
              <div className="border-t border-slate-100 dark:border-white/[0.06]">
                <p className="px-4 pt-2.5 pb-1 text-[0.72rem] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-600">
                  Finished recently
                </p>
                <ul className="max-h-56 overflow-y-auto pb-1">
                  {finished.slice(0, MAX_SHOWN).map((run) => (
                    <li key={run.id}>
                      <Link
                        to={`/control-panel/${run.id}`}
                        onClick={() => setOpen(false)}
                        className="block px-4 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                      >
                        <p className="text-[0.82rem] font-medium text-slate-800 dark:text-slate-100 line-clamp-2">
                          {typeof run.input?.goal === 'string' && run.input.goal.trim()
                            ? String(run.input.goal)
                            : agentFullLabel(run.agentType)}
                        </p>
                        <p className="text-[0.72rem] text-slate-400 dark:text-slate-600">
                          {agentFullLabel(run.agentType)} · {run.status === 'failed' ? 'failed' : 'ready to read'}
                          {' · '}{whenLabel(run.endedAt ?? run.startedAt)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
