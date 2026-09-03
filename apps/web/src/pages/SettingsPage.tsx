import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Building2, Bell, Key, Globe, ChevronRight, Check, Copy, AlertTriangle } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

type Section = 'profile' | 'workspace' | 'notifications' | 'api' | 'danger';

const SECTIONS: { id: Section; label: string; icon: React.ElementType; desc: string }[] = [
  { id: 'profile',       label: 'Profile',       icon: User,        desc: 'Your name, email, and role' },
  { id: 'workspace',     label: 'Workspace',     icon: Building2,   desc: 'Workspace name and plan' },
  { id: 'notifications', label: 'Notifications', icon: Bell,        desc: 'Email and in-app alerts' },
  { id: 'api',           label: 'API & Keys',    icon: Key,         desc: 'API keys and webhooks' },
  { id: 'danger',        label: 'Danger Zone',   icon: AlertTriangle, desc: 'Delete or transfer workspace' },
];

const PLAN_BADGE: Record<string, string> = {
  Growth: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400',
};

const TEAM_MEMBERS = [
  { initials: 'SA', name: 'Sales Admin',    email: 'admin@yourcompany.com',    role: 'Owner',   color: 'from-indigo-500 to-violet-600' },
  { initials: 'RK', name: 'Rania Khalid',   email: 'rania@yourcompany.com',    role: 'Manager', color: 'from-emerald-500 to-cyan-500'  },
  { initials: 'JL', name: 'James Lee',       email: 'james@yourcompany.com',    role: 'Member',  color: 'from-amber-500 to-orange-500'  },
  { initials: 'SM', name: 'Sofia Morales',  email: 'sofia@yourcompany.com',    role: 'Member',  color: 'from-violet-500 to-pink-500'   },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-10 h-5.5 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500',
        checked ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-white/[0.12]',
      )}
      style={{ height: 22 }}
    >
      <span className={cn('absolute top-0.5 left-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0')}
        style={{ width: 18, height: 18 }} />
    </button>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-white/[0.05]">
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">{title}</h3>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-4 border-b border-slate-100 dark:border-white/[0.04] last:border-0">
      <div className="sm:w-44 flex-shrink-0">
        <p className="text-[0.84rem] font-semibold text-slate-700 dark:text-slate-300">{label}</p>
        {hint && <p className="text-[0.74rem] text-slate-400 dark:text-slate-600 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-[0.84rem] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition" />
  );
}

// ─── Custom Domain Card ────────────────────────────────────────────────────────

