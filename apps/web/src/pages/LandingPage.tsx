import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  motion, useMotionValue, useTransform, useSpring, AnimatePresence,
} from 'framer-motion';
import {
  ArrowRight, Check, Search, Mail, Phone, Database,
  LayoutGrid, Building2, ShieldCheck, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavBar } from '@/components/layout/NavBar';
import { Footer } from '@/components/layout/Footer';
import { SEO } from '@/components/SEO';
import { useMarketingCta } from '@/lib/marketingCta';

// ─── Types & constants ──────────────────────────────────────────────────────

type FeedType = 'research' | 'coord' | 'outreach' | 'voice' | 'crm';
interface FeedEntry { type: FeedType; msg: string; time: string }

// An illustration of the workflow, labelled as such in the UI. Steps only —
// no real or invented people, companies, or usage figures.
const FEED_DATA: { type: FeedType; msg: string }[] = [
  { type: 'research', msg: 'New lead enriched · role, company and 3 intent signals' },
  { type: 'coord',    msg: 'Coordinator: lead routed to Outreach agent' },
  { type: 'outreach', msg: 'Consent verified · personalised email sent' },
  { type: 'voice',    msg: 'Qualification call started' },
  { type: 'crm',      msg: 'Meeting booked · deal moved to Qualified' },
  { type: 'research', msg: 'Company brief built · funding and hiring signals' },
  { type: 'outreach', msg: 'Follow-up scheduled · day 3 of sequence' },
  { type: 'voice',    msg: 'No answer · voicemail left · retry scheduled' },
  { type: 'crm',      msg: 'Call outcome and transcript logged to contact' },
  { type: 'coord',    msg: 'Approval gate: high-value account awaiting review' },
  { type: 'outreach', msg: 'Reply received · sequence paused, routed to a rep' },
];

const FEED_LABEL: Record<FeedType, string> = {
  research: 'Research', coord: 'Coord', outreach: 'Outreach', voice: 'Voice', crm: 'CRM',
};

const FEED_CLASS_DARK: Record<FeedType, string> = {
  research: 'bg-indigo-500/15 text-indigo-300',
  coord:    'bg-violet-500/15 text-violet-300',
  outreach: 'bg-cyan-500/15 text-cyan-300',
  voice:    'bg-amber-500/15 text-amber-300',
  crm:      'bg-emerald-500/15 text-emerald-300',
};

const FEED_CLASS_LIGHT: Record<FeedType, string> = {
  research: 'bg-indigo-100 text-indigo-700',
  coord:    'bg-violet-100 text-violet-700',
  outreach: 'bg-cyan-100 text-cyan-700',
  voice:    'bg-amber-100 text-amber-700',
  crm:      'bg-emerald-100 text-emerald-700',
};

const STEPS = [
  {
    n: '01 / 05', icon: <Search size={20} />, color: 'bg-indigo-500/15 text-indigo-400',
    title: 'Research & Enrich',
    body: 'Agents find ICP-fit leads, verify emails through a multi-source waterfall, and enrich from attributed providers — never invented firmographics.',
    image: 'https://images.unsplash.com/photo-1551650975-87deedd944c3?w=900&fit=crop&q=80',
    caption: 'AI surfaces buying signals and builds a rich contact brief before any outreach lands.',
  },
  {
    n: '02 / 05', icon: <Mail size={20} />, color: 'bg-cyan-500/15 text-cyan-400',
    title: 'Personalized Outreach',
    body: 'Multi-touch email and SMS sequences — AI-written, research-grounded, consent-gated before every send.',
    image: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=900&fit=crop&q=80',
    caption: "Every message is tailored to the contact's role, company, and recent signals.",
  },
  {
    n: '03 / 05', icon: <Phone size={20} />, color: 'bg-amber-500/15 text-amber-400',
    title: 'AI Voice Calls',
    body: 'CALL-E powered qualification calls. The agent fires and the workflow pauses until the result arrives.',
    image: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=900&fit=crop&q=80',
    caption: 'Human-quality voice calls that qualify leads and book meetings autonomously.',
  },
  {
    n: '04 / 05', icon: <Database size={20} />, color: 'bg-emerald-500/15 text-emerald-400',
    title: 'Automatic CRM Update',
    body: 'Every email, call, and outcome writes to your CRM in real time. No manual entry. No missed updates.',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=900&fit=crop&q=80',
    caption: 'Your CRM stays perfect — updated within seconds of every agent action.',
  },
  {
    n: '05 / 05', icon: <Activity size={20} />, color: 'bg-violet-500/15 text-violet-400',
    title: 'Insights & Reporting',
    body: 'A live dashboard surfaces open rates, call outcomes, and pipeline velocity.',
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=900&fit=crop&q=80',
    caption: "Real-time analytics show what's working so your team can iterate faster.",
  },
];

