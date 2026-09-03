/**
 * Workspace Templates — Phase 5.
 *
 * Browse and activate the 5 workspace templates that extend ImpulsoIQ
 * beyond sales into recruiting, AR, ops, scheduling, and customer success.
 *
 * Zero new agents — same 10 agents reconfigured with different:
 *   - Goal templates
 *   - Brand voice profiles
 *   - Compliance rules
 *   - Approval gate configurations
 *   - Trigger sources
 *
 * 5B (Accounts Receivable) requires legal review before activation.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, DollarSign, Truck, Calendar, HeartHandshake,
  AlertTriangle, Check, ChevronRight, Zap, Lock,
} from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { templatesApi } from '@/api/client';
import { cn } from '@/lib/utils';

// ── Template catalogue (mirrors coordinator/templates.py) ─────────────────────

interface TemplateDef {
  key:         string;
  phase:       string;
  name:        string;
  persona:     string;
  description: string;
  icon:        React.ElementType;
  iconColor:   string;
  iconBg:      string;
  agents:      string[];
  callTypes:   string[];
  maxTouches:  number;
  compliance:  string;
  complianceBadge: 'standard' | 'strict' | 'legal_required';
  trigger:     string;
  warningLabel?: string;
}

const TEMPLATES: TemplateDef[] = [
  {
    key: 'recruiting_coordination',
    phase: '5A', name: 'Recruiting Coordination', persona: 'Ines',
    description: 'Interview confirmation, scheduling messages, and offer follow-up cadence. Keeps candidates warm without consuming recruiter bandwidth.',
    icon: Users, iconColor: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-500/15',
    agents: ['Research', 'Outreach', 'Voice', 'Nurture'],
    callTypes: ['Interview confirmation', 'Scheduling', 'Offer follow-up'],
    maxTouches: 6, compliance: 'Employment communications', complianceBadge: 'standard',
    trigger: 'New candidate record',
  },
  {
    key: 'accounts_receivable',
    phase: '5B', name: 'Accounts Receivable Follow-up', persona: 'Renata',
    description: 'Payment reminders and escalation calls — strictest guardrails in the system. Tone is fixed; escalation is deterministic. Legal review required.',
    icon: DollarSign, iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    agents: ['Outreach', 'Voice', 'Nurture'],
    callTypes: ['Payment reminder', 'Status check'],
    maxTouches: 4, compliance: 'FDCPA-adjacent', complianceBadge: 'legal_required',
    trigger: 'Overdue invoice',
    warningLabel: 'Requires legal review before activation',
  },
  {
    key: 'vendor_ops_coordination',
    phase: '5C', name: 'Vendor & Ops Coordination', persona: 'Tomás',
    description: 'Automated supplier status checks that extract structured delivery status — on_schedule, delayed, or cancelled — and roll results into a dashboard.',
    icon: Truck, iconColor: 'text-cyan-600 dark:text-cyan-400', iconBg: 'bg-cyan-100 dark:bg-cyan-500/15',
    agents: ['Outreach', 'Voice'],
    callTypes: ['Delivery confirmation', 'Status check'],
    maxTouches: 3, compliance: 'B2B standard', complianceBadge: 'standard',
    trigger: 'Pending delivery',
  },
  {
    key: 'appointment_scheduling',
    phase: '5D', name: 'Appointment Scheduling & Reminders', persona: 'Sam',
    description: 'Highest-volume, lowest-complexity template. Binary confirm/reschedule/cancel outcomes — most automated, least approval-gated configuration in the system.',
    icon: Calendar, iconColor: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 dark:bg-emerald-500/15',
    agents: ['Outreach', 'Voice'],
    callTypes: ['Appointment reminder', 'Confirmation'],
    maxTouches: 2, compliance: 'Commercial services', complianceBadge: 'standard',
    trigger: 'Upcoming appointment',
  },
  {
    key: 'customer_success_renewal',
    phase: '5E', name: 'Customer Success & Renewal', persona: 'Grace',
    description: 'Proactive check-ins and save calls triggered by usage-decline signals or upcoming renewals. Uses the Forecasting agent for renewal-risk scoring.',
    icon: HeartHandshake, iconColor: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-100 dark:bg-violet-500/15',
    agents: ['Research', 'Outreach', 'Voice', 'Nurture', 'Forecasting'],
    callTypes: ['Check-in', 'Renewal discussion', 'Save call'],
    maxTouches: 8, compliance: 'Commercial communications', complianceBadge: 'standard',
    trigger: 'Usage decline ≥30% · Renewal within 60 days',
  },
];

const BADGE_CONFIG = {
  standard:       { label: 'Standard compliance', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  strict:         { label: 'Strict guardrails',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'  },
  legal_required: { label: 'Legal review required', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function WorkspaceTemplatesPage() {
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading]       = useState<string | null>(null);
  const [expanded, setExpanded]     = useState<string | null>(null);

  async function toggleTemplate(key: string, isActive: boolean) {
    setLoading(key);
    try {
      if (isActive) {
        await templatesApi.deactivate(key);
        setActiveKeys(p => { const n = new Set(p); n.delete(key); return n; });
      } else {
        await templatesApi.activate(key);
        setActiveKeys(p => new Set([...p, key]));
      }
    } catch { /* error */ }
    finally { setLoading(null); }
  }

  return (
    <AppShell>
      <SEO title="Workspace Templates — ImpulsoIQ" description="Activate workspace templates to extend agents beyond sales" />
      <div className="px-4 sm:px-6 py-6">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }} className="mb-7">
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-2">
            Phase 5 · Workspace Expansion
          </div>
          <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-1">
            Workspace Templates
          </h1>
          <p className="text-[0.84rem] text-slate-500 dark:text-slate-400 max-w-[560px]">
            The same 10 agents, reconfigured with new goals, tone profiles, compliance rules, and approval gates — serving departments beyond sales.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <span className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/20">
              <Zap size={11} /> Zero new agents
            </span>
            <span className="text-[0.75rem] text-slate-400 dark:text-slate-600">Same infrastructure, new configuration</span>
          </div>
        </motion.div>

        {/* Template grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {TEMPLATES.map((t, i) => {
            const isActive  = activeKeys.has(t.key);
            const isLoading = loading === t.key;
            const isExpanded = expanded === t.key;
            const badge     = BADGE_CONFIG[t.complianceBadge];

            return (
              <motion.div
                key={t.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07, duration: 0.4, ease }}
                className={cn(
                  'bg-white dark:bg-[#0d1526] border rounded-2xl overflow-hidden transition-all duration-200',
                  isActive
                    ? 'border-indigo-300 dark:border-indigo-500/40 shadow-md shadow-indigo-500/10'
                    : 'border-slate-200 dark:border-white/[0.065] hover:shadow-md dark:hover:border-white/[0.1]',
                )}
              >
                {/* Card header */}
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', t.iconBg)}>
                        <t.icon size={18} className={t.iconColor} />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[0.65rem] font-bold text-slate-400 dark:text-slate-600">{t.phase}</span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-[0.65rem] font-semibold text-slate-400 dark:text-slate-600">{t.persona}</span>
                        </div>
                        <h3 className="text-[0.88rem] font-bold text-slate-900 dark:text-white leading-snug">{t.name}</h3>
                      </div>
                    </div>
                    {isActive && (
                      <span className="flex items-center gap-1 text-[0.65rem] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/20 flex-shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                      </span>
                    )}
                  </div>

                  <p className="text-[0.8rem] text-slate-500 dark:text-slate-400 leading-relaxed mb-3">{t.description}</p>

                  {/* Compliance badge */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className={cn('inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded', badge.cls)}>
                      {t.complianceBadge === 'legal_required' ? <Lock size={9} /> : <Check size={9} />}
                      {badge.label}
                    </span>
                  </div>

                  {/* 5B warning */}
                  {t.warningLabel && (
                    <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl px-3 py-2.5 mb-3">
                      <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-[0.75rem] text-amber-700 dark:text-amber-300">{t.warningLabel}</p>
                    </div>
                  )}

                  {/* Agents + trigger */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {t.agents.map(a => (
                      <span key={a} className="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-400">
                        {a}
                      </span>
                    ))}
                  </div>
                  <p className="text-[0.72rem] text-slate-400 dark:text-slate-600">
                    <span className="font-semibold">Trigger:</span> {t.trigger}
                  </p>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 pb-4 pt-3 border-t border-slate-100 dark:border-white/[0.05] space-y-1.5">
                    {t.callTypes.map(ct => (
                      <div key={ct} className="flex items-center gap-2 text-[0.78rem] text-slate-500 dark:text-slate-400">
                        <span className="w-1 h-1 rounded-full bg-indigo-400 flex-shrink-0" />
                        {ct}
                      </div>
                    ))}
                    <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 pt-1">
                      Max touches: {t.maxTouches} · {t.compliance}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 px-5 pb-4">
                  <button
                    onClick={() => toggleTemplate(t.key, isActive)}
                    disabled={isLoading}
                    className={cn(
                      'flex-1 py-2.5 rounded-xl text-[0.84rem] font-semibold transition-all',
                      isActive
                        ? 'bg-slate-100 dark:bg-white/[0.07] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/[0.12]'
                        : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none',
                    )}
                  >
                    {isLoading ? '…' : isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : t.key)}
                    className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 dark:border-white/[0.1] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-white/20 transition-all"
                    aria-label="Toggle details"
                  >
                    <ChevronRight size={14} className={cn('transition-transform', isExpanded && 'rotate-90')} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Bottom note */}
        <p className="mt-6 text-center text-[0.78rem] text-slate-400 dark:text-slate-600">
          Phase 5 proof point: the same 10 agents carry ImpulsoIQ from a sales tool into a workspace-wide platform.
          Activating a template takes under 5 minutes.
        </p>

      </div>
    </AppShell>
  );
}
