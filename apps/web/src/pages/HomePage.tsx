/**
 * Home — the intent surface. Goal → clarify → plan → confirm → inspect in ACP.
 *
 * LAYOUT (follows the 2026 assistant convention: Claude, ChatGPT, Perplexity)
 * - Empty state: one centred column — greeting, composer, starter chips. The
 *   composer is the first thing your eye lands on because it is the product.
 * - Once a turn exists: the transcript scrolls and the composer DOCKS to the
 *   bottom. It never floats over the last message; the stream is padded for it.
 * - Column capped at 768px so answers stay at ~65–72 characters per line.
 * - Auto-scroll only while the reader is within 100px of the bottom; past that
 *   a "Jump to latest" button appears rather than yanking the viewport.
 * - Starter chips belong to the exploring state and disappear once chatting.
 * - Transcript is aria-live="polite"; motion respects prefers-reduced-motion.
 *
 * Sales starters always. CS / recruiting / vendor / appointments only after a
 * paying CS design-partner flag. AR is never offered here.
 *
 * PERSISTENCE
 * The transcript used to live in React state alone: a refresh, a navigation or a
 * closed tab destroyed the conversation, and nothing in the product showed what
 * a person had previously asked for. Threads are now saved to DSQL after every
 * settled exchange and are owner-scoped — your Home history is yours, not the
 * workspace's.
 *
 * The thread id is carried in ?thread=, so a conversation has a real address:
 * browser back works, and a thread can be reopened or linked to. Saving is
 * append-only by sequence, so re-sending the transcript is idempotent rather
 * than duplicating turns.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowRight, Cpu, History, Mail, Phone, Plus, Search, Sparkles } from 'lucide-react';
import { intentApi, threadsApi, type IntentPlanResponse, type IntentQuestion } from '@/api/client';
import type { Thread, ThreadSummary } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { VoiceInterface } from '@/components/app/VoiceInterface';
import { SEO } from '@/components/SEO';
import { useAuth, greetingNameOf } from '@/lib/auth/useAuth';
import { useTenant } from '@/lib/useTenant';
import { isPayingCsDesignPartner } from '@/lib/expansion';
import { ApiError } from '@/api/http';
import { cn } from '@/lib/utils';

const ease = [0.22, 1, 0.36, 1] as const;
const COLUMN = 'mx-auto w-full max-w-[768px] px-4 sm:px-6';
const STICK_THRESHOLD_PX = 100;
const TEXTAREA_MAX_PX = 200;

const STARTERS: { id: string; label: string; goal: string; href?: string; expansion?: boolean }[] = [
  { id: 'qualify_inbound', label: 'Qualify inbound leads', goal: 'Qualify inbound leads in Prospecting and prepare the first outreach.' },
  { id: 'quiet_deals', label: 'Chase deals quiet 14+ days', goal: 'Follow up deals that have been quiet for 14 days or more.' },
  { id: 'draft_outreach', label: 'Draft outreach for this list', goal: 'Draft first-touch outreach for the current contact list.' },
  { id: 'cs_renewal', label: 'Renewal check-ins (CS)', goal: 'Run customer-success check-ins and renewal discussions for current contacts.', expansion: true },
  { id: 'recruiting_coord', label: 'Recruiting follow-up', goal: 'Confirm interviews and keep candidates warm on the current contact list.', expansion: true },
  { id: 'vendor_ops', label: 'Vendor status checks', goal: 'Check delivery status with vendors on the current contact list.', expansion: true },
  { id: 'appointment_sched', label: 'Appointment reminders', goal: 'Send appointment reminders and collect confirmations for the current contact list.', expansion: true },
  { id: 'running_agents', label: 'Show running agents', goal: '', href: '/control-panel' },
];

type Turn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; kind: 'text'; text: string }
  | { id: string; role: 'assistant'; kind: 'error'; text: string }
  | { id: string; role: 'assistant'; kind: 'questions'; questions: IntentQuestion[]; answered: boolean }
  | { id: string; role: 'assistant'; kind: 'plan'; plan: IntentPlanResponse };

/**
 * Turn <-> stored row.
 *
 * `kind` and `data` are stored rather than flattening everything to text, so a
 * reopened thread renders as the real thing — the plan card is still a plan
 * card, the clarification is still a question set — instead of degrading into a
 * wall of prose. Question sets come back already answered: the thread has moved
 * on, and re-offering the buttons would invite an answer to a question the
 * server no longer has context for.
 */
