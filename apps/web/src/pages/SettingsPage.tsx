import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Building2, Code2, Check, Copy, Loader2, CreditCard, Shield } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';
import { useAuth, roleOf, ROLE_LABEL, initialsOf, displayNameOf } from '@/lib/auth/useAuth';
import { updateDisplayName, authErrorMessage } from '@/lib/auth/cognito';
import { useTenant } from '@/lib/useTenant';
import { workspaceHost } from '@/lib/tenant';
import { tenantApi, billingApi } from '@/api/client';
import { ApiError } from '@/api/http';

/**
 * Settings.
 *
 * Every value on this screen is read from the signed-in session or the tenant
 * row. It previously rendered a fixed "Sales Admin" profile, four invented team
 * members, a fake API key, a /webhooks/demo URL and "Save" buttons that only
 * flashed a tick — none of it connected to anything. Controls without a backing
 * operation were removed rather than left looking functional.
 */

type Section = 'profile' | 'workspace' | 'billing' | 'privacy' | 'brand' | 'developer';

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'profile',   label: 'Profile',   icon: User      },
  { id: 'workspace', label: 'Workspace', icon: Building2 },
  { id: 'billing',   label: 'Billing',   icon: CreditCard },
  { id: 'privacy',   label: 'Privacy',   icon: Shield },
  { id: 'brand',     label: 'Brand voice', icon: User },
  { id: 'developer', label: 'Developer', icon: Code2     },
];

const TIER_LABEL: Record<string, string> = {
  free: 'Free', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise',
};

