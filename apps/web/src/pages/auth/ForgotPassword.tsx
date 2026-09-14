import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  forgotPassword, confirmForgotPassword, authErrorMessage, passwordProblem,
} from '@/lib/auth/cognito';
import {
  CardLayout, AuthHeading,
  FormField, PasswordField, ErrorBanner, NoticeBanner, PrimaryBtn,
} from '@/components/auth/AuthUI';
import { motion, AnimatePresence } from 'framer-motion';

type Step = 'request' | 'confirm';

const slide = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
};

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [step, setStep]           = useState<Step>('request');
  const [email, setEmail]         = useState(params.get('email') ?? '');
  const [code, setCode]           = useState('');
  const [newPassword, setNewPass] = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState('');
  const [notice, setNotice]       = useState(
    params.get('required') ? 'Your password must be reset before you can sign in.' : '',
  );
  const [loading, setLoading]     = useState(false);

  async function sendCode(address: string) {
    await forgotPassword(address);
    // prevent_user_existence_errors makes this succeed for unknown addresses
    // too, so the wording must not claim an account exists.
    setNotice(`If an account exists for ${address}, a reset code is on its way.`);
  }

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address.includes('@')) { setError('Enter the email you signed up with.'); return; }
    setError('');
    setLoading(true);
    try {
      await sendCode(address);
      setStep('confirm');
    } catch (err) {
      setError(authErrorMessage(err, 'Could not send a reset code. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    setLoading(true);
    try {
      await sendCode(email.trim());
    } catch (err) {
      setError(authErrorMessage(err, 'Could not send a new code. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (code.length < 6)         { setError('Enter the 6-digit code from the email.'); return; }
    const problem = passwordProblem(newPassword);
    if (problem)                 { setError(problem); return; }
    if (confirm !== newPassword) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);
    try {
      const address = email.trim();
      await confirmForgotPassword(address, code, newPassword);
      navigate(`/sign-in?reset=1&email=${encodeURIComponent(address)}`, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err, 'Could not reset your password. Check the code and try again.'));
      setLoading(false);
    }
  }

  return (
    <CardLayout>
      <AnimatePresence mode="wait" initial={false}>

        {step === 'request' && (
          <motion.div key="request" {...slide}>
            <AuthHeading
              title="Reset your password"
              sub="Enter your email and we'll send a reset code."
            />
            <form onSubmit={handleRequest} className="flex flex-col gap-4" noValidate>
              {notice && <NoticeBanner message={notice} />}
              <FormField
                label="Work email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                required
                autoComplete="email"
                autoFocus
              />
              {error && <ErrorBanner message={error} />}
              <PrimaryBtn type="submit" loading={loading}>
                Send reset code →
              </PrimaryBtn>
            </form>
            <p className="mt-6 text-center">
              <Link
                to="/sign-in"
                className="inline-flex items-center gap-1.5 text-[0.84rem] text-slate-500 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              >
                <ArrowLeft size={14} /> Back to sign in
              </Link>
            </p>
          </motion.div>
        )}

        {step === 'confirm' && (
          <motion.div key="confirm" {...slide}>
            <AuthHeading
              title="Enter your reset code"
              sub="Use the code from the email, then choose a new password."
            />
            <form onSubmit={handleConfirm} className="flex flex-col gap-4" noValidate>
              {notice && <NoticeBanner message={notice} />}
              <FormField
                label="Reset code"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
                autoComplete="one-time-code"
                required
                autoFocus
              />
              <PasswordField
                label="New password"
                value={newPassword}
                onChange={e => { setNewPass(e.target.value); setError(''); }}
                placeholder="12+ characters"
                hint="At least 12 characters, one uppercase and one number."
                autoComplete="new-password"
              />
              <PasswordField
                label="Re-enter password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError(''); }}
                placeholder="••••••••••••"
                autoComplete="new-password"
              />
              {error && <ErrorBanner message={error} />}
              <PrimaryBtn type="submit" loading={loading}>
                Set new password →
              </PrimaryBtn>
            </form>
            <div className="mt-4 flex items-center justify-between text-[0.8rem]">
              <button
                type="button"
                onClick={() => { setStep('request'); setError(''); setNotice(''); }}
                className="inline-flex items-center gap-1.5 text-slate-400 hover:text-indigo-500 transition-colors"
              >
                <ArrowLeft size={13} /> Change email
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={loading}
                className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline disabled:opacity-50"
              >
                Resend code
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </CardLayout>
  );
}
