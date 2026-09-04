import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, animate, useInView } from 'framer-motion';
import { ChevronRight, Zap, PhoneCall, Calendar, BarChart3 } from 'lucide-react';
import { campaignsApi, contactsApi, dealsApi, agentRunsApi, dashboardApi } from '@/api/client';
import type { Campaign, Contact, Deal, AgentRun, DashboardStats } from '@/api/schemas';
import { cn } from '@/lib/utils';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';

// ─── Data ─────────────────────────────────────────────────────────────────────
// Everything on this screen now comes from crm-read. The previous version was
// a block of invented campaigns, pipeline figures, contacts and a looping
// activity ticker — all of it fabricated.

const STAGE_ORDER = [
  'Prospecting', 'Qualified', 'Demo Booked', 'Proposal', 'Negotiating', 'Closed Won',
] as const;

const STAGE_COLOR: Record<string, string> = {
  'Prospecting': 'bg-slate-300 dark:bg-slate-600',
  'Qualified':   'bg-indigo-400',
  'Demo Booked': 'bg-violet-500',
  'Proposal':    'bg-violet-600',
  'Negotiating': 'bg-indigo-600',
  'Closed Won':  'bg-emerald-500',
};

const RUN_CLS: Record<AgentRun['status'], string> = {
  running:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  paused:    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  completed: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  pending:   'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
  failed:    'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
};

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 py-10 text-center text-[0.82rem] text-slate-400 dark:text-slate-600">
      {children}
    </p>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// These were defined alongside the mock-data block and are still used
// throughout the page: shared easing, currency formatting, and the count-up
// animation on the KPI tiles.

const ease = [0.22, 1, 0.36, 1] as const;

