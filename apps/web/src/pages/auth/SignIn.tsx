import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { signIn } from '@/lib/auth/cognito';
import {
  SplitLayout, BrandPanel, AuthHeading,
  FormField, PasswordField, ErrorBanner, PrimaryBtn,
} from '@/components/auth/AuthUI';

const PANEL = (
  <BrandPanel
    heading="Close more deals with AI agents that never sleep."
    sub="ImpulsoIQ agents research leads, write outreach, make qualification calls, and update your CRM — 24/7."
    bullets={[
      '5,000+ personalized touches per day per campaign',
      'AI voice calls that qualify and book meetings',
      'Every interaction logged to CRM automatically',
    ]}
    quote={{
      text: "We went from 200 touches a week to over 3,000. ImpulsoIQ turned each SDR into a force multiplier.",
      author: 'Rania Khalid',
      role: 'VP Sales · Meridian Health',
    }}
  />
);

export default function SignIn() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      // Full reload so useAuth re-evaluates the new Cognito session
      window.location.replace('/contacts');
    } catch (err) {
      setError((err as Error).message ?? 'Sign-in failed. Please try again.');
      setLoading(false);
    }
  }

  return (
    <SplitLayout panel={PANEL}>
      <AuthHeading
        title="Welcome back"
        sub="Sign in to your ImpulsoIQ workspace"
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
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

        <PasswordField
          label="Password"
          labelRight={
            <Link to="/forgot-password" className="text-[0.8rem] text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
              Forgot password?
            </Link>
          }
          value={password}
          onChange={e => { setPassword(e.target.value); setError(''); }}
          placeholder="••••••••••••"
          required
          autoComplete="current-password"
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
