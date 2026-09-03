/**
 * Agent Registry — Phase 6B.
 *
 * Discoverable catalog of all agents, tools, and templates for enterprise
 * admins. Lets RevOps/IT see what is available without reading source code.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Cpu, Wrench, LayoutGrid } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

type EntryType = 'agent' | 'tool' | 'template';

interface RegistryEntry {
  entry_type:       EntryType;
  key:              string;
  name:             string;
  description:      string;
  version:          string;
  capabilities:     string[];
  phase_introduced: string;
  status:           string;
  metadata:         Record<string, unknown>;
}

// ── Static registry (mirrors registry-seeder Lambda data) ─────────────────────
const STATIC_REGISTRY: RegistryEntry[] = [
  // Agents
  { entry_type:'agent', key:'coordinator',        phase_introduced:'1', version:'1.0.0', status:'active', name:'Coordinator Agent',              description:'Plans, decomposes, and orchestrates all specialist agents using Graph topology.',            capabilities:['graph_orchestration','consent_enforcement','metering_check'], metadata:{model:'claude-sonnet',topology:'graph'} },
  { entry_type:'agent', key:'clarification',      phase_introduced:'1', version:'1.0.0', status:'active', name:'Clarification Agent',            description:'Turns ambiguous goals into fully-specified ones. Checks memory first; asks minimum questions.', capabilities:['memory_lookup','structured_questioning'],                        metadata:{model:'claude-haiku'} },
  { entry_type:'agent', key:'research-enrichment',phase_introduced:'2', version:'1.0.0', status:'active', name:'Research & Enrichment',          description:'Enriches contacts with firmographic data and ICP fit scores. Deterministic scoring.',          capabilities:['lead_enrichment','icp_scoring','memory_write'],                 metadata:{scoringIsDeterministic:true} },
  { entry_type:'agent', key:'outreach',           phase_introduced:'2', version:'1.0.0', status:'active', name:'Outreach & Drafting',            description:'Drafts and sends compliant, personalised email and SMS. Validates CAN-SPAM/CASL.',           capabilities:['email_draft','sms_draft','compliance_validation'],              metadata:{canSpamValidation:true} },
  { entry_type:'agent', key:'voice',              phase_introduced:'2', version:'1.0.0', status:'active', name:'Voice Agent (CALL-E)',            description:'Async outbound calls via CALL-E. Step Functions pauses until CallCompleted webhook.',         capabilities:['voice_call','dnc_check','async_sfn_wait'],                      metadata:{asyncPattern:'waitForTaskToken'} },
  { entry_type:'agent', key:'nurture',            phase_introduced:'2', version:'1.0.0', status:'active', name:'Nurture & Follow-up',            description:'Post-first-touch cadence. Evaluates engagement signals for next action decisions.',          capabilities:['engagement_monitoring','cadence_management'],                   metadata:{decisionIsDeterministic:true} },
  { entry_type:'agent', key:'forecasting-insight',phase_introduced:'3', version:'1.0.0', status:'active', name:'Forecasting & Insight',          description:'Daily pipeline forecast using deterministic stage-weighted calculation. LLM writes narratives.', capabilities:['pipeline_forecast','anomaly_detection','narrative_generation'], metadata:{forecastingIsDeterministic:true} },
  { entry_type:'agent', key:'data-hygiene',       phase_introduced:'3', version:'1.0.0', status:'active', name:'Data Hygiene',                   description:'Weekly duplicate/decay sweep. NEVER auto-applies — all proposals require human approval.',   capabilities:['duplicate_detection','decay_scan','approval_queue'],            metadata:{autoApplyForbidden:true} },
  { entry_type:'agent', key:'ambient-interface',  phase_introduced:'4', version:'1.0.0', status:'active', name:'Ambient Interface (Nova Sonic)', description:'Lets the professional talk to ImpulsoIQ by voice. Routes spoken goals into Coordinator.',  capabilities:['voice_input','morning_briefing','voice_approval'],               metadata:{model:'nova-sonic-v1'} },
  { entry_type:'agent', key:'deep-research',      phase_introduced:'4', version:'1.0.0', status:'active', name:'Deep Research (Swarm)',          description:'ONLY Swarm agent. 4 parallel sub-agents + synthesis. Requires explicit cost approval.',     capabilities:['swarm_orchestration','firmographic','technographic'],           metadata:{requiresApproval:true,estimatedTokens:37000} },
  { entry_type:'agent', key:'signal-listening',   phase_introduced:'4', version:'1.0.0', status:'active', name:'Signal Listening Agent (v3 new)', description:'Continuous public-signal monitoring to originate new candidate leads. Two-stage: Nova Micro classifier → Nova 2 Lite synthesis. Every candidate queued for human approval. Disabled by default — legal review required per source.', capabilities:['rss_monitoring','reddit_signals','press_release','candidate_origination','approval_queue'], metadata:{stage1Model:'nova-micro',stage2Model:'nova-lite',disabledByDefault:true,requiresLegalReview:true,neverDeanonymizes:true} },
  // Tools
  { entry_type:'tool', key:'crm.write_record',                phase_introduced:'1', version:'1.0.0', status:'active', name:'CRM Write Record',              description:'Single write path to Aurora DSQL. All agents use this; none write directly.',     capabilities:['dsql_write','audit_event_publish'],                    metadata:{singleWriterEnforced:true} },
  { entry_type:'tool', key:'crm.check_consent',               phase_introduced:'1', version:'1.0.0', status:'active', name:'Consent Gate',                  description:'Hard gate before any outbound action. Checks ConsentRecord in DSQL.',             capabilities:['consent_enforcement'],                                 metadata:{hardGate:true} },
  { entry_type:'tool', key:'crm.check_send_pause',            phase_introduced:'2', version:'1.0.0', status:'active', name:'Send Pause Gate',                description:'Checks SES reputation flag before email/SMS. Set by CloudWatch alarm.',           capabilities:['reputation_gate'],                                     metadata:{triggeredBy:'SES_alarms'} },
  { entry_type:'tool', key:'crm.check_metering_quota',        phase_introduced:'3', version:'2.0.0', status:'active', name:'Metering Quota Check',          description:'Real-time synchronous quota enforcement against DynamoDB metering table.',        capabilities:['quota_enforcement'],                                   metadata:{failOpenOnError:true} },
  { entry_type:'tool', key:'crm.validate_template_compliance',phase_introduced:'5', version:'1.0.0', status:'active', name:'Template Compliance Validator',  description:'5B fixed tone, FDCPA escalation threshold, channel restrictions.',               capabilities:['tone_validation','escalation_check'],                  metadata:{fdcpaEscalation:true} },
  // Templates
  { entry_type:'template', key:'recruiting_coordination',  phase_introduced:'5A', version:'1.0.0', status:'active', name:'Recruiting Coordination',        description:'Interview confirmation, scheduling, offer follow-up.',                           capabilities:['candidate_outreach','interview_scheduling'],   metadata:{requiresLegalReview:false} },
  { entry_type:'template', key:'accounts_receivable',      phase_introduced:'5B', version:'1.0.0', status:'active', name:'Accounts Receivable',            description:'Payment reminders — fixed tone, deterministic escalation, FDCPA-adjacent.',     capabilities:['payment_reminder','escalation_ladder'],        metadata:{requiresLegalReview:true,toneFixed:true} },
  { entry_type:'template', key:'vendor_ops_coordination',  phase_introduced:'5C', version:'1.0.0', status:'active', name:'Vendor & Ops Coordination',     description:'Supplier status checks with structured result extraction.',                      capabilities:['status_extraction'],                           metadata:{requiresLegalReview:false} },
  { entry_type:'template', key:'appointment_scheduling',   phase_introduced:'5D', version:'1.0.0', status:'active', name:'Appointment Scheduling',         description:'Highest-volume, least approval-gated. Binary confirm/reschedule/cancel.',       capabilities:['appointment_confirmation'],                    metadata:{approvalGateMode:'never'} },
  { entry_type:'template', key:'customer_success_renewal', phase_introduced:'5E', version:'1.0.0', status:'active', name:'Customer Success & Renewal',    description:'Churn prevention triggered by usage-decline ≥30% or renewal within 60 days.',   capabilities:['churn_prevention','renewal_discussion'],       metadata:{usesForecasting:true} },
];

const TYPE_CONFIG: Record<EntryType, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  agent:    { label: 'Agents',    icon: Cpu,        color: 'text-indigo-600 dark:text-indigo-400',  bg: 'bg-indigo-100 dark:bg-indigo-500/15'  },
  tool:     { label: 'Tools',     icon: Wrench,     color: 'text-amber-600 dark:text-amber-400',    bg: 'bg-amber-100 dark:bg-amber-500/15'    },
  template: { label: 'Templates', icon: LayoutGrid, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-500/15' },
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function RegistryPage() {
  const [filter, setFilter]  = useState<EntryType | 'all'>('all');
  const [search, setSearch]  = useState('');

  const entries = STATIC_REGISTRY.filter(e => {
    if (filter !== 'all' && e.entry_type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) ||
             e.key.toLowerCase().includes(q) || e.capabilities.some(c => c.includes(q));
    }
    return true;
  });

  const counts = {
    agent:    STATIC_REGISTRY.filter(e => e.entry_type === 'agent').length,
    tool:     STATIC_REGISTRY.filter(e => e.entry_type === 'tool').length,
    template: STATIC_REGISTRY.filter(e => e.entry_type === 'template').length,
  };

  return (
    <AppShell>
      <SEO title="Agent Registry — ImpulsoIQ" description="Discoverable catalog of all agents, tools, and templates" />
      <div className="px-4 sm:px-6 py-6">

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }} className="mb-6">
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-2">
            Phase 6B · Enterprise
          </div>
          <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-1">
            Agent Registry
          </h1>
          <p className="text-[0.84rem] text-slate-500 dark:text-slate-400">
            Complete catalog of {STATIC_REGISTRY.length} registered agents, tools, and workspace templates — discoverable by enterprise admins without reading source code.
          </p>
        </motion.div>

        {/* Filters + search */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/[0.04] rounded-xl p-1">
            {(['all', 'agent', 'tool', 'template'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('px-3 py-1.5 rounded-lg text-[0.8rem] font-semibold transition-all capitalize',
                  filter === f ? 'bg-white dark:bg-[#0d1526] text-slate-900 dark:text-white shadow-sm'
                               : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
                {f === 'all' ? `All (${STATIC_REGISTRY.length})` : `${f}s (${counts[f]})`}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-8 pr-3 text-sm rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition" />
          </div>
        </div>

        {/* Registry table */}
        <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
          <div className="grid px-5 py-2.5 border-b border-slate-100 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 bg-slate-50/60 dark:bg-white/[0.02]"
            style={{ gridTemplateColumns: '32px 1fr 60px 80px auto' }}>
            <span />
            <span>Entry</span>
            <span className="text-center">Phase</span>
            <span className="text-center">Version</span>
            <span>Capabilities</span>
          </div>
          {entries.length === 0 ? (
            <div className="py-12 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">No matching entries</div>
          ) : entries.map((e, i) => {
            const cfg = TYPE_CONFIG[e.entry_type];
            return (
              <motion.div key={`${e.entry_type}-${e.key}`}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                className="grid px-5 py-3 border-b border-slate-50 dark:border-white/[0.03] last:border-0 items-start hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                style={{ gridTemplateColumns: '32px 1fr 60px 80px auto' }}>
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
                  <cfg.icon size={13} className={cfg.color} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-200">{e.name}</p>
                    <code className="text-[0.65rem] font-mono text-slate-400 dark:text-slate-600">{e.key}</code>
                  </div>
                  <p className="text-[0.76rem] text-slate-500 dark:text-slate-400 leading-relaxed">{e.description}</p>
                </div>
                <span className="text-center text-[0.75rem] font-semibold text-indigo-600 dark:text-indigo-400 mt-1">
                  P{e.phase_introduced}
                </span>
                <span className="text-center text-[0.72rem] text-slate-400 dark:text-slate-600 font-mono mt-1">
                  v{e.version}
                </span>
                <div className="flex flex-wrap gap-1 max-w-[260px] mt-0.5">
                  {e.capabilities.slice(0, 3).map(c => (
                    <span key={c} className="text-[0.62rem] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-400">
                      {c}
                    </span>
                  ))}
                  {e.capabilities.length > 3 && (
                    <span className="text-[0.62rem] text-slate-400 dark:text-slate-600 self-center">
                      +{e.capabilities.length - 3}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

      </div>
    </AppShell>
  );
}
