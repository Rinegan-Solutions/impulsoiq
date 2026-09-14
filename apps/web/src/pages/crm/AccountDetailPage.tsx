import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { accountsApi, contactsApi, dealsApi } from '@/api/client';
import type { Account, Activity, Contact, Deal } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { ActivityTimeline } from '@/components/app/ActivityTimeline';
import { SEO } from '@/components/SEO';

export default function AccountDetailPage() {
  const { id } = useParams();
  const [account, setAccount] = useState<Account | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [items, setItems] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
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
    }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load company'));
  }, [id]);

  return (
    <AppShell>
      <SEO title={account?.name ?? 'Company'} description="Company record" />
      <div className="px-4 sm:px-6 py-6 max-w-3xl">
        {error && <p className="text-amber-700 text-sm mb-4">{error}</p>}
        {account && (
          <>
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 mb-2">Company</p>
            <h1 className="text-[1.35rem] font-extrabold text-slate-900 dark:text-white">{account.name}</h1>
            <p className="text-[0.84rem] text-slate-500 mt-1">
              {account.industry ?? 'Industry not set'} · {account.domain ?? 'No domain'}
            </p>
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