const FEATURES = [
  {
    span: 'col-span-8', icon: <Search size={20} />, color: 'bg-indigo-500/15 text-indigo-500 dark:text-indigo-400',
    title: 'AI Research & Enrichment',
    body: 'Before any outreach lands, agents pull attributed firmographics and verified emails, then synthesize a contact brief that powers every message.',
    tag: 'Research Agent · Runs automatically',
  },
  {
    span: 'col-span-4', icon: <ShieldCheck size={20} />, color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    title: 'Consent-Gated by Default',
    body: 'Every email, SMS, and call checks a ConsentRecord before firing. Compliance is a hard gate, not a checkbox.',
    tag: 'Consent records · Audit trail',
  },
  {
    span: 'col-span-5', icon: <Phone size={20} />, color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    title: 'AI Voice Calls via CALL-E',
    body: 'Human-quality qualification and meeting-confirmation calls. Wrapped behind a VoiceProvider so you can swap vendors without touching your agents.',
    tag: 'Voice Agent · Async webhook-resumed',
  },
  {
    span: 'col-span-7', icon: <LayoutGrid size={20} />, color: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    title: 'Real-time Agent Control Panel',
    body: 'A live action log surfaces every agent decision the moment it happens. Pause a campaign, kill a run, or require approval before high-stakes actions fire.',
    tag: 'Control Panel · <5 s latency',
  },
  {
    span: 'col-span-6', icon: <Database size={20} />, color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
    title: 'Built-in CRM',
    body: 'Contacts, accounts, deals, and activities — all in one place. Every agent action is simultaneously the CRM record. No syncing, no data gaps.',
    tag: 'CRM · Aurora DSQL · Auto-logged',
  },
  {
    span: 'col-span-6', icon: <Building2 size={20} />, color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    title: 'Multi-workspace Architecture',
    body: "Built for agencies managing multiple client workspaces. Strict tenant isolation — one workspace never touches another's data.",
    tag: 'Multi-tenant · Enterprise-grade',
  },
];

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useColorScheme(): 'light' | 'dark' {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return dark ? 'dark' : 'light';
}

// ─── Animation helpers ──────────────────────────────────────────────────────

const ease = [0.22, 1, 0.36, 1] as const;

function FadeUp({ children, delay = 0, className }: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.6, delay, ease }}
    >
      {children}
    </motion.div>
  );
}

// ─── TiltCard ────────────────────────────────────────────────────────────────

function TiltCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [8, -8]), { stiffness: 150, damping: 18 });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-8, 8]), { stiffness: 150, damping: 18 });

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  };

  const handleLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ perspective: 1200, rotateX, rotateY, transformStyle: 'preserve-3d' }}
    >
      {children}
    </motion.div>
  );
}

// ─── Activity Terminal ──────────────────────────────────────────────────────

