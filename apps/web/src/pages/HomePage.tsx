/**
 * Home — goal composer → in-panel clarification → plan → confirm → ACP.
 *
 * Sales starters always. CS / recruiting / vendor / appointments only after
 * a paying CS design-partner flag. AR is never offered here.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Cpu, Mail, Phone, Search, Sparkles } from 'lucide-react';
import { intentApi, type IntentPlanResponse, type IntentQuestion } from '@/api/client';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { useAuth, displayNameOf } from '@/lib/auth/useAuth';
import { useTenant } from '@/lib/useTenant';
import { isPayingCsDesignPartner } from '@/lib/expansion';
import { ApiError } from '@/api/http';
import { cn } from '@/lib/utils';

const ease = [0.22, 1, 0.36, 1] as const;

const STARTERS: { id: string; label: string; goal: string; href?: string; expansion?: boolean }[] = [
  { id: 'qualify_inbound', label: 'Qualify inbound leads', goal: 'Qualify inbound leads in Prospecting and prepare the first outreach.' },
  { id: 'quiet_deals',     label: 'Chase deals quiet 14+ days', goal: 'Follow up deals that have been quiet for 14 days or more.' },
  { id: 'draft_outreach',  label: 'Draft outreach for this list', goal: 'Draft first-touch outreach for the current contact list.' },
  { id: 'cs_renewal',      label: 'Renewal check-ins (CS)', goal: 'Run customer-success check-ins and renewal discussions for current contacts.', expansion: true },
  { id: 'recruiting_coord', label: 'Recruiting follow-up', goal: 'Confirm interviews and keep candidates warm on the current contact list.', expansion: true },
  { id: 'vendor_ops',      label: 'Vendor status checks', goal: 'Check delivery status with vendors on the current contact list.', expansion: true },
  { id: 'appointment_sched', label: 'Appointment reminders', goal: 'Send appointment reminders and collect confirmations for the current contact list.', expansion: true },
  { id: 'running_agents',  label: 'Show running agents', goal: '', href: '/control-panel' },
];

function greeting(now: Date, name: string): string {
  const h = now.getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = name.split(/\s+/)[0] || name;
  return `${part}, ${first}`;
}

export default function HomePage() {
  const { user } = useAuth();
  const tenant = useTenant(user?.tenantId);
  const expansionOn = isPayingCsDesignPartner(tenant);
  const starters = STARTERS.filter((s) => !s.expansion || expansionOn);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const compose = params.get('intent') === 'compose';
  const [goal, setGoal] = useState(params.get('q') ?? '');
  const [starter, setStarter] = useState<string | undefined>(params.get('starter') ?? undefined);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<IntentQuestion[]>([]);
  const [plan, setPlan] = useState<IntentPlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const name = user ? displayNameOf(user) : 'there';
  const hello = useMemo(() => greeting(new Date(), name), [name]);

  useEffect(() => {
    if (compose) textareaRef.current?.focus();
    const s = params.get('starter');
    if (s) {
      const found = STARTERS.find((x) => x.id === s);
      if (found?.expansion && !expansionOn) return;
      if (found?.goal && !params.get('q')) setGoal(found.goal);
    }
  }, [compose, params, expansionOn]);

  async function submit(nextGoal: string, nextStarter?: string, nextAnswers: Record<string, string> = answers) {
    const text = nextGoal.trim();
    if (!text) {
      setError('Write what you want the agents to do.');
      return;
    }
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      const first = Object.keys(nextAnswers).length === 0;
      const res = first
        ? await intentApi.submitGoal({ goal: text, starter: nextStarter, answers: nextAnswers })
        : await intentApi.resolve({ goal: text, starter: nextStarter, answers: nextAnswers });
      if (res.status === 'navigate' && res.href) {
        navigate(res.href);
        return;
      }
      if (res.status === 'needs_clarification') {
        setQuestions(res.questions ?? []);
        return;
      }
      if (res.status === 'plan' && res.plan && res.targets) {
        setQuestions([]);
        setPlan(res as IntentPlanResponse);
        return;
      }
      setError('Unexpected response from intent service.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the goal.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await intentApi.confirm({
        goal: plan.plan.goal,
        starter,
        answers,
        contactIds: plan.targets.contactIds,
      });
      navigate(res.inspectHref || `/control-panel?campaign=${res.campaignId}`);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not start the run.');
    } finally {
      setBusy(false);
    }
  }

  function pickOption(questionId: string, value: string) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    void submit(goal, starter, next);
  }

  const emptySegment = plan && plan.targets.contactIds.length === 0;

  return (
    <AppShell>
      <SEO title="Home — ImpulsoIQ" description="Tell ImpulsoIQ what to do next" />
      <div className="px-4 sm:px-6 py-8 max-w-[760px]">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }}>
          <p className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-2">
            Home
          </p>
          <h1 className="text-[1.6rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">
            {hello}
          </h1>
          <p className="text-[0.88rem] text-slate-500 dark:text-slate-400 leading-relaxed">
            Describe the outcome. We will clarify channels and approval, show the plan and cost, then start a real campaign you can inspect.
          </p>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease }}
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(goal, starter);
          }}
        >
          <label htmlFor="home-goal" className="sr-only">What should we do</label>
          <textarea
            id="home-goal"
            ref={textareaRef}
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Qualify inbound leads this week and email the ones that match our ICP"
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-[0.95rem] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {starters.map((s) => (
              s.href ? (
                <Link
                  key={s.id}
                  to={s.href}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/[0.1] text-[0.78rem] font-semibold text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  <Cpu size={13} /> {s.label}
                </Link>
              ) : (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setStarter(s.id);
                    setGoal(s.goal);
                    setAnswers({});
                    setQuestions([]);
                    setPlan(null);
                    void submit(s.goal, s.id, {});
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[0.78rem] font-semibold transition-colors',
                    starter === s.id
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 hover:border-indigo-400',
                  )}
                >
                  {s.label}
                </button>
              )
            ))}
            <button
              type="submit"
              disabled={busy || !goal.trim()}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 disabled:opacity-40"
            >
              {busy ? 'Working…' : 'Continue'} <ArrowRight size={14} />
            </button>
          </div>
        </motion.form>

        {error && (
          <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-[0.82rem] text-amber-800 dark:text-amber-200">
            {error}
          </div>
        )}

        {questions.length > 0 && (
          <div className="mt-6 space-y-4">
            {questions.map((q) => (
              <div key={q.id} className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1526] p-4">
                <p className="text-[0.88rem] font-semibold text-slate-800 dark:text-slate-100 mb-3">{q.prompt}</p>
                <div className="flex flex-col gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={busy}
                      onClick={() => pickOption(q.id, opt.id)}
                      className="text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] text-[0.82rem] font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-400 hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {plan && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1526] p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-indigo-500" />
              <h2 className="text-[0.95rem] font-bold text-slate-900 dark:text-white">Plan</h2>
            </div>
            <p className="text-[0.84rem] text-slate-600 dark:text-slate-400 mb-4">{plan.plan.goal}</p>
            {plan.plan.voicePaywall && (
              <p className="text-[0.82rem] text-amber-800 dark:text-amber-200 mb-3">
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
                disabled={busy || Boolean(emptySegment)}
                onClick={() => void confirm()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 disabled:opacity-40"
              >
                Confirm and start
              </button>
              <button
                type="button"
                onClick={() => { setPlan(null); setQuestions([]); }}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/[0.1]"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </AppShell>
  );
}
