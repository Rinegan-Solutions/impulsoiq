/**
 * Sign-up.
 *
 * TWO WAYS IN, AND ONLY TWO
 *   1. Create a NEW workspace. Open to anyone; grants access to nothing that
 *      already exists.
 *   2. Accept an INVITATION (?invite=<token>). The token names the workspace,
 *      the address it was issued to, and the role — none of which this screen
 *      can influence. tenant-provisioner re-checks all of it server-side.
 *
 * WHAT WAS REMOVED
 * A third path used to offer every workspace whose email_domain matched the
 * address being typed, and joining one was automatic. Controlling a mailbox at
 * a customer's domain is not the same as being authorised to see their CRM.
 * That path is now a modal that says to ask an admin for an invitation.
 */
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Users, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { signUp, authErrorMessage, passwordProblem } from '@/lib/auth/cognito';
// Shared with the CloudFront function and the tenant.id CHECK constraint —
// all three must agree or a workspace can be created that is unreachable at
// its own address.
import { toSlug, isReservedSlug, isValidSlug } from '@/lib/tenant';
import { orgCheckApi, invitationsApi } from '@/api/client';
import WorkspaceExistsModal, { type ExistingWorkspace } from '@/components/auth/WorkspaceExistsModal';
import {
  SplitLayout, BrandPanel, AuthHeading,
  FormField, PasswordField, ErrorBanner, PrimaryBtn,
} from '@/components/auth/AuthUI';

const PANEL = (
  <BrandPanel
    heading="Your AI sales team is one workspace away."
    sub="ImpulsoIQ agents research, reach out to, and qualify leads — and log every step to your CRM."
    bullets={[
      'Your own workspace at a dedicated address',
      'Colleagues join by invitation from a workspace admin',
      'Approval gates before high-stakes outreach',
    ]}
  />
);

type Step = 'email' | 'create' | 'invite';

// The environment's host, injected at build time. Hardcoding impulsoiq.com
// here showed users a URL that does not exist.
const ZONE = import.meta.env.VITE_WEB_ZONE ?? 'impulsoiq.rinegansolutions.com';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', manager: 'Manager', member: 'Member',
};

interface ResolvedInvite {
  token: string;
  email: string;
  role: string;
  tenantId: string;
  workspaceName: string;
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function SignUp() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get('invite') ?? '';

  const [step, setStep] = useState<Step>(inviteToken ? 'invite' : 'email');

  // Invitation state. `null` while resolving; `false` once known to be unusable.
  const [invite, setInvite] = useState<ResolvedInvite | null>(null);
  const [inviteDead, setInviteDead] = useState('');

