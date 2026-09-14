/**
 * "Your team already has a workspace — ask an admin to invite you."
 *
 * WHY THIS REPLACED THE JOIN FLOW
 * Sign-up used to offer a list of workspaces matching the email's domain, and
 * joining one was granted automatically. Controlling a mailbox at a customer's
 * domain is not the same as being authorised to see their CRM, so membership
 * is now granted only by someone who already holds that authority. There is
 * nothing to press here — that is the point.
 *
 * WHAT IT MAY AND MAY NOT SHOW
 * Only what org-check returns for a domain: the workspace's display name and
 * address. Never member counts, admin names or admin addresses — the person
 * reading this has not proved they belong to the workspace, and an admin's
 * address is a phishing target.
 *
 * Creating a separate workspace stays available: a contractor or a second team
 * at the same domain is a real case, and it grants access to nothing existing.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Mail, Plus, X } from 'lucide-react';

export interface ExistingWorkspace {
  name: string;
  subdomain: string;
}

interface Props {
  open: boolean;
  workspaces: ExistingWorkspace[];
  /** The domain that matched, shown so the reader can tell which address we looked at. */
  domain: string;
  zone: string;
  onClose: () => void;
  /** Omitted on sign-in, where creating a workspace is not the action at hand. */
  onCreateNew?: () => void;
}

export default function WorkspaceExistsModal({
  open, workspaces, domain, zone, onClose, onCreateNew,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus starts inside the dialog rather than behind it.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      // Keep Tab inside the dialog; without this, focus walks the form behind it.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const primary = workspaces[0];
  const more = workspaces.length - 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-exists-title"
        className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/[0.1] shadow-2xl p-6 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
            <Building2 size={20} className="text-indigo-600 dark:text-indigo-400" />
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 -m-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <h2
          id="workspace-exists-title"
          className="mt-4 text-[1.15rem] font-bold text-slate-900 dark:text-white"
        >
          {primary ? `${primary.name} is already on ImpulsoIQ` : 'Your team is already on ImpulsoIQ'}
        </h2>

        <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-600 dark:text-slate-400">
          A workspace already exists for <span className="font-semibold text-slate-800 dark:text-slate-200">{domain}</span>.
          To join it, ask your ImpulsoIQ workspace admin to send you an invitation —
          they can do that from <span className="font-medium text-slate-700 dark:text-slate-300">Settings → Workspace → Team</span>.
          You will get an email with a link that signs you in.
        </p>

        {primary && (
          <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08]">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[0.7rem] font-bold flex items-center justify-center flex-shrink-0">
              {primary.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-[0.85rem] font-semibold text-slate-900 dark:text-white truncate">{primary.name}</p>
              <p className="text-[0.75rem] text-slate-400 dark:text-slate-500 truncate">
                {primary.subdomain}.{zone}
              </p>
            </div>
          </div>
        )}

        {more > 0 && (
          <p className="mt-2 text-[0.75rem] text-slate-400 dark:text-slate-500">
            …and {more} other workspace{more > 1 ? 's' : ''} at this domain.
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[0.875rem] font-semibold transition-colors"
          >
            <Mail size={15} /> Got it — I'll ask my admin
          </button>

          {onCreateNew && (
            <button
              type="button"
              onClick={onCreateNew}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 text-[0.85rem] font-medium hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
            >
              <Plus size={15} /> Create a separate workspace instead
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
