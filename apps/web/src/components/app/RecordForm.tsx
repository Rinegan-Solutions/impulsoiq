import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-white/[0.1]"
          >
            Cancel
          </button>
          <button type="submit" disabled={busy} className={cn('px-4 py-2 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 disabled:opacity-40')}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Field({ label, children, asLabel = true }: { label: string; children: React.ReactNode; asLabel?: boolean }) {
  const Tag = asLabel ? 'label' : 'div';
  return (
    <Tag className="block">
      <span className="block text-[0.75rem] font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}</span>
      {children}
    </Tag>
  );
}

export const fieldClass =
  'w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#0a1220] text-sm text-slate-900 dark:text-white';

/** Opaque native select so option lists match the app theme on Windows. */
export const selectClass = cn(
  fieldClass,
  '[color-scheme:light] dark:[color-scheme:dark]',
);

/** Native list so the field is a dropdown of suggestions and still accepts any value. */
export function SuggestInput({
  value,
  onChange,
  options,
  listId,
  placeholder,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  listId: string;
  placeholder?: string;
  required?: boolean;
}) {
  const seen = new Set<string>();
  const unique = options.filter((o) => {
    const k = o.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <>
      <input
        required={required}
        list={listId}
        className={fieldClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      <datalist id={listId}>
        {unique.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

/**
 * Theme-owned listbox. Native &lt;select&gt; option popups follow OS chrome, not
 * Tailwind dark: — Windows often renders white text on a light menu.
 */
export function RecordSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  loading,
  required,
  allowEmpty = true,
  emptyLabel = 'None',
  searchPlaceholder = 'Search…',
  emptyHint,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  loading?: boolean;
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  searchPlaceholder?: string;
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return options;
    return options.filter((o) => o.label.toLowerCase().includes(n));
  }, [options, q]);

  const display = loading
    ? 'Loading companies…'
    : selected?.label ?? (allowEmpty ? emptyLabel : placeholder);

  return (
    <div ref={wrapRef} className="relative">
      {required ? (
        <input
          tabIndex={-1}
          required
          value={value}
          onChange={() => undefined}
          className="absolute w-px h-px opacity-0 pointer-events-none"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        disabled={loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((p) => !p)}
        className={cn(fieldClass, 'flex items-center justify-between gap-2 text-left disabled:opacity-60')}
      >
        <span className={cn('truncate', !selected && !loading && 'text-slate-400 dark:text-slate-500')}>{display}</span>
        <ChevronDown size={14} className="shrink-0 text-slate-400" />
      </button>
      {open && !loading ? (
        <div className="absolute z-[80] mt-1 w-full rounded-xl border border-slate-200 dark:border-white/[0.12] bg-white dark:bg-[#0a1220] shadow-lg shadow-slate-900/10 dark:shadow-black/50 overflow-hidden">
          {options.length > 6 ? (
            <input
              autoFocus
              className="w-full h-9 px-3 border-b border-slate-100 dark:border-white/[0.08] bg-white dark:bg-[#0a1220] text-sm text-slate-900 dark:text-white placeholder:text-slate-400"
              placeholder={searchPlaceholder}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          ) : null}
          <ul id={listId} role="listbox" className="max-h-48 overflow-y-auto py-1">
            {allowEmpty ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className="w-full text-left px-3 py-2 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.06]"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {emptyLabel}
                </button>
              </li>
            ) : null}
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-white/[0.06]',
                    o.value === value ? 'font-semibold text-indigo-600 dark:text-indigo-300' : 'text-slate-800 dark:text-slate-100',
                  )}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {!filtered.length ? (
              <li className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">No matching companies</li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {!loading && options.length === 0 && emptyHint ? (
        <p className="mt-1 text-[0.72rem] text-slate-500 dark:text-slate-400">{emptyHint}</p>
      ) : null}
    </div>
  );
}
