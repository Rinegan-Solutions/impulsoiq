import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, Plus, MoreHorizontal, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { contactsApi } from '@/api/client';
import type { Contact } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

const STAGE_CLS: Record<string, string> = {
  'Prospecting': 'bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-400',
  'Qualified':   'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  'Demo Booked': 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'Proposal':    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'Negotiating': 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  'Closed Won':  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

function scoreBadge(score?: number) {
  if (!score) return 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-500';
  if (score >= 90) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400';
  if (score >= 75) return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400';
  return 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400';
}

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)       return 'Just now';
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const PAGE_SIZE = 15;

export default function ContactsPage() {
  const [contacts, setContacts]   = useState<Contact[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState('');
  const [debouncedSearch, setDS]  = useState('');
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<Set<string>>(new Set());

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDS(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await contactsApi.list(page, PAGE_SIZE, debouncedSearch);
      setContacts(res.items);
      setTotal(res.total);
    } catch { /* handle error */ }
    finally { setLoading(false); }
  }, [page, debouncedSearch]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const toggleAll = () => setSelected(s => s.size === contacts.length ? new Set() : new Set(contacts.map(c => c.id)));
  const toggleOne = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AppShell>
      <SEO title="Contacts — ImpulsoIQ" description="CRM contact management" />
      <div className="px-4 sm:px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Contacts</h1>
            <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">{total.toLocaleString()} total contacts</p>
          </div>
          <button className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5 transition-all">
            <Plus size={15} /> Add contact
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, email, or company…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-8 pr-3 text-sm rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
            />
          </div>
          {selected.size > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 rounded-xl text-[0.8rem] font-semibold text-indigo-700 dark:text-indigo-300"
            >
              {selected.size} selected
              <button className="hover:text-indigo-900 dark:hover:text-indigo-100">Add to campaign →</button>
            </motion.div>
          )}
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
          {/* Head */}
          <div
            className="grid px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 bg-slate-50/60 dark:bg-white/[0.02]"
            style={{ gridTemplateColumns: '40px 1fr 160px 140px 90px 90px 80px 40px' }}
          >
            <span className="flex items-center">
              <input type="checkbox" className="rounded" checked={selected.size === contacts.length && contacts.length > 0} onChange={toggleAll} />
            </span>
            <span className="flex items-center gap-1 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300">Name <ArrowUpDown size={10} /></span>
            <span>Company</span>
            <span>Title</span>
            <span className="text-center">Stage</span>
            <span className="text-center">Score</span>
            <span>Last active</span>
            <span />
          </div>

          {/* Rows */}
          {loading ? (
            <div className="py-16 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">Loading contacts…</div>
          ) : contacts.length === 0 ? (
            <div className="py-16 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">
              {debouncedSearch ? `No contacts matching "${debouncedSearch}"` : 'No contacts yet'}
            </div>
          ) : (
            contacts.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                className="grid px-4 py-3 border-b border-slate-50 dark:border-white/[0.03] last:border-0 items-center text-[0.82rem] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors group cursor-pointer"
                style={{ gridTemplateColumns: '40px 1fr 160px 140px 90px 90px 80px 40px' }}
              >
                <span onClick={e => { e.stopPropagation(); toggleOne(c.id); }}>
                  <input type="checkbox" className="rounded" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} />
                </span>
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-[0.6rem] font-bold flex items-center justify-center flex-shrink-0">
                    {c.firstName[0]}{c.lastName[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{c.firstName} {c.lastName}</p>
                    <p className="text-[0.72rem] text-slate-400 dark:text-slate-600 truncate">{c.email}</p>
                  </div>
                </div>
                <span className="text-slate-600 dark:text-slate-400 truncate">{c.accountName ?? '—'}</span>
                <span className="text-slate-500 dark:text-slate-500 truncate">{c.title}</span>
                <span className="text-center">
                  {c.stage && <span className={cn('text-[0.65rem] font-semibold px-2 py-0.5 rounded-lg', STAGE_CLS[c.stage])}>{c.stage}</span>}
                </span>
                <span className="text-center">
                  {c.score != null && <span className={cn('text-[0.7rem] font-bold px-1.5 py-0.5 rounded-md', scoreBadge(c.score))}>{c.score}</span>}
                </span>
                <span className="text-[0.72rem] text-slate-400 dark:text-slate-600">{timeAgo(c.lastActivityAt ?? undefined)}</span>
                <button className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.07] text-slate-400 transition-all ml-auto">
                  <MoreHorizontal size={13} />
                </button>
              </motion.div>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-[0.8rem]">
            <span className="text-slate-500 dark:text-slate-500">
              {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()} contacts
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 dark:border-white/[0.1] disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition">
                <ChevronLeft size={14} />
              </button>
              <span className="px-3 text-slate-600 dark:text-slate-400">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 dark:border-white/[0.1] disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
