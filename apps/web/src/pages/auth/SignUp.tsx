import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Users, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { signUp } from '@/lib/auth/cognito';
import { orgCheckApi } from '@/api/client';
import {
  SplitLayout, BrandPanel, AuthHeading,
  FormField, PasswordField, ErrorBanner, PrimaryBtn,
} from '@/components/auth/AuthUI';

const PANEL = (
  <BrandPanel
    heading="Your AI sales team is one workspace away."
    sub="Join 200+ revenue teams using ImpulsoIQ agents to research, outreach, and qualify leads — automatically."
    bullets={[
      'Deploy your first AI SDR in under 10 minutes',
      'No credit card required — start free',
      'Full team access, unlimited campaigns',
    ]}
    quote={{
      text: "The AI voice calls book meetings we'd never land manually. Our whole team was surprised by the quality.",
      author: 'Amara Mensah',
      role: 'Founder · Northvault',
    }}
  />
);

type Step = 'email' | 'org-choice' | 'create' | 'join';

interface OrgTenant { id: string; name: string; subdomain: string }

function toSlug(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function SignUp() {
  const navigate = useNavigate();

  // Step state
  const [step, setStep]           = useState<Step>('email');
  const [orgTenants, setOrgTenants] = useState<OrgTenant[]>([]);
  const [selectedTenant, setSelected] = useState<OrgTenant | null>(null);

  // Form fields
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [workspace, setWorkspace] = useState('');

  const [errors, setErrors]         = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading]       = useState(false);
  const [checking, setChecking]     = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Email → org check ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!email.includes('@')) return;
    const domain = email.split('@')[1];
    if (!domain) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await orgCheckApi.byDomain(domain);
        setOrgTenants(res.tenants);
      } catch {
        setOrgTenants([]);
      } finally {
        setChecking(false);
      }
    }, 600);
  }, [email]);

  // ── Step 1: email + name ───────────────────────────────────────────────────
  function handleEmailContinue(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim())         errs.name  = 'Full name is required.';
    if (!email.includes('@')) errs.email = 'Enter a valid work email.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});

    if (orgTenants.length > 0) {
      setStep('org-choice');
    } else {
      setStep('create');
    }
  }

  // ── Submit: create new workspace ──────────────────────────────────────────
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!workspace.trim())    errs.workspace = 'Workspace name is required.';
    if (password.length < 12) errs.password  = 'Password must be at least 12 characters.';
    if (confirm !== password)  errs.confirm   = 'Passwords do not match.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({}); setGlobalError(''); setLoading(true);

    try {
      const tenantId = toSlug(workspace) || toSlug(email.split('@')[0]);
      await signUp(email, password, tenantId);
      navigate(`/verify?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setGlobalError((err as Error).message ?? 'Sign-up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Submit: join existing workspace ───────────────────────────────────────
  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!selectedTenant) return;
    const errs: Record<string, string> = {};
    if (password.length < 12) errs.password = 'Password must be at least 12 characters.';
    if (confirm !== password)  errs.confirm  = 'Passwords do not match.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({}); setGlobalError(''); setLoading(true);

    try {
      // tenant_id = existing workspace subdomain; provisioner will assign 'member'
      await signUp(email, password, selectedTenant.subdomain);
      navigate(`/verify?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setGlobalError((err as Error).message ?? 'Sign-up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const slideIn = { initial: { opacity: 0, x: 20 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -20 } };
  const transition = { duration: 0.3, ease };

  return (
    <SplitLayout panel={PANEL}>
      <AnimatePresence mode="wait" initial={false}>

        {/* ── Step 1: Email + name ── */}
        {step === 'email' && (
          <motion.div key="email" {...slideIn} transition={transition}>
            <AuthHeading title="Create your account" sub="Free to start · No credit card required" />
            <form onSubmit={handleEmailContinue} className="flex flex-col gap-4" noValidate>
              <FormField
                label="Full name" type="text" placeholder="Alex Johnson"
                value={name} onChange={e => { setName(e.target.value); setErrors(p => { const n={...p}; delete n.name; return n; }); }}
                error={errors.name} autoComplete="name" autoFocus
              />
              <div>
                <FormField
                  label="Work email" type="email" placeholder="alex@company.com"
                  value={email} onChange={e => { setEmail(e.target.value); setErrors(p => { const n={...p}; delete n.email; return n; }); }}
                  error={errors.email} autoComplete="email"
                />
                {checking && (
                  <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 mt-1">Checking for existing workspaces…</p>
                )}
              </div>
              <PrimaryBtn type="submit">
                Continue <ArrowRight size={14} />
              </PrimaryBtn>
            </form>
            <p className="text-center text-[0.84rem] text-slate-500 dark:text-slate-500 mt-5">
              Already have an account?{' '}
              <Link to="/sign-in" className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">Sign in</Link>
            </p>
          </motion.div>
        )}

        {/* ── Step 2: Org choice ── */}
        {step === 'org-choice' && (
          <motion.div key="org-choice" {...slideIn} transition={transition}>
            <AuthHeading
              title="Your team is already here"
              sub={`We found ${orgTenants.length > 1 ? 'workspaces' : 'a workspace'} with colleagues from ${email.split('@')[1]}.`}
            />
            <div className="flex flex-col gap-3 mb-5">
              {orgTenants.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setSelected(t); setStep('join'); }}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.03] hover:border-indigo-400 dark:hover:border-indigo-500/50 hover:bg-indigo-50/40 dark:hover:bg-indigo-500/5 transition-all text-left group"
                >
                  <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                    {t.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.875rem] font-semibold text-slate-900 dark:text-white">{t.name}</p>
                    <p className="text-[0.75rem] text-slate-400 dark:text-slate-600">{t.subdomain}.impulsoiq.com</p>
                  </div>
                  <span className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Users size={13} /> Join
                  </span>
                </button>
              ))}

              <button
                onClick={() => setStep('create')}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/[0.08] hover:border-indigo-400 dark:hover:border-indigo-500/40 hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5 transition-all text-left"
              >
                <span className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                  <Plus size={18} className="text-slate-500 dark:text-slate-400" />
                </span>
                <div>
                  <p className="text-[0.875rem] font-semibold text-slate-700 dark:text-slate-300">Create a new workspace</p>
                  <p className="text-[0.75rem] text-slate-400 dark:text-slate-600">Start fresh for your team</p>
                </div>
              </button>
            </div>
            <button
              onClick={() => setStep('email')}
              className="flex items-center gap-1.5 text-[0.82rem] text-slate-400 hover:text-indigo-500 transition-colors"
            >
              <ArrowLeft size={13} /> Back
            </button>
          </motion.div>
        )}

        {/* ── Step 3a: Create workspace ── */}
        {step === 'create' && (
          <motion.div key="create" {...slideIn} transition={transition}>
            <AuthHeading title="Set up your workspace" sub="This will be your team's ImpulsoIQ home." />
            <form onSubmit={handleCreate} className="flex flex-col gap-4" noValidate>
              <FormField
                label="Workspace name" type="text" placeholder="Acme Corp"
                value={workspace}
                onChange={e => { setWorkspace(e.target.value); setErrors(p => { const n={...p}; delete n.workspace; return n; }); }}
                error={errors.workspace}
                hint={workspace ? `Your URL: ${toSlug(workspace)}.impulsoiq.com` : 'Letters and numbers — this becomes your workspace URL.'}
                autoFocus
              />
              <PasswordField
                label="Password" value={password}
                onChange={e => { setPassword(e.target.value); setErrors(p => { const n={...p}; delete n.password; return n; }); }}
                error={errors.password} placeholder="12+ characters"
                hint="At least 12 characters, one uppercase and one number."
                autoComplete="new-password"
              />
              <PasswordField
                label="Re-enter password" value={confirm}
                onChange={e => { setConfirm(e.target.value); setErrors(p => { const n={...p}; delete n.confirm; return n; }); }}
                error={errors.confirm} placeholder="••••••••••••"
                autoComplete="new-password"
              />
              {globalError && <ErrorBanner message={globalError} />}
              <PrimaryBtn type="submit" loading={loading}>Create workspace →</PrimaryBtn>
              <p className="text-center text-[0.72rem] text-slate-400 dark:text-slate-600">
                By continuing you agree to our{' '}
                <a href="/terms" className="text-indigo-500 hover:underline">Terms</a> and{' '}
                <a href="/privacy" className="text-indigo-500 hover:underline">Privacy Policy</a>.
              </p>
            </form>
            <button onClick={() => setStep(orgTenants.length > 0 ? 'org-choice' : 'email')}
              className="mt-4 flex items-center gap-1.5 text-[0.82rem] text-slate-400 hover:text-indigo-500 transition-colors">
              <ArrowLeft size={13} /> Back
            </button>
          </motion.div>
        )}

        {/* ── Step 3b: Join existing workspace ── */}
        {step === 'join' && selectedTenant && (
          <motion.div key="join" {...slideIn} transition={transition}>
            <div className="flex items-center gap-3 mb-6 p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25">
              <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                {selectedTenant.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <p className="text-[0.875rem] font-semibold text-indigo-800 dark:text-indigo-200">Joining {selectedTenant.name}</p>
                <p className="text-[0.75rem] text-indigo-600 dark:text-indigo-400">{selectedTenant.subdomain}.impulsoiq.com</p>
              </div>
            </div>
            <AuthHeading title="Set your password" sub={`You'll be added as a member of ${selectedTenant.name}. A workspace admin will see your request.`} />
            <form onSubmit={handleJoin} className="flex flex-col gap-4" noValidate>
              <PasswordField
                label="Password" value={password}
                onChange={e => { setPassword(e.target.value); setErrors(p => { const n={...p}; delete n.password; return n; }); }}
                error={errors.password} placeholder="12+ characters"
                hint="At least 12 characters, one uppercase and one number."
                autoComplete="new-password" autoFocus
              />
              <PasswordField
                label="Re-enter password" value={confirm}
                onChange={e => { setConfirm(e.target.value); setErrors(p => { const n={...p}; delete n.confirm; return n; }); }}
                error={errors.confirm} placeholder="••••••••••••"
                autoComplete="new-password"
              />
              {globalError && <ErrorBanner message={globalError} />}
              <PrimaryBtn type="submit" loading={loading}>
                <Users size={15} /> Join {selectedTenant.name} →
              </PrimaryBtn>
            </form>
            <button onClick={() => setStep('org-choice')}
              className="mt-4 flex items-center gap-1.5 text-[0.82rem] text-slate-400 hover:text-indigo-500 transition-colors">
              <ArrowLeft size={13} /> Back
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </SplitLayout>
  );
}
