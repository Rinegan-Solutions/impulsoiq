import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MailOpen } from 'lucide-react';
import {
  confirmSignUp, resendConfirmationCode, authErrorCode, authErrorMessage,
} from '@/lib/auth/cognito';
import {
  CardLayout, FormField, ErrorBanner, NoticeBanner, PrimaryBtn,
} from '@/components/auth/AuthUI';

// Cognito rate-limits code delivery; a short client-side cooldown stops the
// button being hammered into LimitExceededException.
const RESEND_COOLDOWN_S = 30;

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const emailFromLink = params.get('email') ?? '';
  const arrivedWithFreshCode = !!params.get('resent') && !!emailFromLink;

  const [email, setEmail]         = useState(emailFromLink);
  const [code, setCode]           = useState('');
  const [error, setError]         = useState('');
  const [notice, setNotice]       = useState(arrivedWithFreshCode ? `Your email isn't verified yet. We sent a new code to ${emailFromLink}.` : '');
  const [loading, setLoading]     = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown]   = useState(arrivedWithFreshCode ? RESEND_COOLDOWN_S : 0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function continueToSignIn(address: string) {
    navigate(`/sign-in?verified=1&email=${encodeURIComponent(address)}`, { replace: true });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address.includes('@')) { setError('Enter the email you signed up with.'); return; }
    if (code.length < 6)        { setError('Enter the 6-digit code from the email.'); return; }
    setError('');
    setNotice('');
    setLoading(true);

    try {
      await confirmSignUp(address, code);
      continueToSignIn(address);
    } catch (err) {
      // Confirming an already-confirmed account (second tab, double submit, an
      // old email) is not a failure from the user's point of view.
      if (authErrorCode(err) === 'NotAuthorizedException' && /CONFIRMED/i.test((err as Error).message ?? '')) {
        continueToSignIn(address);
        return;
      }
      setError(authErrorMessage(err, 'Could not verify that code. Please try again.'));
      setLoading(false);
    }
  }

  async function handleResend() {
    const address = email.trim();
    if (!address.includes('@')) { setError('Enter your email first, then request a new code.'); return; }
    setError('');
    setNotice('');
    setResending(true);

    try {
      await resendConfirmationCode(address);
      setNotice(`We sent a new code to ${address}. It can take a minute to arrive — check spam too.`);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      if (/already confirmed/i.test((err as Error).message ?? '')) {
        continueToSignIn(address);
        return;
      }
      setError(authErrorMessage(err, 'Could not send a new code. Please try again.'));
    } finally {
      setResending(false);
    }
  }

  return (
    <CardLayout>
      <div className="flex justify-center mb-6">
        <span className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center">
          <MailOpen size={26} className="text-indigo-600 dark:text-indigo-400" />
        </span>
      </div>

      <div className="text-center mb-7">
        <h1 className="text-[1.5rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">
          Check your email
        </h1>
        <p className="text-[0.88rem] text-slate-500 dark:text-slate-400 leading-relaxed">
          {emailFromLink ? (
            <>We sent a verification code to{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">{emailFromLink}</span>.</>
          ) : 'Enter your email and the verification code we sent you.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {notice && <NoticeBanner message={notice} />}

        {!emailFromLink && (
          <FormField
            label="Work email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(''); }}
            autoComplete="email"
            autoFocus
          />
        )}

        <FormField
          label="Verification code"
          type="text"
          inputMode="numeric"
          placeholder="000000"
          maxLength={6}
          value={code}
          onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
          autoComplete="one-time-code"
          required
          autoFocus={!!emailFromLink}
        />

        {error && <ErrorBanner message={error} />}

        <PrimaryBtn type="submit" loading={loading}>
          Verify email →
        </PrimaryBtn>
      </form>

      <p className="mt-5 text-center text-[0.8rem] text-slate-400 dark:text-slate-600">
        Didn't get a code?{' '}
        <button
          type="button"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed"
        >
          {resending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
        </button>
      </p>

      <p className="mt-4 text-center">
        <Link
          to="/sign-in"
          className="inline-flex items-center gap-1.5 text-[0.8rem] text-slate-400 hover:text-indigo-500 transition-colors"
        >
          <ArrowLeft size={13} /> Back to sign in
        </Link>
      </p>
    </CardLayout>
  );
}
