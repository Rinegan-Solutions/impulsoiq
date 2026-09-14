import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { activitiesApi, controlApi } from '@/api/client';
import type { Activity } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';

function asRecords(item: Activity): { id?: string; name?: string }[] {
  const meta = item.metadata ?? {};
  const raw = meta.records;
  if (Array.isArray(raw)) return raw as { id?: string; name?: string }[];
  if (item.body) {
    try {
      const parsed = JSON.parse(item.body) as { records?: { id?: string; name?: string }[] };
      if (Array.isArray(parsed.records)) return parsed.records;
    } catch { /* not JSON */ }
  }
  return [];
}

function draftText(item: Activity): string {
  const meta = item.metadata ?? {};
  const draft = meta.draft;
  if (typeof item.body === 'string' && item.body.length > 0) return item.body;
  if (draft && typeof draft === 'object') return JSON.stringify(draft, null, 2);
  return '';
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, { subject: string; body: string }>>({});
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [survivor, setSurvivor] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      setItems(await activitiesApi.pendingApprovals());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function act(item: Activity, action: 'approve' | 'reject' | 'edit') {
    setNotice(null);
    const meta = item.metadata ?? {};
    const draft = edit[item.id] ?? { subject: item.subject ?? '', body: draftText(item) };
    const records = asRecords(item);
    const survivorId = survivor[item.id] ?? records[0]?.id;
    const duplicateId = records.find((r) => r.id && r.id !== survivorId)?.id;
    try {
      await controlApi.actApproval({
        activityId: item.id,
        action,
        subject: draft.subject,
        body: draft.body,
        allowUnverifiedEmail: override[item.id] === true,
        ...(String(meta.proposalType) === 'merge_contacts' && action === 'approve'
          ? { survivorId, duplicateId } : {}),
      });
      setNotice(action === 'reject' ? 'Rejected. The graph will not send.' : 'Recorded. If a send was waiting, Step Functions resumed.');
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Approval action failed');
    }
  }

  return (
    <AppShell>
      <SEO title="Approvals — ImpulsoIQ" description="Human-in-the-loop queue" />
      <div className="px-4 sm:px-6 py-6 max-w-3xl">
        <h1 className="text-[1.25rem] font-extrabold text-slate-900 dark:text-white">Approvals</h1>
        <p className="text-[0.82rem] text-slate-500 mt-1 mb-5">
          Drafts waiting on a task token, and hygiene proposals. Merges never run unless you pick a survivor.
        </p>
        {notice && <p className="mb-4 text-[0.82rem] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 rounded-xl px-3 py-2">{notice}</p>}
        {loading && <p className="text-slate-400 text-sm">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-[0.84rem] text-slate-400">Nothing waiting. Runs that require approval will land here.</p>
        )}
        <div className="space-y-4">
          {items.map((item) => {
            const meta = item.metadata ?? {};
            const kind = String(meta.proposalType ?? meta.kind ?? item.type);
            const records = asRecords(item);
            const draft = edit[item.id] ?? { subject: item.subject ?? '', body: draftText(item) };
            const who = [item.firstName, item.lastName].filter(Boolean).join(' ');
            return (
              <div key={item.id} className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1526] p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-[0.7rem] font-bold uppercase text-indigo-600">{kind}</p>
                    <p className="text-[0.9rem] font-bold text-slate-900 dark:text-white">{item.subject || 'Pending item'}</p>
                    {who && item.contactId && (
                      <Link to={`/contacts/${item.contactId}`} className="text-[0.78rem] text-indigo-600 hover:underline">{who}</Link>
                    )}
                    {item.accountName && item.accountId && (
                      <span className="text-[0.78rem] text-slate-500"> · <Link to={`/accounts/${item.accountId}`} className="hover:underline">{item.accountName}</Link></span>
                    )}
                  </div>
                </div>
                {kind === 'merge_contacts' && records.length >= 2 && (
                  <fieldset className="mb-3">
                    <legend className="text-[0.75rem] font-semibold text-slate-600 mb-1">Keep this contact</legend>
                    {records.map((r) => r.id && (
                      <label key={r.id} className="flex items-center gap-2 text-[0.8rem] mb-1">
                        <input
                          type="radio"
                          name={`surv-${item.id}`}
                          checked={(survivor[item.id] ?? records[0]?.id) === r.id}
                          onChange={() => setSurvivor((s) => ({ ...s, [item.id]: r.id! }))}
                        />
                        {r.name || r.id}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label className="block text-[0.72rem] font-semibold text-slate-500 mb-1">Subject</label>
                <input
                  className="w-full h-9 px-3 mb-2 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm"
                  value={draft.subject}
                  onChange={(e) => setEdit((m) => ({ ...m, [item.id]: { ...draft, subject: e.target.value } }))}
                />
                <label className="block text-[0.72rem] font-semibold text-slate-500 mb-1">Body / draft</label>
                <textarea
                  rows={6}
                  className="w-full px-3 py-2 mb-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm font-mono"
                  value={draft.body}
                  onChange={(e) => setEdit((m) => ({ ...m, [item.id]: { ...draft, body: e.target.value } }))}
                />
                <label className="flex items-center gap-2 mb-3 text-[0.78rem] text-slate-600">
                  <input
                    type="checkbox"
                    checked={override[item.id] === true}
                    onChange={(e) => setOverride((m) => ({ ...m, [item.id]: e.target.checked }))}
                  />
                  Send even if the email is unverified (explicit override)
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void act(item, 'approve')} className="px-3 py-2 rounded-xl text-[0.8rem] font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600">Approve</button>
                  <button type="button" onClick={() => void act(item, 'edit')} className="px-3 py-2 rounded-xl text-[0.8rem] font-semibold border border-indigo-200 text-indigo-700 dark:text-indigo-300">Save edits & approve</button>
                  <button type="button" onClick={() => void act(item, 'reject')} className="px-3 py-2 rounded-xl text-[0.8rem] font-semibold border border-red-200 text-red-600">Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