// Injected at build time from SSM by apps/web/buildspec.yml.
const API_URL      = import.meta.env.VITE_API_URL ?? '';
const VOICE_WS_URL = import.meta.env.VITE_VOICE_WS_URL ?? '';

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
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function CopyValue({ value, empty = 'Not configured' }: { value: string; empty?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-[0.8rem] text-slate-400 dark:text-slate-600">{empty}</span>;

  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => { /* clipboard blocked — the value is still selectable */ });
  }

  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 text-[0.76rem] font-mono bg-slate-100 dark:bg-white/[0.07] px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 break-all">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy"
        className={cn('flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all',
          copied ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                 : 'bg-slate-100 dark:bg-white/[0.07] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

const READONLY_CLS = 'text-[0.84rem] text-slate-800 dark:text-slate-200';

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const tenant = useTenant(user?.tenantId);
  const [params] = useSearchParams();

  const [active, setActive] = useState<Section>(params.get('billing') ? 'billing' : 'profile');
  const [name, setName]     = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next) { setError('Name cannot be empty.'); return; }
    setError('');
    setSaving(true);
    try {
      await updateDisplayName(next);
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(authErrorMessage(err, 'Could not update your name. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  // RequireAuth guarantees a user; this only satisfies the type.
  if (!user) return null;

  const role = roleOf(user);
  const host = workspaceHost(user.tenantId);
  const nameChanged = name.trim() !== user.name.trim();

  return (
    <AppShell>
      <SEO title="Settings — ImpulsoIQ" description="Workspace and account settings" />
      <div className="px-4 sm:px-6 py-6 max-w-[900px]">
        <div className="mb-6">
          <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Settings</h1>
          <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">Your account and workspace</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-5">

          {/* Sidebar */}
          <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-2 h-fit">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setActive(s.id)}
                className={cn('w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all',
                  active === s.id
                    ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-900 dark:hover:text-white',
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
                <div className="flex items-center gap-4 mb-2 pb-5 border-b border-slate-100 dark:border-white/[0.05]">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-lg font-extrabold flex items-center justify-center">
                    {initialsOf(user)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white truncate">{displayNameOf(user)}</p>
                    <p className="text-[0.78rem] text-slate-400 dark:text-slate-600">
                      {role ? ROLE_LABEL[role] : 'No role assigned'} · {user.tenantId}
                    </p>
                  </div>
                </div>

                <form onSubmit={saveName}>
                  <Field label="Full name" hint="Shown to your team">
                    <div className="flex gap-2">
                      <input
                        value={name}
                        onChange={e => { setName(e.target.value); setError(''); setSaved(false); }}
                        placeholder="Your name"
                        autoComplete="name"
                        className="flex-1 min-w-0 h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-[0.84rem] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
                      />
                      <button
                        type="submit"
                        disabled={saving || (!nameChanged && !saved)}
                        className={cn('inline-flex items-center gap-1.5 px-3.5 h-9 text-[0.82rem] font-semibold rounded-xl transition-all disabled:opacity-50',
                          saved ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                : 'bg-indigo-600 text-white hover:bg-indigo-700')}
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <><Check size={14} />Saved</> : 'Save'}
                      </button>
                    </div>
                    {error && <p className="text-[0.75rem] text-red-500 dark:text-red-400 mt-1.5">{error}</p>}
                  </Field>
                </form>

                <Field label="Email address" hint="Your sign-in identity">
                  <p className={READONLY_CLS}>{user.email}</p>
                </Field>
                <Field label="Role" hint="Assigned when you joined the workspace">
                  <p className={READONLY_CLS}>{role ? ROLE_LABEL[role] : 'No role assigned'}</p>
                </Field>
                <Field label="Password">
                  <Link to={`/forgot-password?email=${encodeURIComponent(user.email)}`}
                    className="text-[0.82rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                    Reset password
                  </Link>
                </Field>
              </Card>
            )}

            {/* ── Workspace ── */}
            {active === 'workspace' && (
              <>
                <Card title="Workspace">
                  <Field label="Workspace name">
                    <p className={READONLY_CLS}>{tenant?.name ?? user.tenantId}</p>
                  </Field>
                  <Field label="Workspace ID" hint="Used in API calls and subdomain routing">
                    <CopyValue value={user.tenantId} />
                  </Field>
                  <Field label="Workspace URL">
                    <a href={`https://${host}`} target="_blank" rel="noreferrer"
                      className="font-mono text-[0.8rem] text-indigo-600 dark:text-indigo-400 hover:underline break-all">
                      {host}
                    </a>
                  </Field>
                  <Field label="Plan">
                    <div className="flex items-center gap-3">
                      {tenant ? (
                        <span className="px-2.5 py-1 rounded-lg text-[0.78rem] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400">
                          {TIER_LABEL[tenant.tier] ?? tenant.tier}
                        </span>
                      ) : (
                        <span className="text-[0.8rem] text-slate-400 dark:text-slate-600">Loading…</span>
                      )}
                      <Link to="/pricing" className="text-[0.78rem] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                        Compare plans →
                      </Link>
                    </div>
                  </Field>
                </Card>

                <Card title="Team">
                  <p className="text-[0.84rem] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Teammates join by creating an account at{' '}
                    <span className="font-mono text-[0.8rem] text-slate-800 dark:text-slate-200">{host}/sign-up</span>{' '}
                    with their work email. When their email domain matches this workspace, sign-up offers to add them.
                  </p>
                  <p className="text-[0.84rem] text-slate-600 dark:text-slate-400 leading-relaxed mt-3">
                    Roles are assigned automatically: whoever creates a workspace is its admin, and people who join are members.
                  </p>
                </Card>
              </>
            )}

            {active === 'billing' && (
              <BillingCard
                tier={tenant?.tier}
                canPay={role === 'admin' || role === 'manager'}
                checkoutOk={params.get('billing') === 'success'}
              />
            )}

            {active === 'privacy' && (
              <PrivacyCard canErase={role === 'admin' || role === 'manager'} />
            )}

            {active === 'brand' && (
              <BrandVoiceCard
                config={tenant?.config}
                canEdit={roleOf(user) === 'admin' || roleOf(user) === 'manager'}
              />
            )}

            {/* ── Developer ── */}
            {active === 'developer' && (
              <Card title="Developer">
                <Field label="API base URL" hint="REST endpoints for this environment">
                  <CopyValue value={API_URL} />
                </Field>
                <Field label="Voice WebSocket" hint="Ambient assistant endpoint">
                  <CopyValue value={VOICE_WS_URL} />
                </Field>
                <Field label="Authentication">
                  <p className="text-[0.82rem] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Requests carry your Cognito ID token in the <code className="font-mono text-[0.76rem]">Authorization</code> header
                    and are scoped to the <span className="font-mono text-[0.76rem]">{user.tenantId}</span> workspace.
                  </p>
                </Field>
              </Card>
            )}

          </motion.div>
        </div>
      </div>
    </AppShell>
  );
}

function BrandVoiceCard({ config, canEdit }: { config?: Record<string, unknown> | null; canEdit: boolean }) {
  const existing = (config?.brand_voice_profile ?? config?.brandVoiceProfile ?? {}) as Record<string, unknown>;
  const [tone, setTone] = useState(String(existing.tone ?? ''));
  const [persona, setPersona] = useState(String(existing.persona ?? ''));
  const [pillars, setPillars] = useState(Array.isArray(existing.pillars) ? (existing.pillars as string[]).join('\n') : String(existing.pillars ?? ''));
  const [forbidden, setForbidden] = useState(Array.isArray(existing.forbiddenPhrases) ? (existing.forbiddenPhrases as string[]).join('\n') : String(existing.forbiddenPhrases ?? ''));
  const [mailingAddress, setMailingAddress] = useState(String(existing.mailingAddress ?? ''));
  const [senderName, setSenderName] = useState(String(existing.senderName ?? ''));
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setNotice(null);
    try {
      await tenantApi.saveBrandVoice({
        tone, persona, mailingAddress, senderName,
        pillars: pillars.split('\n').map((s) => s.trim()).filter(Boolean),
        forbiddenPhrases: forbidden.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      setNotice('Brand voice saved. Outreach reads this on the next draft.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save brand voice');
    }
  }

  return (
    <Card title="Brand voice">
      <p className="text-[0.82rem] text-slate-500 mb-4">Outreach uses this profile when drafting. Empty fields mean the agent has no tone constraint.</p>
      {notice && <p className="text-[0.8rem] mb-3 text-amber-800">{notice}</p>}
      <Field label="Tone">
        <input disabled={!canEdit} className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm" value={tone} onChange={(e) => setTone(e.target.value)} />
      </Field>
      <Field label="Persona">
        <input disabled={!canEdit} className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm" value={persona} onChange={(e) => setPersona(e.target.value)} />
      </Field>
      <Field label="Pillars" hint="One per line">
        <textarea disabled={!canEdit} rows={3} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm" value={pillars} onChange={(e) => setPillars(e.target.value)} />
      </Field>
      <Field label="Forbidden phrases" hint="One per line">
        <textarea disabled={!canEdit} rows={3} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm" value={forbidden} onChange={(e) => setForbidden(e.target.value)} />
      </Field>
      <Field label="Physical address" hint="CAN-SPAM footer">
        <input disabled={!canEdit} className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm" value={mailingAddress} onChange={(e) => setMailingAddress(e.target.value)} />
      </Field>
      <Field label="Sender name">
        <input disabled={!canEdit} className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
      </Field>
      {canEdit ? (
        <button type="button" onClick={() => void save()} className="mt-4 px-4 py-2 rounded-xl text-[0.8rem] font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600">Save brand voice</button>
      ) : (
        <p className="text-[0.8rem] text-slate-400 mt-3">Admins and managers can edit brand voice.</p>
      )}
    </Card>
  );
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function BillingCard({ tier, canPay, checkoutOk }: { tier?: string; canPay: boolean; checkoutOk: boolean }) {
  const [notice, setNotice] = useState<string | null>(checkoutOk ? 'Checkout completed. Stripe will update this workspace tier via webhook.' : null);
  const [busy, setBusy] = useState<string | null>(null);

  async function checkout(body: { tier?: string; interval?: 'monthly' | 'annual'; action?: 'pack'; pack?: string }) {
    setNotice(null);
    setBusy(body.tier ?? body.pack ?? 'pay');
    try {
      const res = await billingApi.checkout(body);
      if (res.url) window.location.assign(res.url);
      else setNotice('No checkout URL — Stripe prices may be unset in this environment.');
    } catch (err) {
      setNotice(err instanceof ApiError || err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setBusy(null);
    }
  }

  async function portal() {
    setNotice(null);
    setBusy('portal');
    try {
      const res = await billingApi.portal();
      if (res.url) window.location.assign(res.url);
      else setNotice('No portal URL.');
    } catch (err) {
      setNotice(err instanceof ApiError || err instanceof Error ? err.message : 'Portal failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Billing">
      {notice && <p className="text-[0.82rem] text-amber-800 dark:text-amber-200 mb-3">{notice}</p>}
      <Field label="Current plan">
        <span className="px-2.5 py-1 rounded-lg text-[0.78rem] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400">
          {TIER_LABEL[tier ?? ''] ?? tier ?? '…'}
        </span>
      </Field>
      <Field label="Voice" hint="Free includes none">
        <p className={READONLY_CLS}>{tier === 'free' || !tier ? 'Paywall — upgrade to Starter' : 'Included within metered minutes'}</p>
      </Field>
      <Field label="Contact center">
        <p className={READONLY_CLS}>Not live. Growth add-on / Enterprise included on the roadmap only.</p>
      </Field>
      {canPay ? (
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="button" disabled={!!busy} onClick={() => void checkout({ tier: 'starter', interval: 'monthly' })} className="px-4 py-2 rounded-xl text-[0.8rem] font-semibold text-white bg-indigo-600">
            {busy === 'starter' ? '…' : 'Checkout Starter'}
          </button>
          <button type="button" disabled={!!busy} onClick={() => void checkout({ tier: 'growth', interval: 'monthly' })} className="px-4 py-2 rounded-xl text-[0.8rem] font-semibold border border-slate-200 dark:border-white/[0.1]">
            Checkout Growth
          </button>
          <button type="button" disabled={!!busy} onClick={() => void checkout({ action: 'pack', pack: 'call_minutes' })} className="px-4 py-2 rounded-xl text-[0.8rem] font-semibold border border-slate-200 dark:border-white/[0.1]">
            Call-minutes pack
          </button>
          <button type="button" disabled={!!busy} onClick={() => void portal()} className="px-4 py-2 rounded-xl text-[0.8rem] font-semibold border border-slate-200 dark:border-white/[0.1]">
            Customer portal
          </button>
          <Link to="/pricing" className="px-4 py-2 rounded-xl text-[0.8rem] font-semibold text-indigo-600">Compare plans</Link>
        </div>
      ) : (
        <p className="text-[0.8rem] text-slate-400 mt-3">Admins and managers manage billing.</p>
      )}
    </Card>
  );
}

function PrivacyCard({ canErase }: { canErase: boolean }) {
  const [contactId, setContactId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  async function exportSubject() {
    setNotice(null);
    try {
      const data = await tenantApi.exportDsar(contactId.trim());
      downloadJson(`dsar-${contactId.trim()}.json`, data);
      setNotice('Export downloaded. It includes consent records and call metadata (not invented transcripts).');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Export failed');
    }
  }

  async function erase() {
    if (!canErase) return;
    if (!window.confirm('Permanently delete this contact and associated agent history in this workspace? This is not a merge.')) return;
    setNotice(null);
    try {
      await tenantApi.eraseDsar(contactId.trim());
      setNotice('Erased. Related deals keep the account but no longer point at this contact.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Erase failed');
    }
  }

  return (
    <Card title="Data subject requests">
      <p className="text-[0.82rem] text-slate-500 mb-4">
        GDPR/CCPA access and erasure for a contact in this workspace: CRM row, consent, activities, agent runs, call metadata, enrichment. Audit events are included when they exist for that contact — there is no full-table tenant scan.
      </p>
      {notice && <p className="text-[0.8rem] mb-3 text-amber-800 dark:text-amber-200">{notice}</p>}
      <Field label="Contact ID">
        <input className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm font-mono" value={contactId} onChange={(e) => setContactId(e.target.value)} placeholder="UUID" />
      </Field>
      <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" disabled={!contactId.trim()} onClick={() => void exportSubject()} className="px-4 py-2 rounded-xl text-[0.8rem] font-semibold text-white bg-indigo-600 disabled:opacity-40">
          Download export
        </button>
        {canErase && (
          <button type="button" disabled={!contactId.trim()} onClick={() => void erase()} className="px-4 py-2 rounded-xl text-[0.8rem] font-semibold text-rose-700 border border-rose-200 dark:border-rose-500/30 disabled:opacity-40">
            Erase contact
          </button>
        )}
      </div>
    </Card>
  );
}
