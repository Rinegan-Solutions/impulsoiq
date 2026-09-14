import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { contactsApi, tenantApi } from '@/api/client';
import { useAuth, roleOf } from '@/lib/auth/useAuth';
import type { Activity, Contact, EnrichmentRecord } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { ActivityTimeline } from '@/components/app/ActivityTimeline';
import { SEO } from '@/components/SEO';

export default function ContactDetailPage() {
  const { id } = useParams();
  const [contact, setContact] = useState<Contact | null>(null);
  const [items, setItems] = useState<Activity[]>([]);
  const [records, setRecords] = useState<EnrichmentRecord[]>([]);
  const { user } = useAuth();
  const canErase = !!user && (roleOf(user) === 'admin' || roleOf(user) === 'manager');
  const [dsarNotice, setDsarNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void Promise.all([
      contactsApi.get(id),
      contactsApi.activity(id),
      contactsApi.enrichment(id).catch(() => [] as EnrichmentRecord[]),
    ])
      .then(([c, act, rec]) => {
        setContact(c);
        setItems(act.items);
        setRecords(rec);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load contact'));
  }, [id]);

  return (
    <AppShell>
      <SEO title={contact ? `${contact.firstName} ${contact.lastName}` : 'Contact'} description="Contact record" />
      <div className="px-4 sm:px-6 py-6 max-w-3xl">
        {error && <p className="text-amber-700 text-sm mb-4">{error}</p>}
        {!contact && !error && <p className="text-slate-400 text-sm">Loading…</p>}
        {contact && (
          <>
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 mb-2">Contact</p>
            <h1 className="text-[1.35rem] font-extrabold text-slate-900 dark:text-white">
              {contact.firstName} {contact.lastName}
            </h1>
            <p className="text-[0.84rem] text-slate-500 mt-1">{contact.email ?? 'No email'} · {contact.title ?? 'No title'} · {contact.stage}</p>
            {contact.accountId && (
              <p className="mt-2 text-[0.84rem]">
                Company:{' '}
                <Link to={`/accounts/${contact.accountId}`} className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                  {contact.accountName ?? contact.accountId}
                </Link>
              </p>
            )}
            <h2 className="mt-8 mb-3 text-[0.9rem] font-bold text-slate-800 dark:text-slate-100">Enrichment</h2>
            {records.length === 0 ? (
              <p className="text-[0.82rem] text-slate-400 mb-6">No attributed sources yet. A gap here is honest — we do not invent industry or headcount.</p>
            ) : (
              <ul className="mb-6 space-y-1.5">
                {records.map((r, i) => (
                  <li key={r.id ?? `${r.source}-${r.field}-${i}`} className="text-[0.8rem] flex gap-2 border-b border-slate-100 dark:border-white/[0.04] py-1.5">
                    <span className="font-semibold w-28 shrink-0">{r.field}</span>
                    <span className="flex-1 truncate">{r.value ?? '—'}</span>
                    <span className="text-slate-400">{r.source} · {Math.round(Number(r.confidence) * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
            <h2 className="mt-8 mb-3 text-[0.9rem] font-bold text-slate-800 dark:text-slate-100">Activity</h2>
            <ActivityTimeline items={items} />
            <h2 className="mt-8 mb-3 text-[0.9rem] font-bold text-slate-800 dark:text-slate-100">Data subject</h2>
            {dsarNotice && <p className="text-[0.8rem] text-amber-800 mb-2">{dsarNotice}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-xl text-[0.78rem] font-semibold border border-slate-200 dark:border-white/[0.1]"
                onClick={() => {
                  if (!id) return;
                  void tenantApi.exportDsar(id).then((data) => {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `dsar-${id}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    setDsarNotice('Export includes consent and call metadata.');
                  }).catch((err) => setDsarNotice(err instanceof Error ? err.message : 'Export failed'));
                }}
              >
                Download DSAR export
              </button>
              {canErase && (
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl text-[0.78rem] font-semibold text-rose-700 border border-rose-200"
                  onClick={() => {
                    if (!id) return;
                    if (!window.confirm('Erase this contact and agent history? Not a merge.')) return;
                    void tenantApi.eraseDsar(id).then(() => {
                      setDsarNotice('Erased.');
                      setContact(null);
                    }).catch((err) => setDsarNotice(err instanceof Error ? err.message : 'Erase failed'));
                  }}
                >
                  Erase contact
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
