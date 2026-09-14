import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth, roleOf } from '@/lib/auth/useAuth';
import { refreshSessionTokens } from '@/lib/auth/cognito';
import { CONTACT } from '@/lib/contact';
import { CardLayout, NoticeBanner } from './AuthUI';

/**
 * Shown to a signed-in account that holds a workspace claim but no workspace
 * group.
 *
 * Membership is granted only by tenant-provisioner, and the API refuses any
 * account without it. So an account whose provisioning failed would otherwise
 * land on screens where every request is rejected. Groups are baked into the
 * ID token at sign-in, so "Check again" forces fresh tokens rather than
 * re-reading the cached ones.
 */
export default function WorkspaceNotReady() {
  const { user, refresh, signOut } = useAuth();
  const [checking, setChecking]   = useState(false);
  const [stillWaiting, setWaiting] = useState(false);
  if (!user) return null;

  async function checkAgain() {
    setChecking(true);
    setWaiting(false);
    try { await refreshSessionTokens(); } catch { /* fall through to a plain re-read */ }
    const next = await refresh();
    setChecking(false);
    setWaiting(!!next && !roleOf(next));
  }

  return (
    <CardLayout>
      <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">
        Your workspace isn't ready yet
      </h1>
      <p className="text-[0.88rem] text-slate-500 dark:text-slate-400 leading-relaxed mb-5">
        You're signed in as <span className="font-semibold text-slate-700 dark:text-slate-300">{user.email}</span>,
        but the account hasn't been added to the{' '}
        <span className="font-semibold text-slate-700 dark:text-slate-300">{user.tenantId}</span> workspace, so it can't open any workspace data.
        If this persists, contact{' '}
        <a href={`mailto:${CONTACT.support}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{CONTACT.support}</a>.
      </p>
      {stillWaiting && (
        <div className="mb-4">
          <NoticeBanner message="Still not set up. We've checked again with a fresh session." />
        </div>
      )}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={checkAgain}
          disabled={checking}
          className="inline-flex items-center justify-center w-full h-11 rounded-xl font-semibold text-white text-sm bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-60 transition-all"
        >
          {checking ? <Loader2 size={16} className="animate-spin" /> : 'Check again'}
        </button>
        <button
          type="button"
          onClick={() => { void signOut(); }}
          className="inline-flex items-center justify-center w-full h-11 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/[0.12] transition-all"
        >
          Sign out
        </button>
      </div>
    </CardLayout>
  );
}
