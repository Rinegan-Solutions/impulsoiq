import { FormEvent } from 'react';
import { cn } from '@/lib/utils';

export function RecordForm({
  title,
  onClose,
  onSubmit,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <form
        onSubmit={onSubmit}
        className="relative w-full sm:max-w-md bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.1] rounded-t-2xl sm:rounded-2xl p-5 shadow-xl"
      >
        <h2 className="text-[1rem] font-bold text-slate-900 dark:text-white mb-4">{title}</h2>
        <div className="space-y-3">{children}</div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm font-semibold text-slate-600 rounded-xl border border-slate-200 dark:border-white/[0.1]">Cancel</button>
          <button type="submit" disabled={busy} className={cn('px-4 py-2 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 disabled:opacity-40')}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[0.75rem] font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

export const fieldClass =
  'w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-sm text-slate-900 dark:text-white';
