import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { accountsApi, contactsApi, dealsApi } from '@/api/client';
import { modesFor } from '@/lib/nav';
import { roleOf, useAuth } from '@/lib/auth/useAuth';
import { useTenant } from '@/lib/useTenant';
import { cn } from '@/lib/utils';

type Hit = { href: string; title: string; subtitle?: string };

export function CommandPalette() {
  const { user } = useAuth();
  const tenant = useTenant(user?.tenantId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);

  const routes = useMemo(() => {
    if (!user) return [];
    const modes = modesFor(roleOf(user), tenant?.tier);
    const out: Hit[] = [{ href: '/home', title: 'Home composer', subtitle: 'Describe a goal' }];
    for (const m of modes) {
      for (const c of m.children ?? []) out.push({ href: c.href, title: c.label, subtitle: m.label });
    }
    return out;
  }, [user, tenant?.tier]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) {
      setHits(routes.slice(0, 8));
      return;
    }
    const local = routes.filter((r) =>
      `${r.title} ${r.subtitle} ${r.href}`.toLowerCase().includes(term.toLowerCase()),
    );
    setHits([
      { href: `/home?intent=compose&q=${encodeURIComponent(term)}`, title: `Run on Home: “${term}”`, subtitle: 'Composer' },
      ...local.slice(0, 6),
    ]);
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      void Promise.all([
        contactsApi.list(1, 6, term).catch(() => ({ items: [] })),
        accountsApi.list(1, 6, term).catch(() => ({ items: [] })),
        dealsApi.list(1, 6).catch(() => ({ items: [] })),
      ]).then(([c, a, d]) => {
        if (cancelled) return;
        const extra: Hit[] = [
          ...c.items.map((x) => ({
            href: `/contacts/${x.id}`,
            title: `${x.firstName} ${x.lastName}`,
            subtitle: x.email ?? x.accountName ?? 'Contact',
          })),
          ...a.items.map((x) => ({
            href: `/accounts/${x.id}`,
            title: x.name,
            subtitle: x.industry ?? x.domain ?? 'Company',
          })),
          ...d.items
            .filter((x) => x.name.toLowerCase().includes(term.toLowerCase()) || (x.accountName ?? '').toLowerCase().includes(term.toLowerCase()))
            .slice(0, 6)
            .map((x) => ({ href: '/deals', title: x.name, subtitle: x.accountName ?? 'Deal' })),
        ];
        setHits((prev) => {
          const seen = new Set(prev.map((h) => h.href + h.title));
          return [...prev, ...extra.filter((h) => !seen.has(h.href + h.title))].slice(0, 20);
        });
        setBusy(false);
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, q, routes]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden sm:flex items-center gap-2 h-9 px-3.5 rounded-xl bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.07] text-[0.84rem] text-slate-400 dark:text-slate-600 hover:border-slate-300 dark:hover:border-white/15 transition-colors min-w-[220px]"
      >
        <Search size={14} />
        <span>Search records or go…</span>
        <span className="ml-auto text-[0.7rem] bg-slate-200 dark:bg-white/[0.07] px-1.5 py-0.5 rounded font-mono">⌘K</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-label="Command palette">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close search" onClick={() => setOpen(false)} />
      <div className="relative mx-auto mt-[12vh] w-full max-w-lg rounded-2xl bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.1] shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 border-b border-slate-100 dark:border-white/[0.06]">
          <Search size={14} className="text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search contacts, companies, deals, or jump to a page"
            className="w-full h-11 bg-transparent text-sm text-slate-900 dark:text-white outline-none"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {hits.map((h) => (
            <li key={`${h.href}-${h.title}`}>
              <button
                type="button"
                onClick={() => { setOpen(false); setQ(''); navigate(h.href); }}
                className={cn('w-full text-left px-4 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/10')}
              >
                <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-100">{h.title}</p>
                {h.subtitle && <p className="text-[0.72rem] text-slate-400">{h.subtitle}</p>}
              </button>
            </li>
          ))}
          {hits.length === 0 && !busy && (
            <li className="px-4 py-6 text-center text-[0.8rem] text-slate-400">No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}
