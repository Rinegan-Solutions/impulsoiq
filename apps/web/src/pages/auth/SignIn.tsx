import { FormEvent, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  signIn, signOut as cognitoSignOut, getSessionUser, resendConfirmationCode,
  authErrorCode, authErrorMessage, passwordProblem,
} from '@/lib/auth/cognito';
import { useAuth } from '@/lib/auth/useAuth';
import { currentTenantSlug, workspaceHost } from '@/lib/tenant';
import { orgCheckApi } from '@/api/client';
import WorkspaceExistsModal, { type ExistingWorkspace } from '@/components/auth/WorkspaceExistsModal';
import {
  SplitLayout, BrandPanel, AuthHeading,
  FormField, PasswordField, ErrorBanner, NoticeBanner, PrimaryBtn,
} from '@/components/auth/AuthUI';

const PANEL = (
  <BrandPanel
    heading="Close more deals with AI agents that never sleep."
    sub="ImpulsoIQ agents research leads, write outreach, make qualification calls, and update your CRM — 24/7."
    bullets={[
      'Research and enrichment before every first touch',
      'Consent checked before every email, SMS and call',
      'Every agent action logged to your CRM',
    ]}
  />
);

type Step = 'credentials' | 'new-password';

const ZONE = import.meta.env.VITE_WEB_ZONE ?? 'impulsoiq.rinegansolutions.com';

