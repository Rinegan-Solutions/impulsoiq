import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, PhoneCall, Mail, Users } from 'lucide-react';
import { analyticsApi } from '@/api/client';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

interface Analytics {
  replyRateTrend:  number[];
  meetingsTrend:   number[];
  callOutcomes:    { answered: number; voicemail: number; noAnswer: number; busy: number };
  topSequences:    { name: string; replies: number; meetings: number; rate: number }[];
  contactsAdded:   number[];
  months:          string[];
}

// ─── Reusable SVG line chart ──────────────────────────────────────────────────

function LineChart({ data, color = '#6366f1', label, unit = '' }: { data: number[]; color?: string; label: string; unit?: string }) {
  const w = 500, h = 80;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const fill = `0,${h} ${pts} ${w},${h}`;
  const last = data[data.length - 1];

  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[0.85rem] font-bold text-slate-700 dark:text-slate-300">{label}</p>
        <span className="text-[1.1rem] font-extrabold text-slate-900 dark:text-white">{last}{unit}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[80px] overflow-visible">
        <defs>
          <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fill} fill={`url(#grad-${label})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={(data.length-1)/(data.length-1)*w} cy={h - ((last-min)/range)*(h-8)-4} r="3.5" fill={color} />
      </svg>
    </div>
  );
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function BarChart({ data, labels, color = '#6366f1', label }: { data: number[]; labels: string[]; color?: string; label: string }) {
  const max = Math.max(...data) || 1;
  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5">
      <p className="text-[0.85rem] font-bold text-slate-700 dark:text-slate-300 mb-4">{label}</p>
      <div className="flex items-end gap-1.5 h-[80px]">
        {data.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <motion.div
              className="w-full rounded-t-md"
              style={{ backgroundColor: color }}
              initial={{ height: 0 }}
              animate={{ height: `${(v / max) * 72}px` }}
              transition={{ duration: 0.7, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {labels.map((l, i) => (
          <p key={i} className="flex-1 text-center text-[0.6rem] text-slate-400 dark:text-slate-600">{l}</p>
        ))}
      </div>
    </div>
  );
}

// ─── Donut chart ──────────────────────────────────────────────────────────────

function DonutChart({ data }: { data: Analytics['callOutcomes'] }) {
  const total  = data.answered + data.voicemail + data.noAnswer + data.busy;
  const slices = [
    { label: 'Answered',   value: data.answered,  color: '#10b981' },
    { label: 'Voicemail',  value: data.voicemail,  color: '#6366f1' },
    { label: 'No answer',  value: data.noAnswer,   color: '#94a3b8' },
    { label: 'Busy',       value: data.busy,        color: '#f59e0b' },
  ];

  let offset = 0;
  const r = 36, cx = 50, cy = 50, circ = 2 * Math.PI * r;

  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-5">
      <p className="text-[0.85rem] font-bold text-slate-700 dark:text-slate-300 mb-4">Call Outcomes</p>
      <div className="flex items-center gap-5">
        <div className="flex-shrink-0">
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth="14" className="text-slate-100 dark:text-white/[0.06]" />
            {slices.map((s, i) => {
              const pct = s.value / total;
              const dash = pct * circ;
              const gap  = circ - dash;
              const rot  = offset * 360 - 90;
              offset += pct;
              return (
                <motion.circle
                  key={i} cx={cx} cy={cy} r={r} fill="none"
                  stroke={s.color} strokeWidth="14"
                  strokeDasharray={`${dash} ${gap}`}
                  strokeLinecap="butt"
                  style={{ transform: `rotate(${rot}deg)`, transformOrigin: '50px 50px' }}
                  initial={{ strokeDasharray: `0 ${circ}` }}
                  animate={{ strokeDasharray: `${dash} ${gap}` }}
                  transition={{ duration: 1, delay: i * 0.15, ease: [0.22, 1, 0.36, 1] }}
                />
              );
            })}
            <text x="50" y="46" textAnchor="middle" className="fill-slate-900 dark:fill-white" fontSize="12" fontWeight="800">{total}</text>
            <text x="50" y="58" textAnchor="middle" className="fill-slate-400" fontSize="7">total calls</text>
          </svg>
        </div>
        <div className="flex flex-col gap-2 flex-1">
          {slices.map(s => (
            <div key={s.label} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-[0.75rem] text-slate-600 dark:text-slate-400">{s.label}</span>
              </div>
              <span className="text-[0.75rem] font-semibold text-slate-800 dark:text-slate-200">{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data, setData]     = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    analyticsApi.get().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading || !data) return (
    <AppShell>
      <div className="flex-1 flex items-center justify-center h-full text-slate-400 dark:text-slate-600">
        Loading analytics…
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <SEO title="Analytics — ImpulsoIQ" description="Revenue and campaign analytics" />
      <div className="px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Analytics</h1>
          <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">Last 12 months · Updated in real time</p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Avg reply rate',   value: `${(data.replyRateTrend.slice(-1)[0]).toFixed(1)}%`, icon: <Mail size={14} />,     color: 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' },
            { label: 'Meetings / month', value: data.meetingsTrend.slice(-1)[0],                       icon: <TrendingUp size={14} />,color: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
            { label: 'Total calls',      value: data.callOutcomes.answered + data.callOutcomes.voicemail + data.callOutcomes.noAnswer + data.callOutcomes.busy, icon: <PhoneCall size={14} />, color: 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400' },
            { label: 'Contacts added',   value: data.contactsAdded.reduce((s, v) => s + v, 0),         icon: <Users size={14} />,     color: 'bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400' },
          ].map((k, i) => (
            <motion.div key={i} initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*0.06, ease:[0.22,1,0.36,1] }}
              className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-4">
              <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center mb-3', k.color)} aria-hidden="true">{k.icon}</div>
              <p className="text-[1.6rem] font-extrabold tracking-tight text-slate-900 dark:text-white">{k.value}</p>
              <p className="text-[0.75rem] text-slate-500 dark:text-slate-400 mt-0.5">{k.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LineChart data={data.replyRateTrend}  label="Reply rate trend"     unit="%" color="#6366f1" />
            <LineChart data={data.meetingsTrend}   label="Meetings booked"              color="#10b981" />
            <BarChart  data={data.contactsAdded}   labels={data.months}  label="Contacts added per month" color="#8b5cf6" />
            <DonutChart data={data.callOutcomes} />
          </div>

          {/* Top sequences table */}
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
              <h3 className="text-[0.88rem] font-bold text-slate-900 dark:text-white">Top Sequences</h3>
              <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 mt-0.5">Ranked by meeting conversion</p>
            </div>
            <div className="divide-y divide-slate-50 dark:divide-white/[0.04]">
              {data.topSequences.map((s, i) => (
                <motion.div key={i} initial={{ opacity:0, x:10 }} animate={{ opacity:1, x:0 }} transition={{ delay:i*0.07, ease:[0.22,1,0.36,1] }}
                  className="px-5 py-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[0.8rem] font-semibold text-slate-800 dark:text-slate-200 truncate pr-4">{s.name}</p>
                    <span className="text-[0.8rem] font-extrabold text-indigo-600 dark:text-indigo-400 flex-shrink-0">{s.rate}%</span>
                  </div>
                  <div className="flex items-center gap-4 text-[0.7rem] text-slate-400 dark:text-slate-600 mb-2">
                    <span>{s.replies} replies</span>
                    <span>{s.meetings} meetings</span>
                  </div>
                  <div className="h-1 rounded-full bg-slate-100 dark:bg-white/[0.07] overflow-hidden">
                    <motion.div className="h-full rounded-full bg-indigo-500"
                      initial={{ width: 0 }} animate={{ width: `${s.rate}%` }}
                      transition={{ duration: 0.8, delay: 0.3 + i*0.07, ease:[0.22,1,0.36,1] }} />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