function fmt(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n}`;
}

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

// trend and sparkData are gone: both need a time series, and nothing stores
// historical snapshots of these counters. A hardcoded "+18%" next to a live
// number is worse than no number at all.
interface KPIProps { title: string; value: number; prefix?: string; suffix?: string; dec?: number; icon: React.ReactNode; iconBg: string }

function KPICard({ title, value, prefix = '', suffix = '', dec = 0, icon, iconBg }: KPIProps) {
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
      </div>
      <div className="text-[1.85rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-0.5 tabular-nums leading-none">
        <Counter to={value} prefix={prefix} suffix={suffix} dec={dec} />
      </div>
      <span className="text-[0.78rem] text-slate-500 dark:text-slate-400 font-medium">{title}</span>
    </motion.div>
  );
}

// ─── Campaign table ───────────────────────────────────────────────────────────

function CampaignTable() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    campaignsApi.list()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Campaigns</h3>
        <Link to="/campaigns" className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          View all <ChevronRight size={12} />
        </Link>
      </div>

      {/* Open/Reply columns are gone: no event in the schema records an email
          being opened or replied to, so those numbers cannot be computed. */}
      <div className="grid px-5 py-2.5 border-b border-slate-100 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600"
        style={{ gridTemplateColumns: '1fr 90px 140px 60px 60px' }}>
        <span>Campaign</span><span>Status</span><span>Progress</span>
        <span className="text-center">Calls</span><span className="text-center">Mtgs</span>
      </div>

      {loading ? (
        <EmptyRow>Loading campaigns…</EmptyRow>
      ) : rows.length === 0 ? (
        <EmptyRow>No campaigns yet. Create one to start reaching contacts.</EmptyRow>
      ) : rows.map((c, i) => {
        const total = c.contactsTotal ?? 0;
        const touched = c.contactsTouched ?? 0;
        const pct = total > 0 ? Math.round((touched / total) * 100) : 0;
        return (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: i * 0.05, ease }}
            className="grid px-5 py-3 border-b border-slate-50 dark:border-white/[0.03] last:border-0 items-center text-[0.8rem] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
            style={{ gridTemplateColumns: '1fr 90px 140px 60px 60px' }}
          >
            <span className="font-semibold text-slate-800 dark:text-slate-200 truncate pr-2">{c.name}</span>
            <span className="text-[0.7rem] font-bold capitalize text-slate-500 dark:text-slate-400">{c.status}</span>
            <div className="pr-3">
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[0.65rem] text-slate-400 dark:text-slate-600 tabular-nums">{touched}/{total}</span>
            </div>
            <span className="text-center tabular-nums text-slate-600 dark:text-slate-400">{c.callsMade ?? 0}</span>
            <span className="text-center tabular-nums text-slate-600 dark:text-slate-400">{c.meetingsBooked ?? 0}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Pipeline stages ─────────────────────────────────────────────────────────

function PipelineFunnel() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dealsApi.list(1, 500)
      .then(r => setDeals(r.items))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, []);

  // Grouped client-side from the deal list rather than by a dedicated query:
  // one read serves both this and any future stage breakdown.
  const byStage = STAGE_ORDER.map(stage => {
    const inStage = deals.filter(d => d.stage === stage);
    return {
      stage,
      count: inStage.length,
      value: inStage.reduce((sum, d) => sum + d.amount, 0),
      color: STAGE_COLOR[stage],
    };
  });
  const maxCount = Math.max(1, ...byStage.map(p => p.count));
  const totalValue = byStage.reduce((s, p) => s + p.value, 0);

  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Pipeline Stages</h3>
        <span className="text-[0.78rem] font-bold text-indigo-600 dark:text-indigo-400">{fmt(totalValue)} tracked</span>
      </div>
      {loading ? (
        <EmptyRow>Loading pipeline…</EmptyRow>
      ) : deals.length === 0 ? (
        <EmptyRow>No deals yet.</EmptyRow>
      ) : (
        <div className="px-5 py-4 space-y-3">
          {byStage.map((p, i) => (
            <motion.div
              key={p.stage}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: i * 0.06, ease }}
              className="group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.76rem] font-semibold text-slate-600 dark:text-slate-400">{p.stage}</span>
                <span className="text-[0.72rem] tabular-nums text-slate-500 dark:text-slate-500">
                  {p.count}{p.value > 0 && <span className="text-slate-400 dark:text-slate-600"> · {fmt(p.value)}</span>}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', p.color)}
                  style={{ width: `${(p.count / maxCount) * 100}%` }} />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Live agent activity ──────────────────────────────────────────────────────

function AgentFeed() {
  // Was a setInterval cycling twelve hardcoded strings, which looked like live
  // agent activity and was not. These are the tenant's actual agent runs.
  // Genuinely live updates belong on the AppSync subscription (Phase 2G) —
  // this polls, which is honest about being a snapshot.
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      agentRunsApi.list(1, 10)
        .then(r => { if (alive) setRuns(r.items); })
        .catch(() => { if (alive) setRuns([]); })
        .finally(() => { if (alive) setLoading(false); });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Recent Agent Runs</h3>
        <Link to="/control-panel" className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          Control panel <ChevronRight size={12} />
        </Link>
      </div>
      {loading ? (
        <EmptyRow>Loading agent runs…</EmptyRow>
      ) : runs.length === 0 ? (
        <EmptyRow>No agent runs yet. Launch a campaign to put the agents to work.</EmptyRow>
      ) : (
        <div className="divide-y divide-slate-50 dark:divide-white/[0.04]">
          {runs.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3">
              <span className={cn('text-[0.63rem] font-bold px-1.5 py-0.5 rounded-lg flex-shrink-0', RUN_CLS[r.status])}>
                {r.status}
              </span>
              <span className="text-[0.8rem] text-slate-700 dark:text-slate-300 truncate flex-1">
                {r.agentType}
                {(r.firstName || r.lastName) && (
                  <span className="text-slate-400 dark:text-slate-600">
                    {' · '}{[r.firstName, r.lastName].filter(Boolean).join(' ')}
                  </span>
                )}
              </span>
              <span className="text-[0.7rem] tabular-nums text-slate-400 dark:text-slate-600 flex-shrink-0">
                {new Date(r.startedAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Top contacts ─────────────────────────────────────────────────────────────

function TopContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Ranked client-side by score. list_contacts orders by updated_at, and a
    // dedicated "top by score" query is not worth a round trip at this size.
    contactsApi.list(1, 100)
      .then(r => setContacts([...r.items].sort((x, y) => y.score - x.score).slice(0, 5)))
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Top Engaged Contacts</h3>
        <Link to="/contacts" className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          View all <ChevronRight size={12} />
        </Link>
      </div>
      {loading ? (
        <EmptyRow>Loading contacts…</EmptyRow>
      ) : contacts.length === 0 ? (
        <EmptyRow>No contacts yet. Import a list to get started.</EmptyRow>
      ) : (
        <div className="divide-y divide-slate-50 dark:divide-white/[0.04]">
          {contacts.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.06, ease }}
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-[0.65rem] font-bold flex items-center justify-center flex-shrink-0">
                {(c.firstName?.[0] ?? '') + (c.lastName?.[0] ?? '')}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.82rem] font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {c.firstName} {c.lastName}
                </p>
                <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 truncate">
                  {[c.title, c.accountName].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <span className="text-[0.72rem] font-bold tabular-nums text-indigo-600 dark:text-indigo-400 flex-shrink-0">
                {c.score}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Phase 3: Forecast Panel ──────────────────────────────────────────────────

// The Forecasting & Insight Agent writes its reports to the DynamoDB reporting
// table on a daily schedule. Nothing reads them back out yet — crm-read has no
// reporting operation and the table is not exposed through the API — so there
// is no forecast to render. This shows that plainly instead of charting numbers
// that were never computed.
//
// To make this live: add a reporting read (Lambda -> reporting table), expose it
// on the API, and restore the panel below from that response.
function ForecastPanel() {
  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-8 text-center">
      <BarChart3 className="mx-auto mb-3 text-slate-300 dark:text-slate-700" size={28} />
      <p className="text-[0.9rem] font-bold text-slate-700 dark:text-slate-300 mb-1">
        No forecast available yet
      </p>
      <p className="text-[0.8rem] text-slate-400 dark:text-slate-600 max-w-sm mx-auto">
        The Forecasting &amp; Insight Agent publishes a pipeline forecast on its
        daily schedule. Reports are not yet exposed through the API.
      </p>
    </div>
  );
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // One aggregate query backs all four KPI tiles.
  const [stats, setStats] = useState<DashboardStats | null>(null);
  useEffect(() => {
    dashboardApi.stats().then(setStats).catch(() => setStats(null));
  }, []);

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

        {/* KPI cards — all five values come from one aggregate query. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KPICard
            title="Pipeline Value"
            value={stats?.pipelineValue ?? 0} prefix="$"
            icon={<Zap size={16} className="text-indigo-600 dark:text-indigo-400" />}
            iconBg="bg-indigo-100 dark:bg-indigo-500/15"
          />
          <KPICard
            title="Contacts"
            value={stats?.totalContacts ?? 0}
            icon={<Calendar size={16} className="text-emerald-600 dark:text-emerald-400" />}
            iconBg="bg-emerald-100 dark:bg-emerald-500/15"
          />
          <KPICard
            title="Agents Running"
            value={stats?.runningAgents ?? 0}
            icon={<Zap size={16} className="text-violet-600 dark:text-violet-400" />}
            iconBg="bg-violet-100 dark:bg-violet-500/15"
          />
          <KPICard
            title="Active Campaigns"
            value={stats?.activeCampaigns ?? 0}
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
