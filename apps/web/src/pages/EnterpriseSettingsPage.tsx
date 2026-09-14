/**
 * Enterprise Settings — Phase 6D.
 *
 * SSO/SAML, SOC 2 control mapping, and the jurisdiction rules outbound
 * communication is designed around.
 *
 * WHAT CHANGED AND WHY
 * "Test connection" waited 1.5 s and reported "Connection verified" for any
 * string starting with "http"; "Save & activate SSO" did nothing; the
 * jurisdiction switches were component state that reset on reload; and the
 * SOC 2 list was titled "Type II" with a dead "View report" link and statuses
 * the infrastructure does not support (e.g. MFA "implemented" on a pool with
 * MFA off). There is no SAML identity provider or user-pool domain in Terraform
 * and no persisted compliance configuration, so this screen now states what is
 * actually in place rather than simulating controls.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Lock, Globe2, AlertTriangle, Info } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';
import { tenantApi } from '@/api/client';
import { useAuth, roleOf } from '@/lib/auth/useAuth';

type Section = 'sso' | 'soc2' | 'compliance';

const SECTIONS = [
  { id: 'sso' as const,        label: 'SSO / SAML',        icon: Lock,   desc: 'Single sign-on' },
  { id: 'soc2' as const,       label: 'SOC 2 Controls',    icon: Shield, desc: 'Control mapping' },
  { id: 'compliance' as const, label: 'Jurisdictions',     icon: Globe2, desc: 'Communication rules' },
];

const IDP_TYPES = [
  { key: 'okta',     label: 'Okta',             logo: 'OK' },
  { key: 'azure_ad', label: 'Microsoft Entra',  logo: 'MS' },
  { key: 'google',   label: 'Google Workspace', logo: 'G'  },
  { key: 'generic',  label: 'Generic SAML 2.0', logo: 'S'  },
];

type ControlStatus = 'implemented' | 'partial' | 'planned';

// Each status is backed by what infra-backend actually provisions.
const SOC2_CONTROLS: { id: string; name: string; status: ControlStatus; note: string }[] = [
  { id: 'CC6.1', name: 'Logical access controls',        status: 'implemented', note: 'Cognito groups (admin, manager, member) and a tenant claim check on every API call' },
  { id: 'CC6.6', name: 'Kill switch / pause outbound',   status: 'implemented', note: 'Control Panel pause and account kill stop Step Functions executions' },
  { id: 'CC6.2', name: 'Multi-factor authentication',    status: 'planned',     note: 'MFA is not yet enabled on the user pool' },
  { id: 'CC6.3', name: 'Access removal on termination',  status: 'partial',     note: 'Manual administrator action' },
  { id: 'CC7.1', name: 'System monitoring',              status: 'implemented', note: 'CloudTrail with alarms for root sign-in, unauthorised API calls and MFA deactivation' },
  { id: 'CC7.2', name: 'Vulnerability detection',        status: 'planned',     note: 'Container image scanning is not yet enabled' },
  { id: 'CC8.1', name: 'Change management',              status: 'implemented', note: 'Terraform plan → manual approval → apply pipeline' },
  { id: 'CC9.1', name: 'Vendor risk management',         status: 'partial',     note: 'Sub-processor review in progress' },
  { id: 'A1.1',  name: 'Availability monitoring',        status: 'partial',     note: 'Alarms on security events and email deliverability; service availability alarms in progress' },
  { id: 'C1.1',  name: 'Confidentiality',                status: 'implemented', note: 'AWS-managed encryption at rest; TLS 1.2+ in transit' },
  { id: 'P1.1',  name: 'Privacy notice',                 status: 'implemented', note: 'Privacy policy published at /privacy' },
  { id: 'P4.1',  name: 'Data retention limits',          status: 'partial',     note: 'Audit events retained in DynamoDB; per-workspace retention settings in progress' },
  { id: 'P5.1',  name: 'Data subject requests',          status: 'implemented', note: 'Admins export or erase a contact (consent + call metadata) from Settings → Privacy' },
];

const JURISDICTIONS = [
  { key: 'us', label: 'United States',  rules: 'CAN-SPAM, TCPA, FTC Act', channels: ['email', 'sms', 'call'] },
  { key: 'eu', label: 'European Union', rules: 'GDPR Article 6(1)(a)',    channels: ['email', 'sms', 'call'] },
  { key: 'ca', label: 'Canada',         rules: 'CASL, PIPEDA',            channels: ['email', 'sms', 'call'] },
  { key: 'uk', label: 'United Kingdom', rules: 'UK GDPR, PECR',           channels: ['email', 'sms', 'call'] },
  { key: 'au', label: 'Australia',      rules: 'Spam Act, Privacy Act',   channels: ['email', 'sms'] },
];

const STATUS_CLS: Record<ControlStatus, string> = {
  implemented: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  partial:     'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  planned:     'bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-400',
};

const STATUS_LABEL: Record<ControlStatus, string> = {
  implemented: '✓ Implemented',
  partial:     '⟳ Partial',
  planned:     '○ Planned',
};

const ease = [0.22, 1, 0.36, 1] as const;

const PANEL_CLS = 'bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden';

export default function EnterpriseSettingsPage() {
  const [active, setActive] = useState<Section>('sso');
  const { user } = useAuth();
  const canEdit = !!user && (roleOf(user) === 'admin' || roleOf(user) === 'manager');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [provider, setProvider] = useState('okta');
  const [ssoNotice, setSsoNotice] = useState<string | null>(null);

  async function submitSso() {
    setSsoNotice(null);
    try {
      await tenantApi.saveSsoIntent({ metadataUrl, provider });
      setSsoNotice('Saved. This does not turn SSO on. An operator still attaches the IdP on the environment Cognito pool (one IdP per environment today).');
    } catch (err) {
      setSsoNotice(err instanceof Error ? err.message : 'Could not save metadata');
    }
  }

  return (
    <AppShell>
      <SEO title="Enterprise Settings — ImpulsoIQ" description="SSO, SOC 2, and compliance" />
      <div className="px-4 sm:px-6 py-6 max-w-[960px]">

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }} className="mb-6">
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-2">Enterprise</div>
          <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-1">Enterprise Settings</h1>
          <p className="text-[0.84rem] text-slate-500 dark:text-slate-400">Single sign-on, SOC 2 control status, and jurisdiction rules.</p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-5">

          {/* Sidebar */}
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-2 h-fit">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setActive(s.id)}
                className={cn('w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all',
                  active === s.id
                    ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]')}>
                <s.icon size={15} />
                <div>
                  <p className="text-[0.84rem] font-medium">{s.label}</p>
                  <p className="text-[0.68rem] text-slate-400 dark:text-slate-600">{s.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Content */}
          <AnimatePresence mode="wait">
            <motion.div key={active} initial={{ opacity:0, x:10 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-10 }} transition={{ duration:0.25, ease }}>

              {/* ── SSO / SAML ── */}
              {active === 'sso' && (
                <div className="space-y-4">
                  <div className={PANEL_CLS}>
                    <div className="px-6 py-4 border-b border-slate-100 dark:border-white/[0.05]">
                      <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Lock size={15} className="text-indigo-500" /> Single sign-on
                      </h3>
                    </div>
                    <div className="px-6 py-5 space-y-5">
                      <div className="flex items-start gap-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.07] rounded-xl px-4 py-3.5">
                        <Info size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 mt-0.5" />
                        <p className="text-[0.82rem] text-slate-600 dark:text-slate-300 leading-relaxed">
                          SAML is not self-serve at the Cognito pool. Submit your metadata URL so operators can attach it at the environment IdP. This screen will not report “Connection verified.”
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Identity provider</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {IDP_TYPES.map(idp => (
                            <button key={idp.key} type="button" onClick={() => setProvider(idp.key)}
                              className={cn('flex flex-col items-center gap-1.5 p-3 rounded-xl border text-[0.78rem] font-semibold',
                                provider === idp.key ? 'border-indigo-500 text-indigo-600' : 'border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-400')}>
                              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-[0.7rem] font-bold flex items-center justify-center">{idp.logo}</span>
                              {idp.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Metadata URL</span>
                        <input
                          value={metadataUrl}
                          onChange={(e) => setMetadataUrl(e.target.value)}
                          placeholder="https://idp.example.com/app/sso/saml/metadata"
                          className="mt-1.5 w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm"
                        />
                      </label>
                      {ssoNotice && <p className="text-[0.82rem] text-amber-800 dark:text-amber-200">{ssoNotice}</p>}
                      {canEdit ? (
                        <button type="button" onClick={() => void submitSso()} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600">
                          Submit metadata
                        </button>
                      ) : (
                        <p className="text-[0.8rem] text-slate-400">Admins and managers can submit metadata.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── SOC 2 Controls ── */}
              {active === 'soc2' && (
                <div className={PANEL_CLS}>
                  <div className="px-6 py-4 border-b border-slate-100 dark:border-white/[0.05]">
                    <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Shield size={15} className="text-emerald-500" /> SOC 2 control mapping
                    </h3>
                    <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-0.5">
                      Self-assessed against the Trust Services Criteria. This is not an audit report.
                    </p>
                  </div>
                  <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
                    {SOC2_CONTROLS.map(c => (
                      <div key={c.id} className="flex items-start gap-4 px-6 py-3.5">
                        <code className="text-[0.68rem] font-mono font-bold text-slate-400 dark:text-slate-600 mt-0.5 w-[48px] flex-shrink-0">{c.id}</code>
                        <div className="flex-1 min-w-0">
                          <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-200">{c.name}</p>
                          <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-0.5">{c.note}</p>
                        </div>
                        <span className={cn('text-[0.65rem] font-bold px-2 py-0.5 rounded flex-shrink-0', STATUS_CLS[c.status])}>
                          {STATUS_LABEL[c.status]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Jurisdictions ── */}
              {active === 'compliance' && (
                <div className="space-y-4">
                  <div className={PANEL_CLS}>
                    <div className="px-6 py-4 border-b border-slate-100 dark:border-white/[0.05]">
                      <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Globe2 size={15} className="text-indigo-500" /> Jurisdiction rules
                      </h3>
                      <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-0.5">
                        The regulations outbound communication is designed around. Consent is checked per contact before every email, SMS and call.
                      </p>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
                      {JURISDICTIONS.map(j => (
                        <div key={j.key} className="px-6 py-4">
                          <p className="text-[0.88rem] font-semibold text-slate-800 dark:text-slate-200">{j.label}</p>
                          <p className="text-[0.76rem] text-slate-400 dark:text-slate-600 mt-0.5">{j.rules}</p>
                          <div className="flex gap-1.5 mt-1.5">
                            {j.channels.map(ch => (
                              <span key={ch} className="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/[0.07] text-slate-600 dark:text-slate-400 capitalize">{ch}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl px-5 py-4 text-[0.82rem] text-amber-700 dark:text-amber-300">
                    <p className="font-semibold mb-1 flex items-center gap-1.5"><AlertTriangle size={13} /> Legal counsel review</p>
                    <p>These rules affect outbound communication for all agents. Review them with legal counsel, especially for Accounts Receivable and EU/UK GDPR contexts.</p>
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </AppShell>
  );
}