function serialiseTurn(turn: Turn): { role: string; kind: string; body: string; data?: Record<string, unknown> } {
  if (turn.role === 'user') return { role: 'user', kind: 'text', body: turn.text };
  if (turn.kind === 'questions') {
    return { role: 'assistant', kind: 'questions', body: '', data: { questions: turn.questions } };
  }
  if (turn.kind === 'plan') {
    return { role: 'assistant', kind: 'plan', body: '', data: { plan: turn.plan } };
  }
  return { role: 'assistant', kind: turn.kind, body: turn.text };
}

function hydrateTurn(row: { role: string; kind: string; body: string; data?: Record<string, unknown> | null }): Turn {
  const id = newId();
  if (row.role === 'user') return { id, role: 'user', text: row.body };
  if (row.kind === 'questions') {
    return {
      id, role: 'assistant', kind: 'questions',
      questions: (row.data?.questions as IntentQuestion[] | undefined) ?? [],
      answered: true,
    };
  }
  if (row.kind === 'plan') {
    return { id, role: 'assistant', kind: 'plan', plan: row.data?.plan as IntentPlanResponse };
  }
  if (row.kind === 'error') return { id, role: 'assistant', kind: 'error', text: row.body };
  return { id, role: 'assistant', kind: 'text', text: row.body };
}

function whenLabel(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString();
}

function timeGreeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random()}`);

// ─── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  value, onChange, onSubmit, busy, autoFocus, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  autoFocus?: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with content to a cap, then scroll inside the field.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_PX)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/40 transition-shadow"
    >
      <label htmlFor="home-goal" className="sr-only">What should the agents do</label>
      <textarea
        id="home-goal"
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter is a newline. isComposing guards IME input,
          // where Enter commits a candidate rather than finishing the sentence.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[0.95rem] leading-relaxed text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
      />
      <div className="flex items-center justify-between gap-3 px-3 pb-2.5">
        <p className="text-[0.7rem] text-slate-400 dark:text-slate-600 select-none">
          <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift+Enter</kbd> for a new line
        </p>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Working…' : 'Continue'} <ArrowRight size={14} />
        </button>
      </div>
    </form>
  );
}

// ─── Turn renderers ───────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-[0.9rem] leading-relaxed text-white whitespace-pre-wrap break-words">
        {text}
      </p>
    </div>
  );
}

function AssistantCard({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'error' }) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3.5 text-[0.9rem] leading-relaxed',
        tone === 'error'
          ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200'
          : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1526] text-slate-700 dark:text-slate-200',
      )}
    >
      {children}
    </div>
  );
}

function PlanCard({
  plan, busy, onConfirm, onDismiss,
}: {
  plan: IntentPlanResponse;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const emptySegment = plan.targets.contactIds.length === 0;
  return (
    <AssistantCard>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-indigo-500" />
        <h2 className="text-[0.95rem] font-bold text-slate-900 dark:text-white">Plan</h2>
      </div>
      <p className="text-[0.86rem] text-slate-600 dark:text-slate-300 mb-4">{plan.plan.goal}</p>

      {plan.plan.voicePaywall && (
        <p className="text-[0.82rem] text-amber-700 dark:text-amber-300 mb-3">
          Voice is not included on Free. This plan will not place calls. Upgrade to Starter from Billing or Pricing.
        </p>
      )}

      <p className="text-[0.78rem] text-slate-500 dark:text-slate-500 mb-3">
        {plan.targets.label}: <span className="font-semibold text-slate-800 dark:text-slate-200">{plan.targets.contactIds.length}</span>
        {emptySegment ? ' — nothing to run yet' : ''}
      </p>

      <ol className="space-y-2 mb-4">
        {plan.plan.steps.map((step) => (
          <li key={`${step.agent}-${step.action}`} className="flex gap-2 text-[0.8rem] text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-indigo-600 dark:text-indigo-400 w-36 flex-shrink-0 capitalize">
              {step.agent.replace(/_/g, ' ')}
            </span>
            <span>{step.action}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-3 text-[0.75rem] text-slate-500 dark:text-slate-400 mb-4">
        <span className="inline-flex items-center gap-1"><Search size={12} /> {plan.plan.cost.enrichmentLookups} lookups</span>
        <span className="inline-flex items-center gap-1"><Mail size={12} /> {plan.plan.cost.emailSends} emails</span>
        <span className="inline-flex items-center gap-1"><Phone size={12} /> {plan.plan.cost.estimatedCallMinutes} min estimated calls</span>
        <span>Approval: {plan.plan.requiresApproval ? 'required before outbound' : 'relaxed for this tenant'}</span>
      </div>

      {emptySegment && (
        <p className="text-[0.82rem] text-amber-700 dark:text-amber-300 mb-3">
          This segment has no contacts. ImpulsoIQ will not invent rows. Import or seed contacts, then confirm.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || emptySegment}
          onClick={onConfirm}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 disabled:opacity-40"
        >
          Confirm and start
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/[0.1]"
        >
          Dismiss
        </button>
      </div>
    </AssistantCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { user } = useAuth();
  const tenant = useTenant(user?.tenantId);
  const expansionOn = isPayingCsDesignPartner(tenant);
  const starters = useMemo(() => STARTERS.filter((s) => !s.expansion || expansionOn), [expansionOn]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const reduceMotion = useReducedMotion();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [goal, setGoal] = useState(params.get('q') ?? '');
  const [starter, setStarter] = useState<string | undefined>(params.get('starter') ?? undefined);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // The goal this thread is about. Kept apart from the transcript because a
  // clarification answer is echoed as its own user turn — reading the goal back
  // off the last user turn would send "Email only" as the goal on the 2nd answer.
  const [threadGoal, setThreadGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [stick, setStick] = useState(true);

  // Saved threads. `threadId` null means this conversation has not been written
  // yet — the first save creates it and adopts the id the server returns.
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(params.get('thread'));
  const [historyOpen, setHistoryOpen] = useState(false);
  // How many turns the server already holds, so an unchanged transcript is not
  // re-sent on every render.
  const savedCount = useRef(0);
  const saving = useRef(false);
  const saveGen = useRef(0);
  const openedThread = useRef<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatting = turns.length > 0;

  const firstName = user ? greetingNameOf(user) : null;
  const hello = useMemo(
    () => (firstName ? `${timeGreeting(new Date())}, ${firstName}` : timeGreeting(new Date())),
    [firstName],
  );

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await threadsApi.list());
    } catch {
      // History is additive. If it cannot be read, the composer still works.
    }
  }, []);

  useEffect(() => { void refreshThreads(); }, [refreshThreads]);

  const openThread = useCallback(async (id: string) => {
    setHistoryOpen(false);
    try {
      const thread: Thread | null = await threadsApi.get(id);
      if (!thread) return;
      setTurns(thread.turns.map(hydrateTurn));
      setThreadGoal(thread.goal);
      setStarter(thread.starter ?? undefined);
      setAnswers({});
      setThreadId(thread.id);
      openedThread.current = thread.id;
      savedCount.current = thread.turns.length;
      setStick(true);
      // The address changes with the thread, so back returns to the previous one.
      setParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('thread', thread.id);
        next.delete('q');
        next.delete('starter');
        return next;
      }, { replace: false });
    } catch {
      // A thread that cannot be opened is left alone rather than half-loaded.
    }
  }, [setParams]);

  // Open from ?thread= when the address actually changes (history, refresh,
  // back). A stale mount ref used to re-open the previous thread after New.
  useEffect(() => {
    const id = params.get('thread');
    if (!id) {
      openedThread.current = null;
      return;
    }
    if (openedThread.current === id) return;
    openedThread.current = id;
    void openThread(id);
  }, [params, openThread]);

  function startNewThread() {
    saveGen.current += 1;
    openedThread.current = null;
    setTurns([]);
    setThreadGoal('');
    setAnswers({});
    setStarter(undefined);
    setGoal('');
    setThreadId(null);
    savedCount.current = 0;
    setHistoryOpen(false);
    setParams(new URLSearchParams(), { replace: true });
  }

  const append = useCallback((...next: Turn[]) => {
    setTurns((prev) => [
      // Old question sets stop being answerable once the thread moves on.
      ...prev.map((t) => (t.role === 'assistant' && t.kind === 'questions' ? { ...t, answered: true } : t)),
      ...next,
    ]);
  }, []);

  // Auto-scroll only while the reader is at the bottom; never fight a scroll-up.
  useEffect(() => {
    if (!stick) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy, stick]);

  // Save once an exchange has settled. Waiting for !busy means a thread is
  // written when it has an answer in it, not mid-request — and never on every
  // keystroke.
  useEffect(() => {
    if (busy || turns.length === 0) return;
    if (turns.length <= savedCount.current) return;
    if (saving.current) return;

    saving.current = true;
    const snapshot = turns.length;
    const gen = saveGen.current;
    const firstUser = turns.find(t => t.role === 'user');
    void (async () => {
      try {
        const res = await threadsApi.save({
          ...(threadId ? { id: threadId } : {}),
          title: (firstUser && firstUser.role === 'user' ? firstUser.text : threadGoal).slice(0, 200),
          goal: threadGoal,
          ...(starter ? { starter } : {}),
          turns: turns.map(serialiseTurn),
        });
        if (gen !== saveGen.current) return;
        savedCount.current = snapshot;
        if (!threadId && res.id) {
          setThreadId(res.id);
          openedThread.current = res.id;
          setParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('thread', res.id);
            return next;
          }, { replace: true });
        }
        void refreshThreads();
      } catch {
        // Losing a save must not interrupt the conversation on screen; the next
        // settled turn retries, and append-only means the retry cannot duplicate.
      } finally {
        saving.current = false;
      }
    })();
  }, [turns, busy, threadId, threadGoal, starter, setParams, refreshThreads]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX);
  }, []);

  const send = useCallback(async (
    text: string,
    nextStarter: string | undefined,
    nextAnswers: Record<string, string>,
    opts: { echo?: string } = {},
  ) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    if (opts.echo) append({ id: newId(), role: 'user', text: opts.echo });
    setBusy(true);
    setStick(true);

    try {
      const first = Object.keys(nextAnswers).length === 0;
      const res = first
        ? await intentApi.submitGoal({ goal: trimmed, starter: nextStarter, answers: nextAnswers })
        : await intentApi.resolve({ goal: trimmed, starter: nextStarter, answers: nextAnswers });

      if (res.status === 'navigate' && res.href) {
        navigate(res.href);
        return;
      }
      if (res.status === 'needs_clarification') {
        append({ id: newId(), role: 'assistant', kind: 'questions', questions: res.questions ?? [], answered: false });
        return;
      }
      if (res.status === 'plan' && res.plan && res.targets) {
        append({ id: newId(), role: 'assistant', kind: 'plan', plan: res as IntentPlanResponse });
        return;
      }
      append({ id: newId(), role: 'assistant', kind: 'error', text: 'Unexpected response from the intent service.' });
    } catch (err) {
      append({
        id: newId(),
        role: 'assistant',
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not submit that goal.',
      });
    } finally {
      setBusy(false);
    }
  }, [append, busy, navigate]);

  // ?intent=compose&q=…&starter=… — deep link from empty states elsewhere.
  useEffect(() => {
    const s = params.get('starter');
    if (!s) return;
    const found = STARTERS.find((x) => x.id === s);
    if (found?.expansion && !expansionOn) return;
    if (found?.goal && !params.get('q')) setGoal(found.goal);
  }, [params, expansionOn]);

  function submitComposer() {
    const text = goal.trim();
    if (!text) return;
    setAnswers({});
    setThreadGoal(text);
    void send(text, starter, {}, { echo: text });
    setGoal('');
  }

  function runStarter(s: typeof STARTERS[number]) {
    if (s.href) {
      navigate(s.href);
      return;
    }
    setStarter(s.id);
    setAnswers({});
    setGoal('');
    setThreadGoal(s.goal);
    void send(s.goal, s.id, {}, { echo: s.label });
  }

  function pickOption(q: IntentQuestion, optionId: string, optionLabel: string) {
    const next = { ...answers, [q.id]: optionId };
    setAnswers(next);
    void send(threadGoal, starter, next, { echo: optionLabel });
  }

  async function confirm(plan: IntentPlanResponse) {
    setBusy(true);
    try {
      const res = await intentApi.confirm({
        goal: plan.plan.goal,
        starter,
        answers,
        contactIds: plan.targets.contactIds,
      });
      navigate(res.inspectHref || `/control-panel?campaign=${res.campaignId}`);
    } catch (err) {
      append({
        id: newId(),
        role: 'assistant',
        kind: 'error',
        text: err instanceof ApiError || err instanceof Error ? err.message : 'Could not start the run.',
      });
    } finally {
      setBusy(false);
    }
  }

  // Recognition over recall: the last few threads are offered by name rather
  // than expecting anyone to remember what they asked yesterday.
  const recent = threads.slice(0, 6);

  const historyMenu = historyOpen && (
    <>
      <button
        type="button"
        aria-label="Close history"
        className="fixed inset-0 z-30 cursor-default"
        onClick={() => setHistoryOpen(false)}
      />
      <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#0d1526] shadow-xl overflow-hidden">
        {threads.length === 0 ? (
          <p className="px-4 py-5 text-center text-[0.8rem] text-slate-400 dark:text-slate-600">
            Nothing saved yet.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => void openThread(t.id)}
                  className={cn(
                    'w-full text-left px-4 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors',
                    t.id === threadId && 'bg-slate-50 dark:bg-white/[0.04]',
                  )}
                >
                  <span className="block text-[0.82rem] font-medium text-slate-800 dark:text-slate-100 line-clamp-2">
                    {t.title || 'Untitled'}
                  </span>
                  <span className="block text-[0.72rem] text-slate-400 dark:text-slate-600">
                    {whenLabel(t.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  const chips = (
    <div className="flex flex-wrap items-center gap-2">
      {starters.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => runStarter(s)}
          disabled={busy}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[0.78rem] font-semibold transition-colors disabled:opacity-50',
            starter === s.id
              ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
              : 'border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 hover:border-indigo-400',
          )}
        >
          {s.href ? <Cpu size={13} /> : null}
          {s.label}
        </button>
      ))}
    </div>
  );

  return (
    <AppShell contentScroll={false}>
      <SEO title="Home — ImpulsoIQ" description="Tell ImpulsoIQ what to do next" />

      <div className="flex flex-col h-full">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 min-h-0 overflow-y-auto"
        >
          {!chatting ? (
            // ── Empty state: one centred column, composer front and centre ──
            <div className={cn(COLUMN, 'min-h-full flex flex-col justify-center py-10')}>
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease }}
                className="text-center mb-7"
              >
                <div className="flex items-center justify-center gap-2.5 mb-2">
                  <h1 className="text-[1.75rem] sm:text-[2rem] font-extrabold tracking-tight text-slate-900 dark:text-white">
                    {hello}
                  </h1>
                  {/* Ambient assistant sits with the greeting: same conversation, other modality. */}
                  <VoiceInterface />
                </div>
                <p className="text-[0.92rem] text-slate-500 dark:text-slate-400 leading-relaxed max-w-[52ch] mx-auto">
                  Describe the outcome. We will clarify channels and approval, show the plan and cost,
                  then start a real campaign you can inspect.
                </p>
              </motion.div>

              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05, ease }}
              >
                <Composer
                  value={goal}
                  onChange={setGoal}
                  onSubmit={submitComposer}
                  busy={busy}
                  autoFocus
                  placeholder="e.g. Qualify inbound leads this week and email the ones that match our ICP"
                />
                <div className="mt-3 flex justify-center">{chips}</div>

                {/* Picking up where you left off is the most common intent on a
                    surface like this, so it is offered before anything is typed
                    rather than hidden behind a menu. */}
                {recent.length > 0 && (
                  <div className="mt-8">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-[0.72rem] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-600">
                        Pick up where you left off
                      </h2>
                      {threads.length > recent.length && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setHistoryOpen(o => !o)}
                            aria-expanded={historyOpen}
                            className="text-[0.74rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            All {threads.length}
                          </button>
                          {historyMenu}
                        </div>
                      )}
                    </div>
                    <ul className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1526] overflow-hidden">
                      {recent.map((t) => (
                        <li key={t.id} className="border-b border-slate-50 dark:border-white/[0.03] last:border-0">
                          <button
                            type="button"
                            onClick={() => void openThread(t.id)}
                            className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                          >
                            <span className="block text-[0.83rem] font-medium text-slate-800 dark:text-slate-100 truncate">
                              {t.title || 'Untitled'}
                            </span>
                            <span className="block text-[0.72rem] text-slate-400 dark:text-slate-600">
                              {whenLabel(t.updatedAt)}
                              {t.turnCount ? ` · ${t.turnCount} turns` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            </div>
          ) : (
            // ── Conversation: transcript above, composer docked below ──
            <div className={cn(COLUMN, 'py-6')}>
              {/* Where you are, and the two ways out of it. Without this a
                  conversation had no exit but the browser back button, and no
                  way to reach an earlier one. */}
              <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-100 dark:border-white/[0.05]">
                <span className="flex-1 min-w-0 text-[0.8rem] font-semibold text-slate-500 dark:text-slate-400 truncate">
                  {threads.find(t => t.id === threadId)?.title || threadGoal || 'New thread'}
                </span>
                <button
                  type="button"
                  onClick={startNewThread}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.76rem] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  <Plus size={13} /> New
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(o => !o)}
                    aria-expanded={historyOpen}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.76rem] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    <History size={13} /> History
                  </button>
                  {historyMenu}
                </div>
              </div>

              <div className="space-y-4" aria-live="polite" aria-busy={busy}>
              {turns.map((turn) => {
                if (turn.role === 'user') return <UserBubble key={turn.id} text={turn.text} />;
                if (turn.kind === 'error') return <AssistantCard key={turn.id} tone="error">{turn.text}</AssistantCard>;
                if (turn.kind === 'text') return <AssistantCard key={turn.id}>{turn.text}</AssistantCard>;
                if (turn.kind === 'plan') {
                  return (
                    <PlanCard
                      key={turn.id}
                      plan={turn.plan}
                      busy={busy}
                      onConfirm={() => void confirm(turn.plan)}
                      onDismiss={() => setTurns((prev) => prev.filter((t) => t.id !== turn.id))}
                    />
                  );
                }
                return (
                  <AssistantCard key={turn.id}>
                    <div className="space-y-4">
                      {turn.questions.map((q) => (
                        <div key={q.id}>
                          <p className="text-[0.88rem] font-semibold text-slate-800 dark:text-slate-100 mb-2.5">{q.prompt}</p>
                          <div className="flex flex-col gap-2">
                            {q.options.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={busy || turn.answered}
                                onClick={() => pickOption(q, opt.id, opt.label)}
                                className="text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] text-[0.82rem] font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-400 hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10 disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-transparent"
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </AssistantCard>
                );
              })}

              {busy && (
                <p className="text-[0.8rem] text-slate-400 dark:text-slate-500">Thinking…</p>
              )}
              </div>
            </div>
          )}
        </div>

        {chatting && (
          <div className="flex-shrink-0 border-t border-slate-200 dark:border-white/[0.06] bg-slate-50/95 dark:bg-[#020617]/95 backdrop-blur">
            <div className={cn(COLUMN, 'py-3 relative')}>
              {!stick && (
                <button
                  type="button"
                  onClick={() => {
                    const el = scrollRef.current;
                    if (el) el.scrollTop = el.scrollHeight;
                    setStick(true);
                  }}
                  className="absolute -top-11 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 dark:border-white/[0.12] bg-white dark:bg-[#0d1526] text-[0.75rem] font-semibold text-slate-600 dark:text-slate-300 shadow-sm"
                >
                  <ArrowDown size={12} /> Jump to latest
                </button>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <Composer
                    value={goal}
                    onChange={setGoal}
                    onSubmit={submitComposer}
                    busy={busy}
                    placeholder="Reply, or describe the next outcome…"
                  />
                </div>
                <div className="pb-1">
                  <VoiceInterface />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
