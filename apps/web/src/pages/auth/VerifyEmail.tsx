import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, MailOpen } from 'lucide-react';
import { confirmSignUp } from '@/lib/auth/cognito';
import {
  CardLayout, FormField, ErrorBanner, PrimaryBtn,
} from '@/components/auth/AuthUI';
import { motion, AnimatePresence } from 'framer-motion';

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';

  const [code, setCode]     = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone]     = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.length < 4) { setError('Please enter the full verification code.'); return; }
    setError('');
    setLoading(true);
    try {
      await confirmSignUp(email, code);
      setDone(true);
    } catch (err) {
      setError((err as Error).message ?? 'Invalid code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <CardLayout>
      <AnimatePresence mode="wait" initial={false}>

        {!done ? (
          <motion.div
            key="verify"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Icon */}
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
                We sent a verification code to{' '}
                {email ? (
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{email}</span>
                ) : 'your email address'}.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <FormField
                label="Verification code"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={8}
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
                required
                autoFocus
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
                className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                onClick={() => {
                  // In production: call resendConfirmationCode
                  setError('');
                  alert('Resend triggered — implement resendConfirmationCode in cognito.ts');
                }}
              >
                Resend
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
          </motion.div>
        ) : (
          <motion.div
            key="success"
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
              Email verified!
            </h2>
            <p className="text-[0.88rem] text-slate-500 dark:text-slate-400 mb-7 leading-relaxed">
              Your account is ready. Sign in to launch your first AI agent.
            </p>
            <button
              onClick={() => navigate('/sign-in')}
              className="inline-flex items-center justify-center w-full h-11 rounded-xl font-semibold text-white text-sm bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/30 hover:-translate-y-0.5 transition-all"
            >
              Go to sign in →
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </CardLayout>
  );
}
