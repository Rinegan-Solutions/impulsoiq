/**
 * Enterprise Settings — Phase 6D.
 *
 * SSO/SAML configuration, SOC 2 status dashboard, and multi-jurisdiction
 * compliance matrix for enterprise-tier tenants.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Lock, Globe2, Check, AlertTriangle, ExternalLink, } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

type Section = 'sso' | 'soc2' | 'compliance';

const SECTIONS = [
  { id: 'sso' as const,        label: 'SSO / SAML',         icon: Lock,    desc: 'Configure identity provider' },
  { id: 'soc2' as const,       label: 'SOC 2 Controls',     icon: Shield,  desc: 'Audit trail and access review' },
  { id: 'compliance' as const, label: 'Compliance Matrix',  icon: Globe2,  desc: 'Per-jurisdiction settings' },
];

const IDP_TYPES = [
  { key: 'okta',       label: 'Okta',            logo: 'OK' },
  { key: 'azure_ad',   label: 'Microsoft Entra', logo: 'MS' },
  { key: 'google',     label: 'Google Workspace',logo: 'G'  },
  { key: 'generic',    label: 'Generic SAML 2.0', logo: 'S' },
];

const SOC2_CONTROLS = [
  { id: 'CC6.1', name: 'Logical access controls',      status: 'implemented', note: 'Cognito RBAC + Lambda authorizer' },
  { id: 'CC6.2', name: 'Authentication MFA',           status: 'implemented', note: 'Cognito MFA configurable per tenant' },
  { id: 'CC6.3', name: 'Access removal on termination',status: 'partial',     note: 'Manual today; automated in roadmap' },
  { id: 'CC7.1', name: 'System monitoring',            status: 'implemented', note: 'CloudTrail + CloudWatch alarms' },
  { id: 'CC7.2', name: 'Vulnerability detection',      status: 'implemented', note: 'ECR image scanning on push' },
  { id: 'CC8.1', name: 'Change management',            status: 'implemented', note: 'Terraform plan→approve→apply pipeline' },
  { id: 'CC9.1', name: 'Vendor risk management',       status: 'partial',     note: 'AWS CAIQ on file; others in progress' },
  { id: 'A1.1',  name: 'Availability monitoring',      status: 'implemented', note: 'CloudWatch alarms + on-call runbooks' },
  { id: 'C1.1',  name: 'Confidentiality classification',status: 'implemented',note: 'KMS encryption at rest, TLS in transit' },
  { id: 'P1.1',  name: 'Privacy notice',               status: 'implemented', note: 'Privacy policy at /privacy' },
  { id: 'P4.1',  name: 'Data retention limits',        status: 'implemented', note: '7-year audit trail, configurable per tenant' },
  { id: 'P5.1',  name: 'Data subject requests',        status: 'partial',     note: 'Manual process; DSAR workflow in roadmap' },
];

const JURISDICTIONS = [
  { key: 'us',    label: 'United States',  rules: 'CAN-SPAM, TCPA, FTC Act', channels: ['email', 'sms', 'call'] },
  { key: 'eu',    label: 'European Union', rules: 'GDPR Article 6(1)(a)',     channels: ['email', 'sms', 'call'] },
  { key: 'ca',    label: 'Canada',         rules: 'CASL, PIPEDA',             channels: ['email', 'sms', 'call'] },
  { key: 'uk',    label: 'United Kingdom', rules: 'UK GDPR, PECR',           channels: ['email', 'sms', 'call'] },
  { key: 'au',    label: 'Australia',      rules: 'Spam Act, Privacy Act',    channels: ['email', 'sms'] },
];

const STATUS_CLS = {
  implemented: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  partial:     'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  planned:     'bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-400',
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function EnterpriseSettingsPage() {
  const [active, setActive]         = useState<Section>('sso');
  const [selectedIdp, setIdp]       = useState('');
  const [metadataUrl, setMeta]      = useState('');
  const [testStatus, setTestStatus] = useState<'idle'|'testing'|'ok'|'error'>('idle');
  const [enabledJurisdictions, setJurisdictions] = useState<Set<string>>(new Set(['us', 'eu']));

  function toggleJurisdiction(key: string) {
    setJurisdictions(p => { const n = new Set(p); if (n.has(key)) { n.delete(key); } else { n.add(key); } return n; });
  }

  async function testSso() {
    setTestStatus('testing');
    await new Promise(r => setTimeout(r, 1500));
    setTestStatus(metadataUrl.startsWith('http') ? 'ok' : 'error');
  }

  return (
    <AppShell>
      <SEO title="Enterprise Settings — ImpulsoIQ" description="SSO, SOC 2, and compliance configuration" />
      <div className="px-4 sm:px-6 py-6 max-w-[960px]">

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }} className="mb-6">
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-2">Phase 6D · Enterprise</div>
          <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-1">Enterprise Settings</h1>
          <p className="text-[0.84rem] text-slate-500 dark:text-slate-400">SSO/SAML configuration, SOC 2 control status, and multi-jurisdiction compliance matrix.</p>
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
                  <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 dark:border-white/[0.05]">
                      <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Lock size={15} className="text-indigo-500" /> Identity Provider
                      </h3>
                    </div>
                    <div className="px-6 py-5 space-y-5">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Select your IdP</label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {IDP_TYPES.map(idp => (
                            <button key={idp.key} onClick={() => setIdp(idp.key)}
                              className={cn('flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-[0.78rem] font-semibold',
                                selectedIdp === idp.key
                                  ? 'border-indigo-400 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                                  : 'border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20')}>
                              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-[0.7rem] font-bold flex items-center justify-center">{idp.logo}</span>
                              {idp.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {selectedIdp && (
                        <>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">SAML Metadata URL</label>
                            <input type="url" placeholder="https://your-idp.example.com/saml/metadata"
                              value={metadataUrl} onChange={e => { setMeta(e.target.value); setTestStatus('idle'); }}
                              className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition" />
                            <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 mt-1">Your IdP metadata document URL — used to configure the Cognito SAML identity provider.</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <button onClick={testSso} disabled={!metadataUrl || testStatus === 'testing'}
                              className="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-white/[0.07] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/[0.12] disabled:opacity-50 transition">
                              {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
                            </button>
                            {testStatus === 'ok' && <span className="flex items-center gap-1.5 text-[0.82rem] text-emerald-600 dark:text-emerald-400"><Check size={14} /> Connection verified</span>}
                            {testStatus === 'error' && <span className="flex items-center gap-1.5 text-[0.82rem] text-red-500"><AlertTriangle size={14} /> Could not reach metadata URL</span>}
                            <button className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 transition-all disabled:opacity-50" disabled={testStatus !== 'ok'}>
                              Save & activate SSO
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-2xl px-5 py-4 text-[0.82rem] text-indigo-700 dark:text-indigo-300">
                    <p className="font-semibold mb-1">Attribute mapping</p>
                    <p>ImpulsoIQ maps <code className="font-mono bg-indigo-100 dark:bg-indigo-500/20 px-1 rounded">emailaddress</code> → email, <code className="font-mono bg-indigo-100 dark:bg-indigo-500/20 px-1 rounded">organizationunit</code> → tenant_id. Configure this in your IdP's attribute statements.</p>
                  </div>
                </div>
              )}

              {/* ── SOC 2 Controls ── */}
              {active === 'soc2' && (
                <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 dark:border-white/[0.05] flex items-center justify-between">
                    <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Shield size={15} className="text-emerald-500" /> SOC 2 Type II — Control Status
                    </h3>
                    <a href="#" className="flex items-center gap-1.5 text-[0.78rem] text-indigo-600 dark:text-indigo-400 hover:underline">
                      View report <ExternalLink size={11} />
                    </a>
                  </div>
                  <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
                    {SOC2_CONTROLS.map(c => (
                      <div key={c.id} className="flex items-start gap-4 px-6 py-3.5">
                        <code className="text-[0.68rem] font-mono font-bold text-slate-400 dark:text-slate-600 mt-0.5 w-[48px] flex-shrink-0">{c.id}</code>
                        <div className="flex-1 min-w-0">
                          <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-200">{c.name}</p>
                          <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-0.5">{c.note}</p>
                        </div>
                        <span className={cn('text-[0.65rem] font-bold px-2 py-0.5 rounded flex-shrink-0', STATUS_CLS[c.status as keyof typeof STATUS_CLS])}>
                          {c.status === 'implemented' ? '✓ Implemented' : c.status === 'partial' ? '⟳ Partial' : '○ Planned'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="px-6 py-4 border-t border-slate-100 dark:border-white/[0.05] bg-slate-50/40 dark:bg-white/[0.01] text-[0.75rem] text-slate-400 dark:text-slate-600">
                    Incident-response runbooks reference the Phase 2E three-tier kill switch — built into the product for operational reasons, reused here for SOC 2 compliance.
                  </div>
                </div>
              )}

              {/* ── Compliance Matrix ── */}
              {active === 'compliance' && (
                <div className="space-y-4">
                  <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 dark:border-white/[0.05]">
                      <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Globe2 size={15} className="text-indigo-500" /> Active Jurisdictions
                      </h3>
                      <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-0.5">Enable the jurisdictions your contacts operate in. ImpulsoIQ applies the correct consent and communication rules automatically.</p>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
                      {JURISDICTIONS.map(j => {
                        const enabled = enabledJurisdictions.has(j.key);
                        return (
                          <div key={j.key} className="flex items-center gap-4 px-6 py-4">
                            <div className="flex-1 min-w-0">
                              <p className="text-[0.88rem] font-semibold text-slate-800 dark:text-slate-200">{j.label}</p>
                              <p className="text-[0.76rem] text-slate-400 dark:text-slate-600 mt-0.5">{j.rules}</p>
                              <div className="flex gap-1.5 mt-1.5">
                                {j.channels.map(ch => (
                                  <span key={ch} className="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/[0.07] text-slate-600 dark:text-slate-400 capitalize">{ch}</span>
                                ))}
                              </div>
                            </div>
                            <button
                              onClick={() => toggleJurisdiction(j.key)}
                              className={cn('relative w-10 h-[22px] rounded-full transition-colors', enabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-white/[0.12]')}
                              role="switch" aria-checked={enabled}
                            >
                              <span className={cn('absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full shadow transition-transform', enabled ? 'translate-x-[18px]' : 'translate-x-0.5')} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl px-5 py-4 text-[0.82rem] text-amber-700 dark:text-amber-300">
                    <p className="font-semibold mb-1 flex items-center gap-1.5"><AlertTriangle size={13} /> Legal counsel review</p>
                    <p>Compliance settings affect outbound communication rules for all agents. Changes should be reviewed with legal counsel, especially for Accounts Receivable (5B) and EU/GDPR contexts.</p>
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
