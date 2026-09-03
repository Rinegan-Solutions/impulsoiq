import { useEffect, useRef, useState } from 'react';
import { motion, animate, useInView } from 'framer-motion';
import {
  TrendingUp, TrendingDown, ArrowRight, MoreHorizontal, ChevronRight, Zap, PhoneCall, Calendar, AlertTriangle, BarChart3,
} from 'lucide-react';
import { reportingApi } from '@/api/client';
import { cn } from '@/lib/utils';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';

// ─── Mock data ────────────────────────────────────────────────────────────────

const CAMPAIGNS = [
  { name: 'Q4 SaaS Outreach',       status: 'Running',   contacts: 1247, total: 2000, open: 24, reply: 8.3,  calls: 89,  meetings: 17 },
  { name: 'FinTech Decision Makers', status: 'Running',   contacts:  380, total:  800, open: 31, reply: 12.1, calls: 45,  meetings: 11 },
  { name: 'Enterprise Re-engagement',status: 'Running',   contacts:  891, total: 1500, open: 27, reply: 9.7,  calls: 112, meetings: 23 },
  { name: 'Healthcare Champions',    status: 'Paused',    contacts:  215, total:  500, open: 19, reply: 5.2,  calls: 23,  meetings:  4 },
  { name: 'Startup Growth Series',   status: 'Completed', contacts:  600, total:  600, open: 22, reply: 7.8,  calls: 67,  meetings: 14 },
];

const PIPELINE = [
  { stage: 'Prospecting',  count: 234, value: 0,      color: 'bg-slate-300 dark:bg-slate-600' },
  { stage: 'Qualified',    count:  89, value: 890000,  color: 'bg-indigo-400' },
  { stage: 'Demo Booked',  count:  34, value: 680000,  color: 'bg-violet-500' },
  { stage: 'Proposal',     count:  18, value: 540000,  color: 'bg-violet-600' },
  { stage: 'Negotiating',  count:   8, value: 320000,  color: 'bg-indigo-600' },
  { stage: 'Closed Won',   count:  31, value: 417500,  color: 'bg-emerald-500' },
];

type FeedType = 'research'|'outreach'|'voice'|'crm'|'coord';
const FEED_DATA: { type: FeedType; msg: string }[] = [
  { type: 'research', msg: 'Enriched Sarah Chen · Acme Corp · CTO · 3 intent signals' },
  { type: 'coord',    msg: 'Coordinator: routing Marcus Webb → Outreach agent' },
  { type: 'outreach', msg: 'Email sent → Priya Nair · Vantage AI · "Q4 growth efficiency"' },
  { type: 'voice',    msg: 'Call completed: Jennifer Park · demo booked 2026-09-05' },
  { type: 'crm',      msg: 'Deal created: Circlepoint · $48,000 · Stage: Qualified' },
  { type: 'research', msg: 'Found: Daniel Osei · CirclePoint · CRO · raised $45M Series B' },
  { type: 'outreach', msg: 'SMS sent → Aiko Tanaka · consent verified · reply-to enabled' },
  { type: 'voice',    msg: 'Voicemail left: Carlos Rivera · retry scheduled in 4h' },
  { type: 'crm',      msg: 'Intent: email opened ×3 · contact score raised to 87' },
  { type: 'coord',    msg: 'Approval gate triggered: Northvault · $120K ARR account' },
  { type: 'outreach', msg: 'Sequence paused: Lisa Chen replied → routed to AE' },
  { type: 'voice',    msg: 'Call initiated: Jordan Lee · NexaCo · qualification call' },
];