export default function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refresh } = useAuth();

  const [step, setStep]               = useState<Step>('credentials');
  const [email, setEmail]             = useState(params.get('email') ?? '');
  const [password, setPassword]       = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm]         = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const completeChallenge = useRef<((newPassword: string) => Promise<void>) | null>(null);

  // Shown when someone with no account signs in at an address whose domain
  // already has a workspace — see handleCredentials.
  const [existing, setExisting] = useState<ExistingWorkspace[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const notice =
    params.get('verified') ? 'Email verified. Sign in to open your workspace.' :
    params.get('reset')    ? 'Password updated. Sign in with your new password.' : '';

  // Runs once Cognito has issued tokens, by either path.
  async function enterApp() {
    const user = await getSessionUser();
    if (!user) {
      setError('Signed in, but the session could not be read. Please try again.');
      setLoading(false);
      return;
    }
    // A workspace address serves only its own members: the API rejects any
    // other token with a tenant mismatch. Catch it here, where it can be
    // explained, rather than on every screen afterwards.
    const host = currentTenantSlug();
    if (host && host !== user.tenantId) {
      await cognitoSignOut();
      setError(`This account belongs to a different workspace. Sign in at ${workspaceHost(user.tenantId)}.`);
      setLoading(false);
      return;
    }
    // Publishing the session is what moves the user on: the public-only route
    // redirects to ?next (or the dashboard) as soon as it sees it. No full
    // reload, and no second place deciding where "after sign-in" is.
    await refresh();
  }

  async function handleCredentials(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address.includes('@')) { setError('Enter the email you signed up with.'); return; }
    if (!password)              { setError('Enter your password.'); return; }
    setError('');
    setLoading(true);

    try {
      const result = await signIn(address, password);
      if (result.kind === 'newPasswordRequired') {
        completeChallenge.current = result.complete;
        setStep('new-password');
        setLoading(false);
        return;
      }
      await enterApp();
    } catch (err) {
      const code = authErrorCode(err);

      if (code === 'UserNotConfirmedException') {
        // Right password, unverified email: usually someone who closed the tab
        // before entering their code. Send a fresh code and take them to the
        // step they missed instead of showing Cognito's error text.
        let resent = true;
        try { await resendConfirmationCode(address); } catch { resent = false; }
        navigate(`/verify?email=${encodeURIComponent(address)}${resent ? '&resent=1' : ''}`);
        return;
      }
      if (code === 'PasswordResetRequiredException') {
        navigate(`/forgot-password?email=${encodeURIComponent(address)}&required=1`);
        return;
      }
      // No account for this address. If their company already has a workspace,
      // the useful answer is not "wrong password" — it is that membership comes
      // from an admin's invitation. Cognito deliberately returns the same code
      // for an unknown user and a wrong password, so this is advisory only and
      // reveals nothing about whether the account exists: the modal's content
      // comes from org-check, which is public and keyed on the domain alone.
      if (code === 'UserNotFoundException' || code === 'NotAuthorizedException') {
        const domain = address.split('@')[1];
        if (domain) {
          try {
            const res = await orgCheckApi.byDomain(domain);
            const tenants = res.tenants.map(t => ({ name: t.name, subdomain: t.subdomain ?? '' }));
            if (tenants.length > 0) {
              setExisting(tenants);
              setModalOpen(true);
            }
          } catch {
            /* advisory only — fall through to the normal error */
          }
        }
      }
      setError(authErrorMessage(err, 'Sign-in failed. Please try again.'));
      setLoading(false);
    }
  }

  async function handleNewPassword(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(newPassword);
    if (problem)                 { setError(problem); return; }
    if (confirm !== newPassword) { setError('Passwords do not match.'); return; }
    if (!completeChallenge.current) { setStep('credentials'); return; }
    setError('');
    setLoading(true);

    try {
      await completeChallenge.current(newPassword);
      await enterApp();
    } catch (err) {
      setError(authErrorMessage(err, 'Could not set your new password. Please try again.'));
      setLoading(false);
    }
  }

  const forgotHref = `/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`;

  if (step === 'new-password') {
    return (
      <SplitLayout panel={PANEL}>
        <AuthHeading
          title="Choose a new password"
          sub="Your account was created with a temporary password. Set your own to continue."
        />
        <form onSubmit={handleNewPassword} className="flex flex-col gap-4" noValidate>
          <PasswordField
            label="New password"
            value={newPassword}
            onChange={e => { setNewPassword(e.target.value); setError(''); }}
            placeholder="12+ characters"
            hint="At least 12 characters, one uppercase and one number."
            autoComplete="new-password"
            autoFocus
          />
          <PasswordField
            label="Re-enter password"
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(''); }}
            placeholder="••••••••••••"
            autoComplete="new-password"
          />
          {error && <ErrorBanner message={error} />}
          <PrimaryBtn type="submit" loading={loading} className="mt-1">
            Set password and sign in →
          </PrimaryBtn>
        </form>
        <button
          type="button"
          onClick={() => { completeChallenge.current = null; setStep('credentials'); setPassword(''); setError(''); }}
          className="mt-5 inline-flex items-center gap-1.5 text-[0.82rem] text-slate-400 hover:text-indigo-500 transition-colors"
        >
          <ArrowLeft size={13} /> Back to sign in
        </button>
      </SplitLayout>
    );
  }

  return (
    <SplitLayout panel={PANEL}>
      <WorkspaceExistsModal
        open={modalOpen}
        workspaces={existing}
        domain={email.split('@')[1] ?? ''}
        zone={ZONE}
        onClose={() => setModalOpen(false)}
      />
      <AuthHeading
        title="Welcome back"
        sub="Sign in to your ImpulsoIQ workspace"
      />

      <form onSubmit={handleCredentials} className="flex flex-col gap-4" noValidate>
        {notice && <NoticeBanner message={notice} />}

        <FormField
          label="Work email"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(''); }}
          required
          autoComplete="email"
          autoFocus={!email}
        />

        <PasswordField
          label="Password"
          labelRight={
            <Link to={forgotHref} className="text-[0.8rem] text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
              Forgot password?
            </Link>
          }
          value={password}
          onChange={e => { setPassword(e.target.value); setError(''); }}
          placeholder="••••••••••••"
          required
          autoComplete="current-password"
          autoFocus={!!email}
        />

        {error && <ErrorBanner message={error} />}

        <PrimaryBtn type="submit" loading={loading} className="mt-1">
          Sign in →
        </PrimaryBtn>
      </form>

      <p className="text-center text-[0.84rem] text-slate-500 dark:text-slate-500 mt-6">
        Don't have an account?{' '}
        <Link to="/sign-up" className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
          Create one free
        </Link>
      </p>
    </SplitLayout>
  );
}
