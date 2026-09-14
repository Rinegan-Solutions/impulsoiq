import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { accountsApi, contactsApi, dealsApi } from '@/api/client';
import type { Account, Activity, Contact, Deal } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { ActivityTimeline } from '@/components/app/ActivityTimeline';
import { Markdown } from '@/components/app/Markdown';
import { SEO } from '@/components/SEO';

export default function AccountDetailPage() {
  const { id } = useParams();
  const [account, setAccount] = useState<Account | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [items, setItems] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    void Promise.all([
      accountsApi.get(id),
      contactsApi.list(1, 50),
      dealsApi.list(1, 50),
      accountsApi.activity(id),
    ]).then(([acc, c, d, act]) => {
      setAccount(acc);
      setContacts(c.items.filter((x) => x.accountId === id));
      setDeals(d.items.filter((x) => x.accountId === id));
      setItems(act.items);
    }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load company'))
      .finally(() => setLoading(false));
  }, [id]);

  const research = account?.enrichmentJson?.deepResearch;
  const researchNote = (() => {
    if (!research || typeof research !== 'object') return '';
    const row = research as Record<string, unknown>;
    const reasons = Array.isArray(row.reasons) ? row.reasons.map(String) : [];
    const strategies = Array.isArray(row.strategies) ? row.strategies.map(String) : [];
    const parts = [
      typeof row.goal === 'string' && row.goal ? `**Goal.** ${row.goal}` : '',
      reasons.length ? `**Why.** ${reasons.join('; ')}` : '',
      strategies.length ? `**Strategies.** ${strategies.join(', ')}` : '',
    ];
    return parts.filter(Boolean).join('\n\n');
  })();

  return (
    <AppShell>
      <SEO title={account?.name ?? 'Company'} description="Company record" />
      <div className="px-4 sm:px-6 py-6 max-w-3xl">
        {loading && <p className="text-[0.85rem] text-slate-400 dark:text-slate-600">Loading company…</p>}
        {error && <p className="text-amber-700 text-sm mb-4">{error}</p>}
        {!loading && !error && !account && (
          <p className="text-[0.85rem] text-slate-500">This company is not in this workspace.</p>
        )}
        {account && (
          <>
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 mb-2">Company</p>
            <h1 className="text-[1.35rem] font-extrabold text-slate-900 dark:text-white">{account.name}</h1>
            <p className="text-[0.84rem] text-slate-500 mt-1">
              {account.industry ?? 'Industry not set'} · {account.domain ?? 'No domain'}
            </p>
            {account.website && (
              <a href={account.website} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[0.82rem] text-indigo-600 dark:text-indigo-400 hover:underline">
                {account.website}
              </a>
            )}
            {researchNote && (
              <div className="mt-5 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1526] px-4 py-3.5">
                <h2 className="text-[0.8rem] font-bold text-slate-700 dark:text-slate-200 mb-2">From Deep Research</h2>
                <Markdown text={researchNote} />
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div>
                <h2 className="text-[0.8rem] font-bold text-slate-700 dark:text-slate-200 mb-2">Contacts</h2>
                {contacts.length === 0 && <p className="text-[0.78rem] text-slate-400">None on this company</p>}
                {contacts.map((c) => (
                  <Link key={c.id} to={`/contacts/${c.id}`} className="block text-[0.82rem] text-indigo-600 dark:text-indigo-400 py-1 hover:underline">
                    {c.firstName} {c.lastName}
                  </Link>
                ))}
              </div>
              <div>
                <h2 className="text-[0.8rem] font-bold text-slate-700 dark:text-slate-200 mb-2">Deals</h2>
                {deals.length === 0 && <p className="text-[0.78rem] text-slate-400">None on this company</p>}
                {deals.map((d) => (
                  <p key={d.id} className="text-[0.82rem] text-slate-700 dark:text-slate-300 py-1">{d.name} · {d.stage}</p>
                ))}
              </div>
            </div>
            <h2 className="mt-8 mb-3 text-[0.9rem] font-bold text-slate-800 dark:text-slate-100">Activity</h2>
            <ActivityTimeline items={items} />
          </>
        )}
      </div>
    </AppShell>
  );
}