function DnsRow({ type, name, value }: { type: string; name: string; value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }
  return (
    <div className="grid gap-2 items-center py-2.5 border-b border-slate-100 dark:border-white/[0.04] last:border-0 text-[0.78rem]"
      style={{ gridTemplateColumns: '44px 1fr auto' }}>
      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{type}</span>
      <div className="min-w-0">
        <p className="text-slate-500 dark:text-slate-500 text-[0.68rem] mb-0.5 truncate">{name}</p>
        <code className="text-slate-800 dark:text-slate-200 break-all font-mono text-[0.72rem]">{value}</code>
      </div>
      <button onClick={copy}
        className={cn('w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg transition-all',
          copied ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                 : 'bg-slate-100 dark:bg-white/[0.07] text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

function CustomDomainCard({ tenantSlug }: { tenantSlug: string }) {
  const [customDomain, setCustomDomain] = useState('');
  const [saved, setSaved]               = useState(false);
  const impulsoiqUrl = `${tenantSlug}.impulsoiq.rinegansolutions.com`;

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    // TODO Phase 5/6: POST /api/tenant/custom-domain to start verification flow
  }

  return (
    <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-white/[0.05] flex items-center gap-2.5">
        <Globe size={15} className="text-slate-500 dark:text-slate-400" />
        <h3 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Domain & Routing</h3>
      </div>
      <div className="px-6 py-5 space-y-0">

        {/* Current ImpulsoIQ URL */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-4 border-b border-slate-100 dark:border-white/[0.04]">
          <div className="sm:w-44 flex-shrink-0">
            <p className="text-[0.84rem] font-semibold text-slate-700 dark:text-slate-300">Workspace URL</p>
            <p className="text-[0.74rem] text-slate-400 dark:text-slate-600 mt-0.5">Your current ImpulsoIQ address</p>
          </div>
          <div>
            <a href={`https://${impulsoiqUrl}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-[0.8rem] text-indigo-600 dark:text-indigo-400 hover:underline break-all">
              {impulsoiqUrl}
            </a>
          </div>
        </div>

        {/* Custom domain input */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-4 border-b border-slate-100 dark:border-white/[0.04]">
          <div className="sm:w-44 flex-shrink-0">
            <p className="text-[0.84rem] font-semibold text-slate-700 dark:text-slate-300">Custom domain</p>
            <p className="text-[0.74rem] text-slate-400 dark:text-slate-600 mt-0.5">
              Use your own domain — e.g. <span className="font-mono">crm.yourcompany.com</span>
            </p>
          </div>
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              placeholder="crm.yourcompany.com"
              value={customDomain}
              onChange={e => setCustomDomain(e.target.value.toLowerCase())}
              className="flex-1 h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-[0.84rem] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
            />
            <button onClick={handleSave}
              className={cn('px-3.5 h-9 rounded-xl text-[0.82rem] font-semibold transition-all',
                saved ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700')}>
              {saved ? <Check size={14} /> : 'Save'}
            </button>
          </div>
        </div>

        {/* DNS records — shown only once a custom domain is entered */}
        {customDomain && (
          <div className="py-4">
            <p className="text-[0.8rem] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Add these DNS records at your registrar
            </p>
            <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 mb-3">
              Propagation can take up to 48 hours. Status will update automatically once verified.
            </p>

            <div className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.07] rounded-xl px-4 pt-1 pb-1 mb-3">
              <p className="text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 pt-2.5 pb-1.5">
                Step 1 — Point your domain to ImpulsoIQ
              </p>
              <DnsRow type="CNAME" name={customDomain} value={impulsoiqUrl + '.'} />
            </div>

            <div className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.07] rounded-xl px-4 pt-1 pb-1 mb-3">
              <p className="text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 pt-2.5 pb-1.5">
                Step 2 — Verify domain ownership
              </p>
              <DnsRow type="TXT" name={`_impulsoiq-verify.${customDomain}`} value={`impulsoiq-verification=${tenantSlug}`} />
            </div>

            <div className="flex items-center gap-2 mt-3">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <p className="text-[0.75rem] text-slate-500 dark:text-slate-500">
                Verification pending · HTTPS certificate will be issued automatically after verification
              </p>
            </div>

            <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 mt-3">
              Custom domain routing is an enterprise feature —
              <a href="/pricing" className="text-indigo-500 hover:underline ml-1">upgrade to activate</a>.
              DNS instructions are shown now so you can configure your registrar in advance.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [active, setActive] = useState<Section>('profile');
  const [saved, setSaved]   = useState(false);
  const [copied, setCopied] = useState(false);

  // Profile state
  const [name,  setName]  = useState('Sales Admin');
  const [email, setEmail] = useState('admin@yourcompany.com');
  const [role,  setRole]  = useState('Manager');

  // Workspace state
  const [wsName, setWsName] = useState('Q4 SaaS Outreach');

  // Notifications state
  const [notifs, setNotifs] = useState({
    agentCompleted:   true,
    meetingBooked:    true,
    approvalRequired: true,
    campaignFinished: false,
    weeklyDigest:     true,
  });

  const apiKey = 'iq_live_sk_••••••••••••••••••••••••••••••••';
  const webhook = 'https://impulsoiq.rinegansolutions.com/webhooks/demo';

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function copyKey() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <AppShell>
      <SEO title="Settings — ImpulsoIQ" description="Workspace and account settings" />
      <div className="px-4 sm:px-6 py-6 max-w-[900px]">
        <div className="mb-6">
          <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Settings</h1>
          <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">Manage your account and workspace preferences</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-5">

          {/* Sidebar */}
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-2 h-fit">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setActive(s.id)}
                className={cn('w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all',
                  active === s.id
                    ? s.id === 'danger' ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400'
                    : s.id === 'danger' ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-900 dark:hover:text-white',
                )}>
                <s.icon size={15} />
                <span className="text-[0.84rem] font-medium">{s.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <motion.div key={active} initial={{ opacity:0, x:10 }} animate={{ opacity:1, x:0 }} transition={{ duration:0.25, ease:[0.22,1,0.36,1] }}
            className="space-y-4">

            {/* ── Profile ── */}
            {active === 'profile' && (
              <Card title="Profile">
                <div className="flex items-center gap-4 mb-6 pb-5 border-b border-slate-100 dark:border-white/[0.05]">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-lg font-extrabold flex items-center justify-center">
                    {name.split(' ').map(w => w[0]).slice(0,2).join('')}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">{name}</p>
                    <p className="text-[0.78rem] text-slate-400 dark:text-slate-600">{role} · All access</p>
                  </div>
                </div>
                <Field label="Full name"><TextInput value={name} onChange={setName} /></Field>
                <Field label="Email address"><TextInput value={email} onChange={setEmail} placeholder="you@company.com" /></Field>
                <Field label="Role" hint="Your team role and access level"><TextInput value={role} onChange={setRole} /></Field>
                <div className="pt-4">
                  <button onClick={save} className={cn('inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all', saved ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-indigo-600 text-white hover:bg-indigo-700')}>
                    {saved ? <><Check size={14} />Saved!</> : 'Save changes'}
                  </button>
                </div>
              </Card>
            )}

            {/* ── Workspace ── */}
            {active === 'workspace' && (
              <>
                <Card title="Workspace">
                  <Field label="Workspace name" hint="Shown across your tenant"><TextInput value={wsName} onChange={setWsName} /></Field>
                  <Field label="Plan" hint="Your current billing plan">
                    <div className="flex items-center gap-3">
                      <span className={cn('px-2.5 py-1 rounded-lg text-[0.78rem] font-bold', PLAN_BADGE.Growth)}>Growth Plan</span>
                      <button className="text-[0.78rem] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">Upgrade →</button>
                    </div>
                  </Field>
                  <Field label="Workspace ID" hint="Used in API calls and subdomain routing">
                    <code className="text-[0.78rem] font-mono bg-slate-100 dark:bg-white/[0.07] px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300">q4-saas-outreach</code>
                  </Field>
                  <div className="pt-4">
                    <button onClick={save} className={cn('inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all', saved ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-indigo-600 text-white hover:bg-indigo-700')}>
                      {saved ? <><Check size={14} />Saved!</> : 'Save changes'}
                    </button>
                  </div>
                </Card>
                <Card title="Team Members">
                  <div className="space-y-1">
                    {TEAM_MEMBERS.map((m, i) => (
                      <div key={i} className="flex items-center gap-3 py-2.5 px-1">
                        <div className={cn('w-8 h-8 rounded-full bg-gradient-to-br text-white text-[0.65rem] font-bold flex items-center justify-center flex-shrink-0', m.color)}>{m.initials}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-200">{m.name}</p>
                          <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 truncate">{m.email}</p>
                        </div>
                        <span className="text-[0.72rem] bg-slate-100 dark:bg-white/[0.07] text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md">{m.role}</span>
                        <button className="text-slate-300 dark:text-slate-700 hover:text-slate-600 dark:hover:text-slate-400 transition-colors"><ChevronRight size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <button className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-white/[0.07] text-[0.8rem] font-semibold text-slate-400 hover:border-indigo-400 dark:hover:border-indigo-500/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all">
                    + Invite team member
                  </button>
                </Card>

                {/* Custom domain card */}
                <CustomDomainCard tenantSlug="q4-saas-outreach" />
              </>
            )}

            {/* ── Notifications ── */}
            {active === 'notifications' && (
              <Card title="Notifications">
                {(Object.entries({
                  agentCompleted:   { label: 'Agent run completed',            hint: 'When any agent finishes a run' },
                  meetingBooked:    { label: 'Meeting booked',                 hint: 'When a voice call books a meeting' },
                  approvalRequired: { label: 'Approval gate triggered',        hint: 'When an agent needs your review' },
                  campaignFinished: { label: 'Campaign completed',             hint: 'When all contacts have been touched' },
                  weeklyDigest:     { label: 'Weekly performance digest',      hint: 'Email summary every Monday' },
                }) as [keyof typeof notifs, {label:string;hint:string}][]).map(([key, cfg]) => (
                  <Field key={key} label={cfg.label} hint={cfg.hint}>
                    <Toggle checked={notifs[key]} onChange={v => setNotifs(p => ({ ...p, [key]: v }))} />
                  </Field>
                ))}
              </Card>
            )}

            {/* ── API ── */}
            {active === 'api' && (
              <Card title="API Keys & Webhooks">
                <Field label="Live API key" hint="Keep this secret — full write access">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[0.78rem] font-mono bg-slate-100 dark:bg-white/[0.07] px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 truncate">{apiKey}</code>
                    <button onClick={copyKey} className={cn('flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all', copied ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-white/[0.07] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </Field>
                <Field label="Webhook endpoint" hint="CALL-E callbacks are sent here">
                  <code className="text-[0.75rem] font-mono text-slate-500 dark:text-slate-500 break-all">{webhook}</code>
                </Field>
                <Field label="VITE_API_URL" hint="Set this to point the frontend at your deployed backend">
                  <code className="text-[0.75rem] font-mono bg-slate-100 dark:bg-white/[0.07] px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300">
                    Currently using MSW mock API (DEV mode)
                  </code>
                </Field>
              </Card>
            )}

            {/* ── Danger zone ── */}
            {active === 'danger' && (
              <div className="bg-white dark:bg-[#0d1526] border-2 border-red-200 dark:border-red-500/25 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-red-100 dark:border-red-500/15 bg-red-50/40 dark:bg-red-500/5">
                  <h3 className="text-[0.9rem] font-bold text-red-700 dark:text-red-400 flex items-center gap-2"><AlertTriangle size={15} />Danger Zone</h3>
                </div>
                <div className="px-6 py-5 space-y-4">
                  {[
                    { label: 'Delete all agent runs', desc: 'Permanently remove all run history and logs.', btn: 'Delete runs' },
                    { label: 'Reset workspace data', desc: 'Clear all contacts, deals, and campaign data. Cannot be undone.', btn: 'Reset data' },
                    { label: 'Delete workspace', desc: 'Permanently delete this workspace and all associated data.', btn: 'Delete workspace' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-3 border-b border-red-50 dark:border-red-500/10 last:border-0">
                      <div>
                        <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-200">{item.label}</p>
                        <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-0.5">{item.desc}</p>
                      </div>
                      <button className="flex-shrink-0 ml-6 px-3 py-1.5 text-[0.78rem] font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                        {item.btn}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </motion.div>
        </div>
      </div>
    </AppShell>
  );
}
