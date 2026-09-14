import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronRight, Plus } from 'lucide-react';
import { accountsApi } from '@/api/client';
import type { Account } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { RecordForm, Field, fieldClass, SuggestInput } from '@/components/app/RecordForm';
import { CsvImportBar } from '@/components/app/CsvImportBar';
import { COMPANY_SAMPLE, importCompanies } from '@/lib/crmBulk';
import { COMPANY_INDUSTRIES, POPULAR_COMPANY_DOMAINS } from '@/lib/companyOptions';
import { cn } from '@/lib/utils';

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const AVATAR_COLORS = [
  'from-indigo-400 to-violet-500','from-emerald-400 to-cyan-500',
  'from-amber-400 to-orange-500', 'from-violet-400 to-pink-500',
  'from-cyan-400 to-indigo-500',  'from-rose-400 to-violet-500',
];

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', domain: '', industry: '' });
  const [saving, setSaving] = useState(false);

  async function load(term = search) {
    setLoading(true);
    try {
      const res = await accountsApi.list(1, 50, term);
      setAccounts(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => { void load(search); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await accountsApi.create({ name: form.name.trim(), domain: form.domain.trim() || undefined, industry: form.industry.trim() || undefined });
      setCreating(false);
      setForm({ name: '', domain: '', industry: '' });
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <SEO title="Companies — ImpulsoIQ" description="Company account records" />
      <div className="px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Companies</h1>
            <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">{total} accounts in this workspace</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CsvImportBar
              sampleName="companies-sample.csv"
              sampleCsv={COMPANY_SAMPLE}
              onRows={async (rows) => {
                const out = await importCompanies(rows);
                await load();
                return out;
              }}
            />
            <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600">
              <Plus size={15} /> Add company
            </button>
          </div>
        </div>

        <div className="relative max-w-sm mb-5">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Search companies…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-8 pr-3 text-sm rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
          />
        </div>

        <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
          <div className="grid px-5 py-2.5 border-b border-slate-100 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 bg-slate-50/60 dark:bg-white/[0.02]"
            style={{ gridTemplateColumns: '1fr 120px 80px 80px 120px 100px 30px' }}>
            <span>Company</span><span>Industry</span>
            <span className="text-center">Contacts</span><span className="text-center">Deals</span>
            <span>Open pipeline</span><span>Last activity</span><span />
          </div>

          {loading ? (
            <div className="py-16 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">Loading companies…</div>
          ) : accounts.length === 0 ? (
            <div className="py-16 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">
              No companies yet. Add one, import a CSV, or run{' '}
              <Link to="/research" className="text-indigo-600 font-semibold">Deep Research</Link>.
            </div>
          ) : accounts.map((acc, i) => (
            <Link
              key={acc.id}
              to={`/accounts/${acc.id}`}
              className="grid px-5 py-3.5 border-b border-slate-50 dark:border-white/[0.03] last:border-0 items-center text-[0.82rem] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors group"
              style={{ gridTemplateColumns: '1fr 120px 80px 80px 120px 100px 30px' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn('w-8 h-8 rounded-xl bg-gradient-to-br text-white text-[0.65rem] font-bold flex items-center justify-center flex-shrink-0', AVATAR_COLORS[i % AVATAR_COLORS.length])}>
                  {acc.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{acc.name}</p>
                  <p className="text-[0.7rem] text-slate-400 dark:text-slate-600">
                    {acc.domain ?? `${acc.contactCount ?? 0} contacts`}
                    {(acc.customFields?.origin === 'deep_research' || acc.enrichmentJson?.deepResearch) ? (
                      <span className="ml-1.5 text-indigo-500 dark:text-indigo-400">· Research</span>
                    ) : null}
                  </p>
                </div>
              </div>
              <span className="text-[0.75rem] bg-slate-100 dark:bg-white/[0.07] text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-lg w-fit">{acc.industry ?? '—'}</span>
              <span className="text-center font-semibold text-slate-700 dark:text-slate-300">{acc.contactCount ?? 0}</span>
              <span className="text-center font-semibold text-indigo-600 dark:text-indigo-400">{acc.dealCount ?? 0}</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {(acc.pipeline ?? 0) > 0 ? `$${((acc.pipeline ?? 0)/1000).toFixed(0)}K` : <span className="text-slate-400 dark:text-slate-600">—</span>}
              </span>
              <span className="text-[0.75rem] text-slate-400 dark:text-slate-600">{timeAgo(acc.lastActivityAt ?? undefined)}</span>
              <ChevronRight size={14} className="text-slate-300 dark:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          ))}
        </div>
      </div>
      {creating && (
        <RecordForm title="New company" onClose={() => setCreating(false)} onSubmit={(e) => void createAccount(e)} busy={saving}>
          <Field label="Name"><input required className={fieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Domain">
            <SuggestInput
              listId="company-domain-suggest"
              value={form.domain}
              onChange={(domain) => setForm({ ...form, domain })}
              placeholder="example.com"
              options={[...POPULAR_COMPANY_DOMAINS, ...accounts.map((a) => a.domain).filter((d): d is string => Boolean(d))]}
            />
          </Field>
          <Field label="Industry">
            <SuggestInput
              listId="company-industry-suggest"
              value={form.industry}
              onChange={(industry) => setForm({ ...form, industry })}
              placeholder="Software / SaaS"
              options={COMPANY_INDUSTRIES}
            />
          </Field>
        </RecordForm>
      )}
    </AppShell>
  );
}