  // Existing-workspace modal (replaces the old join flow)
  const [existing, setExisting] = useState<ExistingWorkspace[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  // Form fields
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [workspace, setWorkspace] = useState('');

  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading]         = useState(false);
  const [checking, setChecking]       = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Resolve an invitation link ─────────────────────────────────────────────
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await invitationsApi.resolve(inviteToken);
        if (cancelled) return;
        if (!res.valid || !res.email || !res.tenantId) {
          // The API answers every failure identically on purpose, so this text
          // covers expired, revoked, already-used and simply wrong.
          setInviteDead(res.error ?? 'This invitation link is not valid, has already been used, or has expired.');
          return;
        }
        setInvite({
          token: inviteToken,
          email: res.email,
          role: res.role ?? 'member',
          tenantId: res.tenantId,
          workspaceName: res.workspaceName ?? res.tenantId,
        });
        setEmail(res.email);
      } catch {
        if (!cancelled) setInviteDead('We could not check this invitation. Please try the link again in a moment.');
      }
    })();
    return () => { cancelled = true; };
  }, [inviteToken]);

  // ── Email → does this domain already have a workspace? ─────────────────────
  useEffect(() => {
    if (step === 'invite') return; // The invitation already names the workspace.
    if (!email.includes('@')) { setExisting([]); return; }
    const domain = email.split('@')[1];
    if (!domain) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await orgCheckApi.byDomain(domain);
        setExisting(res.tenants.map(t => ({ name: t.name, subdomain: t.subdomain ?? '' })));
      } catch {
        // A failed lookup must not block sign-up: it only decides whether to
        // show an advisory modal, and PreSignUp is the actual gate.
        setExisting([]);
      } finally {
        setChecking(false);
      }
    }, 600);
  }, [email, step]);

  // ── Step 1: email + name ───────────────────────────────────────────────────
  function handleEmailContinue(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim())         errs.name  = 'Full name is required.';
    if (!email.includes('@')) errs.email = 'Enter a valid work email.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});

    if (existing.length > 0) { setModalOpen(true); return; }
    setStep('create');
  }

  // ── Submit: create a new workspace ─────────────────────────────────────────
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!workspace.trim()) {
      errs.workspace = 'Workspace name is required.';
    } else {
      // The slug becomes a DNS label, a database primary key and the tenant
      // claim, so it is validated here against the same rules all three use.
      const slug = toSlug(workspace);
      if (!slug)                     errs.workspace = 'Use at least one letter or number.';
      else if (isReservedSlug(slug)) errs.workspace = `"${slug}" is reserved. Please choose another name.`;
      else if (!isValidSlug(slug))   errs.workspace = 'Use 2-40 letters, numbers or hyphens.';
    }
    const pwProblem = passwordProblem(password);
    if (pwProblem)            errs.password = pwProblem;
    if (confirm !== password) errs.confirm  = 'Passwords do not match.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({}); setGlobalError(''); setLoading(true);

    try {
      const tenantId = toSlug(workspace) || toSlug(email.split('@')[0]);
      await signUp(email.trim(), password, tenantId, name.trim(), workspace.trim());
      navigate(`/verify?email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      setGlobalError(authErrorMessage(err, 'Sign-up failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  // ── Submit: accept an invitation ───────────────────────────────────────────
  async function handleAccept(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Full name is required.';
    const pwProblem = passwordProblem(password);
    if (pwProblem)            errs.password = pwProblem;
    if (confirm !== password) errs.confirm  = 'Passwords do not match.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({}); setGlobalError(''); setLoading(true);

    try {
      // The token travels as Cognito client metadata, never as a user
      // attribute: attributes are stored on the account and readable
      // afterwards, and this is a credential. PreSignUp verifies it names this
      // workspace AND this address; the role comes from the invitation row at
      // confirmation, so nothing sent from here can choose it.
      await signUp(
        invite.email, password, invite.tenantId, name.trim(), undefined,
        { inviteToken: invite.token },
      );
      navigate(`/verify?email=${encodeURIComponent(invite.email)}`);
    } catch (err) {
      setGlobalError(authErrorMessage(err, 'Sign-up failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  const slideIn = { initial: { opacity: 0, x: 20 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -20 } };
  const transition = { duration: 0.3, ease };

  return (
    <SplitLayout panel={PANEL}>
      <WorkspaceExistsModal
        open={modalOpen}
        workspaces={existing}
        domain={email.split('@')[1] ?? ''}
        zone={ZONE}
        onClose={() => setModalOpen(false)}
        onCreateNew={() => { setModalOpen(false); setStep('create'); }}
      />

      <AnimatePresence mode="wait" initial={false}>

        {/* ── Invitation: resolving, dead, or ready ── */}
        {step === 'invite' && (
          <motion.div key="invite" {...slideIn} transition={transition}>
            {inviteDead ? (
              <>
                <AuthHeading title="This invitation can't be used" sub={inviteDead} />
                <p className="text-[0.875rem] text-slate-600 dark:text-slate-400 mb-5">
                  Ask your ImpulsoIQ workspace admin to send a new one — invitations expire after 7 days
                  and can only be used once.
                </p>
                <Link
                  to="/sign-in"
                  className="text-[0.84rem] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
                >
                  Back to sign in
                </Link>
              </>
            ) : !invite ? (
              <p className="text-[0.875rem] text-slate-500 dark:text-slate-400">Checking your invitation…</p>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-6 p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25">
                  <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                    {invite.workspaceName.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[0.875rem] font-semibold text-indigo-800 dark:text-indigo-200 truncate">
                      Joining {invite.workspaceName}
                    </p>
                    <p className="text-[0.75rem] text-indigo-600 dark:text-indigo-400 truncate">
                      {invite.tenantId}.{ZONE} · {ROLE_LABEL[invite.role] ?? invite.role}
                    </p>
                  </div>
                </div>

                <AuthHeading
                  title="Accept your invitation"
                  sub={`Set a password for ${invite.email} to join the workspace.`}
                />

                <form onSubmit={handleAccept} className="flex flex-col gap-4" noValidate>
                  <FormField
                    label="Full name" type="text" placeholder="Alex Johnson"
                    value={name}
                    onChange={e => { setName(e.target.value); setErrors(p => { const n={...p}; delete n.name; return n; }); }}
                    error={errors.name} autoComplete="name" autoFocus
                  />
                  {/* Locked: the invitation was issued to this address, and the
                      server refuses any other. Editable here would only fail. */}
                  <FormField
                    label="Work email" type="email" value={invite.email}
                    onChange={() => {}} readOnly disabled
                    hint="This invitation was sent to this address."
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
                  <PrimaryBtn type="submit" loading={loading}>
                    <Users size={15} /> Join {invite.workspaceName} →
                  </PrimaryBtn>
                  <p className="text-center text-[0.72rem] text-slate-400 dark:text-slate-600">
                    By continuing you agree to our{' '}
                    <Link to="/terms" className="text-indigo-500 hover:underline">Terms</Link> and{' '}
                    <Link to="/privacy" className="text-indigo-500 hover:underline">Privacy Policy</Link>.
                  </p>
                </form>
              </>
            )}
          </motion.div>
        )}

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
            <p className="flex items-start gap-2 text-[0.75rem] text-slate-400 dark:text-slate-600 mt-4">
              <ShieldCheck size={14} className="mt-[1px] flex-shrink-0" />
              Joining a workspace that already exists needs an invitation from one of its admins.
            </p>
            <p className="text-center text-[0.84rem] text-slate-500 dark:text-slate-500 mt-5">
              Already have an account?{' '}
              <Link to="/sign-in" className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">Sign in</Link>
            </p>
          </motion.div>
        )}

        {/* ── Step 2: Create workspace ── */}
        {step === 'create' && (
          <motion.div key="create" {...slideIn} transition={transition}>
            <AuthHeading title="Set up your workspace" sub="This will be your team's ImpulsoIQ home." />
            <form onSubmit={handleCreate} className="flex flex-col gap-4" noValidate>
              <FormField
                label="Workspace name" type="text" placeholder="Acme Corp"
                value={workspace}
                onChange={e => { setWorkspace(e.target.value); setErrors(p => { const n={...p}; delete n.workspace; return n; }); }}
                error={errors.workspace}
                hint={workspace ? `Your URL: ${toSlug(workspace)}.${ZONE}` : 'Letters and numbers — this becomes your workspace URL.'}
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
                <Link to="/terms" className="text-indigo-500 hover:underline">Terms</Link> and{' '}
                <Link to="/privacy" className="text-indigo-500 hover:underline">Privacy Policy</Link>.
              </p>
            </form>
            <button onClick={() => setStep('email')}
              className="mt-4 flex items-center gap-1.5 text-[0.82rem] text-slate-400 hover:text-indigo-500 transition-colors">
              <ArrowLeft size={13} /> Back
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </SplitLayout>
  );
}
