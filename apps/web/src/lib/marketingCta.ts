import { useAuth } from '@/lib/auth/useAuth';

/** Marketing CTAs: signed-in visitors go back into the workspace, not sign-up. */
export function useMarketingCta() {
  const { status } = useAuth();
  const inApp = status === 'signedIn';
  return {
    inApp,
    to: inApp ? '/home' : '/sign-up',
    label: inApp ? 'Open workspace' : 'Get early access',
    startLabel: inApp ? 'Open workspace' : 'Start free — no credit card',
  };
}
