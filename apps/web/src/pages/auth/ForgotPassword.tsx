import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { forgotPassword, confirmForgotPassword } from '@/lib/auth/cognito';
import {
  CardLayout, AuthHeading,
  FormField, PasswordField, ErrorBanner, PrimaryBtn,
} from '@/components/auth/AuthUI';
import { motion, AnimatePresence } from 'framer-motion';

type Step = 'request' | 'confirm' | 'done';

export default function ForgotPassword() {
  const [step, setStep]           = useState<Step>('request');
  const [email, setEmail]         = useState('');
  const [code, setCode]           = useState('');
  const [newPassword, setNewPass] = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(email);
      setStep('confirm');
    } catch (err) {
      setError((err as Error).message ?? 'Could not send reset code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await confirmForgotPassword(email, code, newPassword);
      setStep('done');
    } catch (err) {
      setError((err as Error).message ?? 'Could not reset password. Check your code and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <CardLayout>
      <AnimatePresence mode="wait" initial={false}>

        {/* ── Step 1: Enter email ── */}
        {step === 'request' && (
          <motion.div
            key="request"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <AuthHeading
              title="Reset your password"
              sub="Enter your email and we'll send a reset code."
            />
            <form onSubmit={handleRequest} className="flex flex-col gap-4" noValidate>
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

        {/* ── Step 2: Enter code + new password ── */}
        {step === 'confirm' && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <AuthHeading
              title="Enter your reset code"
              sub={`We sent a 6-digit code to ${email}.`}
            />
            <form onSubmit={handleConfirm} className="flex flex-col gap-4" noValidate>
              <FormField
                label="Reset code"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={8}
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
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
              {error && <ErrorBanner message={error} />}
              <PrimaryBtn type="submit" loading={loading}>
                Set new password →
              </PrimaryBtn>
            </form>
            <button
              onClick={() => { setStep('request'); setError(''); }}
              className="mt-4 w-full text-center text-[0.8rem] text-slate-400 hover:text-indigo-500 transition-colors"
            >
              Didn't receive a code? Resend
            </button>
          </motion.div>
        )}

        {/* ── Step 3: Success ── */}
        {step === 'done' && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="text-center py-4"
          >
            <div className="flex justify-center mb-5">
              <span className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-emerald-600 dark:text-emerald-400" />
              </span>
            </div>
            <h2 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">
              Password updated
            </h2>
            <p className="text-[0.88rem] text-slate-500 dark:text-slate-400 mb-7">
              Your password has been reset successfully. Sign in with your new password.
            </p>
            <Link
              to="/sign-in"
              className="inline-flex items-center justify-center w-full h-11 rounded-xl font-semibold text-white text-sm bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/30 hover:-translate-y-0.5 transition-all"
            >
              Go to sign in →
            </Link>
          </motion.div>
        )}

      </AnimatePresence>
    </CardLayout>
  );
}
