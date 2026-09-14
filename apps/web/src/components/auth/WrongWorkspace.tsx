import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth, displayNameOf } from '@/lib/auth/useAuth';
import { currentTenantSlug, workspaceHost } from '@/lib/tenant';
import { CardLayout } from './AuthUI';

/**
 * Shown when the signed-in account belongs to a different workspace than the
 * address in the browser.
 *
 * Every API call from here would be rejected by the tenant check (header slug
 * vs. the token's custom:tenant_id), so rendering the app would only produce a
 * screen full of failures. Say what happened and offer both ways out instead.
 */
export default function WrongWorkspace() {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const here = currentTenantSlug();
  const ownHost = workspaceHost(user.tenantId);
  // Sessions are stored per origin, so the user signs in again at their own address.
  const ownSignIn = `https://${ownHost}/sign-in?email=${encodeURIComponent(user.email)}`;

  return (
    <CardLayout>
      <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">
        This isn't your workspace
      </h1>
      <p className="text-[0.88rem] text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
        You're signed in as <span className="font-semibold text-slate-700 dark:text-slate-300">{displayNameOf(user)}</span>,
        a member of <span className="font-semibold text-slate-700 dark:text-slate-300">{user.tenantId}</span>.
        This address belongs to <span className="font-semibold text-slate-700 dark:text-slate-300">{here}</span>.
      </p>
      <div className="flex flex-col gap-3">
        <a
          href={ownSignIn}
          className="inline-flex items-center justify-center w-full h-11 rounded-xl font-semibold text-white text-sm bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/30 transition-all"
        >
          Go to {ownHost}
        </a>
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await signOut(); }}
          className="inline-flex items-center justify-center w-full h-11 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/[0.12] disabled:opacity-60 transition-all"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : 'Sign out and use another account'}
        </button>
      </div>
    </CardLayout>
  );
}