const FEED_LABEL: Record<FeedType, string> = { research:'Research', outreach:'Outreach', voice:'Voice', crm:'CRM', coord:'Coord' };
const FEED_CLS: Record<FeedType, string> = {
  research: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  outreach: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  voice:    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  crm:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  coord:    'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};

const TOP_CONTACTS = [
  { name: 'Sarah Chen',    company: 'Acme Corp',   title: 'CTO',     score: 94, activity: '2m ago',   stage: 'Demo Booked' },
  { name: 'Marcus Webb',   company: 'Strata Labs',  title: 'VP Sales', score: 87, activity: '8m ago',  stage: 'Qualified'   },
  { name: 'Priya Nair',    company: 'Vantage AI',   title: 'VP Eng',   score: 82, activity: '15m ago', stage: 'Qualified'   },
  { name: 'Jennifer Park', company: 'NexaCo',       title: 'COO',      score: 79, activity: '31m ago', stage: 'Demo Booked' },
  { name: 'Daniel Osei',   company: 'Circlepoint',  title: 'CRO',      score: 76, activity: '1h ago',  stage: 'Prospecting' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ease = [0.22, 1, 0.36, 1] as const;

function fmt(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n}`;
}

const STATUS_CLS: Record<string, string> = {
  Running:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  Paused:    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  Completed: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400',
};
const STATUS_DOT: Record<string, string> = {
  Running: 'bg-emerald-500', Paused: 'bg-amber-500', Completed: 'bg-indigo-500',
};

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({ data, positive = true }: { data: number[]; positive?: boolean }) {
  const w = 72, h = 28;
  const max = Math.max(...data), min = Math.min(...data);
  const r = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / r) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = positive ? '#10b981' : '#ef4444';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Animated counter ────────────────────────────────────────────────────────

function Counter({ to, prefix = '', suffix = '', dec = 0 }: { to: number; prefix?: string; suffix?: string; dec?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const ctrl = animate(0, to, {
      duration: 1.6, ease: [0.22, 1, 0.36, 1],
      onUpdate: v => { if (ref.current) ref.current.textContent = prefix + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString()) + suffix; },
    });
    return ctrl.stop;
  }, [inView, to, prefix, suffix, dec]);
  return <span ref={ref}>{prefix}0{suffix}</span>;
}

// ─── KPI card ────────────────────────────────────────────────────────────────

interface KPIProps { title: string; value: number; prefix?: string; suffix?: string; dec?: number; trend: number; sparkData: number[]; icon: React.ReactNode; iconBg: string }

function KPICard({ title, value, prefix = '', suffix = '', dec = 0, trend, sparkData, icon, iconBg }: KPIProps) {
  const pos = trend >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5 hover:shadow-md dark:hover:border-white/[0.1] transition-all duration-200"
    >
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', iconBg)}>
          {icon}
        </div>
        <Sparkline data={sparkData} positive={pos} />
      </div>
      <div className="text-[1.85rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-0.5 tabular-nums leading-none">
        <Counter to={value} prefix={prefix} suffix={suffix} dec={dec} />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[0.78rem] text-slate-500 dark:text-slate-400 font-medium">{title}</span>
        <span className={cn('inline-flex items-center gap-1 text-[0.72rem] font-bold px-1.5 py-0.5 rounded-md', pos ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400')}>
          {pos ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {Math.abs(trend)}%
        </span>
      </div>
    </motion.div>
  );
}

// ─── Campaign table ───────────────────────────────────────────────────────────

function CampaignTable() {
  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Active Campaigns</h3>
        <button className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          View all <ChevronRight size={12} />
        </button>
      </div>

      {/* Table head */}
      <div className="grid px-5 py-2.5 border-b border-slate-100 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600"
        style={{ gridTemplateColumns: '1fr 80px 140px 60px 60px 56px 56px 40px' }}>
        <span>Campaign</span><span>Status</span><span>Progress</span>
        <span className="text-center">Open</span><span className="text-center">Reply</span>
        <span className="text-center">Calls</span><span className="text-center">Mtgs</span>
        <span />
      </div>

      {CAMPAIGNS.map((c, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: i * 0.05, ease }}
          className="grid px-5 py-3 border-b border-slate-50 dark:border-white/[0.03] last:border-0 items-center text-[0.8rem] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors group"
          style={{ gridTemplateColumns: '1fr 80px 140px 60px 60px 56px 56px 40px' }}
        >
          <span className="font-semibold text-slate-800 dark:text-slate-200 truncate pr-3">{c.name}</span>

          <span className={cn('inline-flex items-center gap-1.5 text-[0.65rem] font-bold px-2 py-1 rounded-lg w-fit', STATUS_CLS[c.status])}>
            <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[c.status], c.status === 'Running' && 'animate-pulse')} />
            {c.status}
          </span>

          <div className="pr-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[0.68rem] text-slate-500 dark:text-slate-500">
                {c.contacts.toLocaleString()}<span className="text-slate-300 dark:text-slate-700">/{c.total.toLocaleString()}</span>
              </span>
              <span className="text-[0.68rem] text-slate-500 dark:text-slate-500">{Math.round(c.contacts / c.total * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/[0.07] overflow-hidden">
              <motion.div
                className={cn('h-full rounded-full', c.status === 'Completed' ? 'bg-indigo-400' : c.status === 'Paused' ? 'bg-amber-400' : 'bg-indigo-500')}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(c.contacts / c.total * 100)}%` }}
                transition={{ duration: 1, delay: 0.3 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>

          <span className="text-center font-semibold text-slate-700 dark:text-slate-300">{c.open}%</span>
          <span className="text-center font-semibold text-emerald-600 dark:text-emerald-400">{c.reply}%</span>
          <span className="text-center text-slate-600 dark:text-slate-400">{c.calls}</span>
          <span className="text-center font-semibold text-indigo-600 dark:text-indigo-400">{c.meetings}</span>

          <button className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-7 h-7 rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.07] text-slate-400 transition-all ml-auto">
            <MoreHorizontal size={14} />
          </button>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Pipeline stages ─────────────────────────────────────────────────────────

function PipelineFunnel() {
  const maxCount = Math.max(...PIPELINE.map(p => p.count));
  const totalValue = PIPELINE.filter(p => p.value > 0).reduce((s, p) => s + p.value, 0);

  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Pipeline Stages</h3>
        <span className="text-[0.78rem] font-bold text-indigo-600 dark:text-indigo-400">{fmt(totalValue)} tracked</span>
      </div>
      <div className="px-5 py-4 space-y-3">
        {PIPELINE.map((p, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: i * 0.06, ease }}
            className="group"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[0.78rem] font-medium text-slate-600 dark:text-slate-400">{p.stage}</span>
              <div className="flex items-center gap-3">
                <span className="text-[0.72rem] text-slate-400 dark:text-slate-600">{p.count} contacts</span>
                {p.value > 0 && <span className="text-[0.78rem] font-semibold text-slate-700 dark:text-slate-300">{fmt(p.value)}</span>}
              </div>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
              <motion.div
                className={cn('h-full rounded-full', p.color)}
                initial={{ width: 0 }}
                animate={{ width: `${(p.count / maxCount) * 100}%` }}
                transition={{ duration: 0.9, delay: 0.3 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Live agent activity ──────────────────────────────────────────────────────

function AgentFeed() {
  const [entries, setEntries] = useState<Array<{ type: FeedType; msg: string; time: string }>>([]);
  const idx = useRef(0);

  function makeEntry(offset = 0) {
    const d = FEED_DATA[idx.current++ % FEED_DATA.length];
    const t = new Date(Date.now() - offset);
    const time = [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
    return { ...d, time };
  }

  useEffect(() => {
    const initial = Array.from({ length: 6 }, (_, i) => makeEntry((6 - i) * 2000));
    setEntries(initial);
    const timer = setInterval(() => setEntries(p => [...p, makeEntry()].slice(-10)), 2200);
    return () => clearInterval(timer);
   
  }, []);

  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05] flex-shrink-0">
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Live Agent Activity</h3>
        <span className="flex items-center gap-1.5 text-[0.72rem] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-2.5 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          24 agents running
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 max-h-[320px]" role="log" aria-live="polite">
        {entries.map((e, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex items-baseline gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors text-[0.75rem] font-mono"
          >
            <span className="text-slate-400 dark:text-slate-600 text-[0.67rem] flex-shrink-0 w-[52px]">{e.time}</span>
            <span className={cn('text-[0.63rem] font-bold px-1.5 py-0.5 rounded flex-shrink-0 w-[60px] text-center', FEED_CLS[e.type])}>
              {FEED_LABEL[e.type]}
            </span>
            <span className="text-slate-600 dark:text-slate-400 truncate text-[0.72rem]">{e.msg}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Top contacts ─────────────────────────────────────────────────────────────

function TopContacts() {
  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Top Engaged Contacts</h3>
        <button className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          View all <ChevronRight size={12} />
        </button>
      </div>
      <div className="divide-y divide-slate-50 dark:divide-white/[0.04]">
        {TOP_CONTACTS.map((c, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.06, ease }}
            className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors group cursor-pointer"
          >
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-[0.65rem] font-bold flex items-center justify-center flex-shrink-0">
              {c.name.split(' ').map(n => n[0]).join('')}
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[0.82rem] font-semibold text-slate-800 dark:text-slate-200 truncate">{c.name}</span>
                <span className="text-[0.65rem] text-slate-400 dark:text-slate-600 flex-shrink-0">{c.activity}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[0.72rem] text-slate-500 dark:text-slate-500 truncate">{c.title} · {c.company}</span>
              </div>
            </div>
            {/* Score + stage */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className={cn('text-[0.67rem] font-bold px-1.5 py-0.5 rounded', c.score >= 90 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : c.score >= 80 ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400' : 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400')}>
                {c.score}
              </span>
              <span className="text-[0.67rem] text-slate-400 dark:text-slate-600">{c.stage}</span>
            </div>
            <ArrowRight size={13} className="text-slate-300 dark:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Phase 3: Forecast Panel ──────────────────────────────────────────────────

function ForecastPanel() {
  type Forecast = Awaited<ReturnType<typeof reportingApi.getForecast>>;
  const [data, setData]     = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    reportingApi.getForecast().then(setData).catch(() => void 0).finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!data)   return null;

  const { forecast, riskFlags, narratives } = data;
  const conversionPct = forecast.totalPipeline > 0
    ? Math.round((forecast.weightedForecast / forecast.totalPipeline) * 100)
    : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

      {/* Forecast summary */}
      <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
          <div className="flex items-center gap-2">
            <BarChart3 size={15} className="text-indigo-500 dark:text-indigo-400" />
            <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Pipeline Forecast</h3>
          </div>
          <span className="text-[0.72rem] text-slate-400 dark:text-slate-600">{forecast.period}</span>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-3 gap-4 mb-5">
            {[
              { label: 'Unweighted pipeline', value: `$${(forecast.totalPipeline/1000).toFixed(0)}K` },
              { label: 'Weighted forecast',   value: `$${(forecast.weightedForecast/1000).toFixed(0)}K`, accent: true },
              { label: 'Conversion rate',     value: `${conversionPct}%` },
            ].map((s, i) => (
              <div key={i}>
                <p className={`text-[1.3rem] font-extrabold tracking-tight ${s.accent ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-white'}`}>{s.value}</p>
                <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
          <ul className="space-y-2">
            {narratives.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-[0.8rem] text-slate-600 dark:text-slate-400">
                <span className="mt-1 w-1 h-1 rounded-full bg-indigo-400 dark:bg-indigo-500 flex-shrink-0" />
                {n}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Risk flags */}
      <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Stalled Deals</h3>
          </div>
          <span className="text-[0.72rem] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/20">
            {riskFlags.length} flagged
          </span>
        </div>
        <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
          {riskFlags.length === 0 ? (
            <p className="px-5 py-8 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">No stalled deals — pipeline looks healthy</p>
          ) : riskFlags.map((f, i) => (
            <motion.div
              key={f.dealId}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
              className="px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-200 truncate">{f.dealName}</p>
                  <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 mt-0.5">{f.stage} · ${(f.amount/1000).toFixed(0)}K</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className="text-[0.8rem] font-bold text-amber-600 dark:text-amber-400">{f.daysQuiet}d quiet</span>
                  <p className="text-[0.68rem] text-slate-400 dark:text-slate-600 mt-0.5">{f.xAboveMedian}× team median</p>
                </div>
              </div>
              {/* Days-quiet bar */}
              <div className="mt-2 h-1 rounded-full bg-slate-100 dark:bg-white/[0.07] overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-amber-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (f.daysQuiet / (f.teamMedian * 3)) * 100)}%` }}
                  transition={{ duration: 0.7, delay: 0.3 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <AppShell>
      <SEO title="Dashboard — ImpulsoIQ" description="Your AI revenue intelligence dashboard" />
      <div className="px-4 sm:px-6 py-6 max-w-[1600px] mx-auto">

        {/* Page header */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease }}
        >
          <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white">
            {greeting} 👋
          </h1>
          <p className="text-[0.84rem] text-slate-500 dark:text-slate-400 mt-0.5">
            Here's your revenue intelligence for {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.
          </p>
        </motion.div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KPICard
            title="Pipeline Value"
            value={2847500} prefix="$"
            dec={0}
            trend={18}
            sparkData={[1.8, 2.0, 1.9, 2.2, 2.4, 2.3, 2.6, 2.5, 2.8, 2.85]}
            icon={<Zap size={16} className="text-indigo-600 dark:text-indigo-400" />}
            iconBg="bg-indigo-100 dark:bg-indigo-500/15"
          />
          <KPICard
            title="Deals Won (month)"
            value={31}
            trend={12}
            sparkData={[18, 22, 20, 25, 24, 27, 26, 29, 30, 31]}
            icon={<Calendar size={16} className="text-emerald-600 dark:text-emerald-400" />}
            iconBg="bg-emerald-100 dark:bg-emerald-500/15"
          />
          <KPICard
            title="Agent Runs Today"
            value={1247}
            trend={31}
            sparkData={[700, 820, 780, 940, 890, 1050, 1100, 1180, 1220, 1247]}
            icon={<Zap size={16} className="text-violet-600 dark:text-violet-400" />}
            iconBg="bg-violet-100 dark:bg-violet-500/15"
          />
          <KPICard
            title="Meetings Booked"
            value={54}
            trend={22}
            sparkData={[28, 33, 31, 38, 36, 42, 44, 48, 51, 54]}
            icon={<PhoneCall size={16} className="text-amber-600 dark:text-amber-400" />}
            iconBg="bg-amber-100 dark:bg-amber-500/15"
          />
        </div>

        {/* Middle: campaigns + pipeline */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 mb-4">
          <CampaignTable />
          <PipelineFunnel />
        </div>

        {/* Bottom: agent feed + top contacts */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
          <AgentFeed />
          <TopContacts />
        </div>

        {/* Phase 3: Forecast + risk flags */}
        <ForecastPanel />

      </div>
    </AppShell>
  );
}