function ActivityTerminal() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const idxRef = useRef(0);

  const makeEntry = useCallback((offset = 0): FeedEntry => {
    const d = FEED_DATA[idxRef.current++ % FEED_DATA.length];
    const t = new Date(Date.now() - offset);
    const time = [t.getHours(), t.getMinutes(), t.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
    return { ...d, time };
  }, []);

  useEffect(() => {
    const initial = Array.from({ length: 6 }, (_, i) => makeEntry((6 - i) * 2100));
    setEntries(initial);
    const timer = setInterval(() => {
      setEntries(prev => [...prev, makeEntry()].slice(-9));
    }, 2000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const feedClass = isDark ? FEED_CLASS_DARK : FEED_CLASS_LIGHT;

  return (
    <div className={cn(
      'rounded-2xl overflow-hidden ring-1 ring-black/10',
      isDark
        ? 'bg-[#080e1d] border border-white/[0.075] shadow-2xl shadow-black/50'
        : 'bg-white border border-slate-200 shadow-xl',
    )}>
      {/* Title bar */}
      <div className={cn(
        'flex items-center gap-2 px-4 py-3 border-b',
        isDark ? 'border-white/[0.06] bg-white/[0.018]' : 'border-slate-200 bg-slate-50',
      )}>
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" aria-hidden="true" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" aria-hidden="true" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" aria-hidden="true" />
        <span className={cn('flex-1 text-center font-mono text-xs', isDark ? 'text-slate-500' : 'text-slate-400')}>
          ImpulsoIQ · Agent Activity
        </span>
        <span className="text-[0.65rem] font-bold text-indigo-400 bg-indigo-500/12 border border-indigo-500/25 px-2.5 py-0.5 rounded-full">
          Example
        </span>
      </div>
      {/* Context bar */}
      <div className={cn(
        'flex items-center justify-between px-4 py-2.5 border-b text-[0.72rem]',
        isDark ? 'border-white/[0.05]' : 'border-slate-100',
      )}>
        <span className={cn('font-medium', isDark ? 'text-slate-400' : 'text-slate-600')}>One lead, from first signal to CRM</span>
        <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>Illustrative</span>
      </div>
      {/* Feed */}
      <div
        className={cn(
          'px-3 py-3 min-h-[300px] max-h-[340px] overflow-hidden flex flex-col gap-0.5 font-mono text-[0.73rem]',
          isDark ? 'bg-[#080e1d]' : 'bg-white',
        )}
        role="log"
        aria-live="polite"
        aria-label="Example agent activity"
      >
        {entries.map((e, i) => (
          <motion.div
            key={i}
            className={cn(
              'grid gap-2 px-2 py-1.5 rounded-md transition-colors cursor-default',
              isDark ? 'hover:bg-white/[0.025]' : 'hover:bg-slate-50',
            )}
            style={{ gridTemplateColumns: '50px 68px 1fr' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <span className={cn('text-[0.68rem] self-baseline', isDark ? 'text-slate-600' : 'text-slate-400')}>{e.time}</span>
            <span className={cn('text-[0.64rem] font-bold px-1.5 py-0.5 rounded text-center self-baseline', feedClass[e.type])}>
              {FEED_LABEL[e.type]}
            </span>
            <span className={cn('text-[0.7rem] truncate', isDark ? 'text-slate-400' : 'text-slate-800')}>{e.msg}</span>
          </motion.div>
        ))}
        <div className="px-2 py-1">
          <span className="inline-block w-[7px] h-[13px] bg-indigo-400 align-middle animate-blink" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero() {
  const { to, inApp } = useMarketingCta();
  return (
    <section id="hero" className="relative min-h-[85svh] flex items-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-white via-slate-50/80 to-indigo-50/40 dark:from-[#020617] dark:via-[#020617] dark:to-[#020617]" />

      {/* Ambient orbs */}
      <div className="absolute -top-40 -right-16 w-[560px] h-[560px] rounded-full bg-indigo-100/60 dark:bg-indigo-600/10 blur-[130px] animate-float-slow pointer-events-none" aria-hidden="true" />
      <div className="absolute -bottom-20 -left-16 w-[480px] h-[480px] rounded-full bg-violet-100/50 dark:bg-violet-600/8 blur-[130px] animate-float-mid pointer-events-none" aria-hidden="true" />

      {/* Content */}
      <div className="relative z-10 w-full max-w-[1380px] mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 items-center py-4 pt-[32px] lg:pt-[8px]">

        {/* Left: copy */}
        <div>
          <motion.h1
            className="text-[2.9rem] sm:text-[3.6rem] lg:text-[4.25rem] font-extrabold leading-[1.04] tracking-[-0.045em] text-slate-900 dark:text-white mb-5"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease }}
          >
            Your revenue team,{' '}
            <span className="gradient-text">amplified by agents.</span>
          </motion.h1>

          <motion.p
            className="text-lg text-slate-600 dark:text-slate-400 leading-[1.72] max-w-[500px] mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.14, ease }}
          >
            Autonomous agents that research leads, draft outreach, and — on paid plans —
            place qualification calls, with a Control Panel, consent gates, and an audit trail.
            This is a workspace, not a promise to replace your SDR.
          </motion.p>

          <motion.div
            className="flex flex-wrap gap-3 mb-9"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.26, ease }}
          >
            <Link
              to={to}
              className="relative inline-flex items-center gap-2 px-6 py-3.5 font-semibold text-white rounded-xl overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/35 hover:-translate-y-0.5 transition-all duration-200"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/12 to-transparent -translate-x-full animate-shimmer" aria-hidden="true" />
              {inApp ? 'Open workspace' : 'Open your workspace'}
              <ArrowRight size={16} />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 px-5 py-3.5 font-semibold rounded-xl border border-slate-300 dark:border-white/[0.15] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-white/30 hover:bg-slate-100/60 dark:hover:bg-white/[0.04] transition-all duration-200"
            >
              See how it works
            </a>
          </motion.div>

          <motion.div
            className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-500"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.44 }}
          >
            <ShieldCheck size={16} className="text-emerald-500 flex-shrink-0" aria-hidden="true" />
            <span>Consent checked before every email, SMS and call · Every agent action audited</span>
          </motion.div>
        </div>

        {/* Right: terminal with tilt */}
        <motion.div
          initial={{ opacity: 0, x: 44 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.85, delay: 0.18, ease }}
        >
          <TiltCard>
            <ActivityTerminal />
          </TiltCard>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Logo Strip ──────────────────────────────────────────────────────────────

function LogoStrip() {
  const items = [
    'B2B SaaS Teams', 'Revenue Operations', 'SDR Managers', 'Sales Leadership',
    'FinTech Startups', 'HealthTech Orgs', 'Enterprise Sales', 'Growth Teams',
    'GTM Leaders', 'Account Executives',
  ];
  return (
    <div className="border-y border-slate-200 dark:border-white/[0.065] bg-slate-50/60 dark:bg-white/[0.012] py-6 overflow-hidden" aria-label="Who ImpulsoIQ is built for">
      <p className="text-center text-[1.22rem] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-600 mb-4">
        Built for
      </p>
      <div className="overflow-hidden">
        <motion.div
          className="flex items-center gap-14 whitespace-nowrap"
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 35, ease: 'linear', repeat: Infinity }}
        >
          {[...items, ...items].map((item, i) => (
            <span
              key={i}
              className="text-[1.7rem] font-extrabold uppercase tracking-tight text-slate-700 dark:text-slate-300 select-none"
            >
              {item}
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

// ─── How It Works (sticky scroll + image panel) ───────────────────────────────

function HowItWorks() {
  const [active, setActive] = useState(0);

  // Auto-advance every 4 s; clicking a step resets the timer
  useEffect(() => {
    const t = setInterval(() => setActive(p => (p + 1) % STEPS.length), 4000);
    return () => clearInterval(t);
  }, [active]);

  const step = STEPS[active];

  return (
    <section id="how" className="py-20 bg-slate-50 dark:bg-[#080e1d]">
      <div className="px-4 sm:px-6 max-w-[1380px] mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">

          {/* Left: header + clickable step list together */}
          <div>
            <FadeUp className="mb-8">
              <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-3">
                How it works
              </div>
              <h2 className="text-[2rem] sm:text-[2.5rem] font-extrabold tracking-[-0.035em] text-slate-900 dark:text-white mb-3">
                Five autonomous steps.<br />One filled pipeline.
              </h2>
              <p className="text-[1rem] text-slate-500 dark:text-slate-400 leading-relaxed">
                Agents research, draft, and wait for your approval. Voice is metered on paid plans. You stay in the Control Panel.
              </p>
            </FadeUp>
            <div className="flex flex-col gap-2">
            {STEPS.map((s, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={cn(
                  'text-left px-5 py-4 rounded-2xl transition-all duration-300 focus-visible:outline-2 focus-visible:outline-indigo-500',
                  active === i
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                    : 'bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.065] text-slate-700 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:bg-indigo-50/50 dark:hover:bg-white/[0.06]',
                )}
              >
                <div className="flex items-center gap-3 mb-1">
                  <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                    active === i ? 'bg-white/20' : s.color,
                  )} aria-hidden="true">
                    {s.icon}
                  </span>
                  <span className="font-bold text-[0.95rem] leading-snug">{s.title}</span>
                </div>
                <AnimatePresence initial={false}>
                  {active === i && (
                    <motion.p
                      key="body"
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="text-white/80 text-[0.84rem] leading-relaxed overflow-hidden"
                    >
                      {s.body}
                    </motion.p>
                  )}
                </AnimatePresence>
                {/* Progress bar for active step */}
                {active === i && (
                  <motion.div
                    key={`bar-${i}`}
                    className="mt-3 h-0.5 rounded-full bg-white/30 overflow-hidden"
                  >
                    <motion.div
                      className="h-full bg-white/80 origin-left"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 4, ease: 'linear' }}
                    />
                  </motion.div>
                )}
              </button>
            ))}
            </div>{/* end step list */}
          </div>{/* end left column */}

          {/* Right: image panel — vertically centered, constrained size */}
          <div className="flex items-center justify-center">
          <div className="relative w-full max-w-[480px] h-[400px] sm:h-[460px] rounded-2xl overflow-hidden shadow-2xl mx-auto">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active}
                initial={{ x: '-100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
              >
                <img
                  src={step.image}
                  className="w-full h-full object-cover"
                  alt={step.title}
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-7 text-white">
                  <h3 className="text-[1.4rem] font-extrabold mb-1.5 leading-snug">{step.title}</h3>
                  <p className="text-sm text-white/75 leading-relaxed max-w-md">{step.caption}</p>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Step indicator dots */}
            <div className="absolute top-4 right-4 flex gap-1.5 z-10">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  aria-label={`Step ${i + 1}: ${STEPS[i].title}`}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-300',
                    active === i ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70',
                  )}
                />
              ))}
            </div>
          </div>
          </div>{/* end right flex wrapper */}

        </div>
      </div>
    </section>
  );
}

// ─── Features Bento ──────────────────────────────────────────────────────────

function Features() {
  return (
    <section id="features" className="py-20 px-4 sm:px-6 bg-white dark:bg-[#020617]">
      <FadeUp className="max-w-[1280px] mx-auto mb-8">
        <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-3">Platform capabilities</div>
        <h2 className="text-[2rem] sm:text-[2.5rem] font-extrabold tracking-[-0.035em] text-slate-900 dark:text-white">
          Everything your revenue team needs.
        </h2>
      </FadeUp>

      <div className="max-w-[1280px] mx-auto grid grid-cols-12 gap-3">
        {FEATURES.map((f, i) => (
          <motion.div
            key={i}
            className={cn(
              'relative overflow-hidden rounded-2xl p-5 flex flex-col border transition-all duration-300',
              'bg-slate-50 border-slate-200/80 hover:bg-white hover:shadow-md',
              'dark:bg-white/[0.028] dark:border-white/[0.065] dark:hover:bg-white/[0.055] dark:hover:border-white/[0.11]',
              'hover:-translate-y-1',
              f.span, 'max-[900px]:col-span-12 max-[640px]:col-span-12',
            )}
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.1 }}
            transition={{ duration: 0.5, delay: i * 0.065, ease }}
          >
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-slate-300/50 dark:via-white/[0.07] to-transparent" aria-hidden="true" />
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-4', f.color)} aria-hidden="true">
              {f.icon}
            </div>
            <h3 className="text-[0.95rem] font-bold tracking-tight text-slate-900 dark:text-white mb-1.5">{f.title}</h3>
            <p className="text-[0.845rem] text-slate-500 dark:text-slate-400 leading-relaxed flex-1">{f.body}</p>
            <div className="mt-4 text-[0.65rem] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-600">{f.tag}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ─── Control Panel Preview ───────────────────────────────────────────────────

// Illustrative rows for the marketing preview: roles and industries only, no
// real or invented people or companies.
const PW_ROWS = [
  { contact: 'VP Sales · FinTech',         status: 'Running', statusCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', agent: 'Voice',    btn: 'Pause' },
  { contact: 'Head of RevOps · SaaS',      status: 'Running', statusCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', agent: 'Outreach', btn: 'Kill' },
  { contact: 'CTO · HealthTech',           status: 'Paused',  statusCls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',         agent: 'Research', btn: 'Resume' },
  { contact: 'CRO · Logistics',            status: 'Done',    statusCls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',      agent: 'CRM',      btn: 'View' },
  { contact: 'Founder · B2B Marketplace',  status: 'Running', statusCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', agent: 'Voice',    btn: 'Pause' },
];

function ControlPanelPreview() {
  const { to, inApp } = useMarketingCta();
  return (
    <section id="panel" className="py-20 px-4 sm:px-6 bg-slate-50 dark:bg-[#080e1d]">
      <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">

        {/* Panel mockup */}
        <FadeUp>
          <div className="bg-white border border-slate-200 shadow-xl dark:bg-[#080e1d] dark:border-white/[0.075] dark:shadow-2xl dark:shadow-black/30 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-slate-50 border-slate-200 dark:bg-white/[0.02] dark:border-white/[0.06]">
              <span className="text-[0.82rem] font-semibold text-slate-900 dark:text-white">Agent Control Panel</span>
              <span className="text-[0.68rem] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-500/12 border border-indigo-200 dark:border-indigo-500/25 px-2.5 py-0.5 rounded-full">
                Example
              </span>
            </div>
            {/* Table head */}
            <div
              className="grid px-5 py-2 border-b border-slate-200 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-600"
              style={{ gridTemplateColumns: '1fr 80px 72px 60px' }}
            >
              <span>Contact</span><span>Status</span><span>Agent</span><span />
            </div>
            {/* Rows */}
            {PW_ROWS.map((r, i) => (
              <div
                key={i}
                className="grid px-5 py-2.5 border-b border-slate-100 dark:border-white/[0.03] last:border-0 items-center text-[0.75rem] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                style={{ gridTemplateColumns: '1fr 80px 72px 60px' }}
              >
                <span className="text-slate-700 dark:text-slate-400 truncate min-w-0">{r.contact}</span>
                <span className={cn('text-[0.63rem] font-bold px-1.5 py-0.5 rounded self-center text-center', r.statusCls)}>{r.status}</span>
                <span className="text-slate-500 dark:text-slate-600 text-[0.7rem]">{r.agent}</span>
                <span aria-hidden="true" className="text-[0.67rem] font-semibold px-2 py-1 rounded bg-slate-100 dark:bg-white/[0.055] text-slate-600 dark:text-slate-400 text-center">{r.btn}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-white/[0.015] border-t border-slate-200 dark:border-white/[0.04] text-[0.72rem] text-slate-500">
              <span>Illustrative preview</span>
              <Link to={inApp ? '/control-panel' : to} className="text-indigo-600 dark:text-indigo-400 font-semibold hover:opacity-75 transition-opacity">
                {inApp ? 'Open Control Panel →' : 'Try it on your pipeline →'}
              </Link>
            </div>
          </div>
        </FadeUp>

        {/* Copy */}
        <div>
          <FadeUp delay={0.1}>
            <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-3">Agent Control Panel</div>
            <h2 className="text-[2rem] sm:text-[2.5rem] font-extrabold tracking-[-0.035em] text-slate-900 dark:text-white mb-4">
              You're always<br />in command.
            </h2>
            <p className="text-[1rem] text-slate-500 dark:text-slate-400 leading-relaxed mb-7 max-w-[440px]">
              See every agent decision the moment it happens. Pause a campaign, kill a run, or set approval gates for high-stakes outreach — the agents wait for your green light.
            </p>
            <ul className="flex flex-col gap-3.5">
              {[
                'Live action log with <5 second latency',
                'Pause, resume, or kill any run instantly',
                'Configurable approval gates per action type',
                'Full audit trail retained for 7 years',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-[0.9rem] text-slate-600 dark:text-slate-400">
                  <span className="mt-0.5 w-4 h-4 flex-shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
                    <Check size={10} className="text-emerald-600 dark:text-emerald-400" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </FadeUp>
        </div>

      </div>
    </section>
  );
}

// ─── CTA Section ─────────────────────────────────────────────────────────────

function CTASection() {
  const { to, startLabel } = useMarketingCta();
  return (
    <section id="cta" className="py-24 px-4 sm:px-6 bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700 relative overflow-hidden">
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: 'radial-gradient(circle at 70% 50%, rgba(255,255,255,0.15) 0%, transparent 60%)',
      }} aria-hidden="true" />
      <FadeUp className="relative z-10 max-w-[680px] mx-auto text-center">
        <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-200 mb-4">Get started</div>
        <h2 className="text-[2rem] sm:text-[3rem] font-extrabold tracking-[-0.045em] text-white leading-[1.08] mb-4">
          Run your first sequence
<br />under a Control Panel.
        </h2>
        <p className="text-[1.05rem] text-indigo-200 leading-relaxed mb-8 max-w-[500px] mx-auto">
          Set consent, inspect the graph, approve the send. Voice is on Starter and above.
        </p>
        <div className="flex justify-center flex-wrap gap-3">
          <Link
            to={to}
            className="inline-flex items-center gap-2 px-6 py-3.5 font-semibold text-indigo-700 bg-white rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            {startLabel}
            <ArrowRight size={16} />
          </Link>
          <a
            href="#how"
            className="inline-flex items-center gap-2 px-5 py-3.5 font-semibold text-white rounded-xl border border-white/30 hover:border-white/60 hover:bg-white/10 transition-all"
          >
            See how it works
          </a>
        </div>
        <p className="mt-5 text-[0.78rem] text-indigo-300">
          Consent-gated by default · Full audit trail
        </p>
      </FadeUp>
    </section>
  );
}

// ─── Scroll progress ─────────────────────────────────────────────────────────

function ScrollProgress() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const h = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setPct(total > 0 ? (window.scrollY / total) * 100 : 0);
    };
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  return (
    <div
      className="fixed top-0 left-0 h-[2px] z-[500] bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-400 pointer-events-none transition-[width] duration-75"
      style={{ width: `${pct}%` }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Page scroll progress"
    />
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen font-sans antialiased bg-white dark:bg-[#020617] text-slate-900 dark:text-white overflow-x-hidden">
      <SEO
        title="ImpulsoIQ — Agentic workspace for revenue teams"
        description="CRM, sequences, and AI agents under a Control Panel. Consent before every outbound action. Voice on paid plans."
        canonical="https://impulsoiq.rinegansolutions.com/"
      />
      <ScrollProgress />
      <NavBar />
      <Hero />
      <LogoStrip />
      <HowItWorks />
      <Features />
      <ControlPanelPreview />
      <CTASection />
      <Footer />
    </div>
  );
}
