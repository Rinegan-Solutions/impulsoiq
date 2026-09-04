import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, ChevronRight } from 'lucide-react';
import { contactsApi, dealsApi } from '@/api/client';
import type { Contact, Deal } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

interface Account {
  company:   string;
  industry:  string;
  contacts:  Contact[];
  deals:     Deal[];
  pipeline:  number;
  topScore:  number;
  lastActivity?: string;
}

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
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');

  useEffect(() => {
    Promise.all([
      contactsApi.list(1, 100),
      dealsApi.list(),
    ]).then(([contactsRes, dealsRes]) => {
      const contactList = contactsRes.items;
      const dealList    = dealsRes.items;

      const map = new Map<string, Account>();
      // "Company" is account.name, joined onto both contacts and deals by
      // list_contacts / list_deals. A contact with no account_id has no company
      // and cannot be grouped, so it is skipped rather than bucketed under a
      // placeholder that would look like a real account.
      contactList.forEach(c => {
        const company = c.accountName;
        if (!company) return;
        if (!map.has(company)) {
          map.set(company, {
            company, industry: 'Unknown',
            contacts: [], deals: [], pipeline: 0, topScore: 0,
          });
        }
        const acc = map.get(company)!;
        acc.contacts.push(c);
        if ((c.score ?? 0) > acc.topScore) acc.topScore = c.score ?? 0;
        if (!acc.lastActivity || (c.lastActivityAt && c.lastActivityAt > acc.lastActivity))
          acc.lastActivity = c.lastActivityAt ?? undefined;
      });

      dealList.forEach((d) => {
        if (!d.accountName) return;
        const acc = map.get(d.accountName);
        if (!acc) return;
        acc.deals.push(d);
        if (d.stage !== 'Closed Won') acc.pipeline += d.amount;
      });

      setAccounts([...map.values()].sort((a, b) => b.pipeline - a.pipeline || b.contacts.length - a.contacts.length));
    }).finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? accounts.filter(a => a.company.toLowerCase().includes(search.toLowerCase()) || a.industry.toLowerCase().includes(search.toLowerCase()))
    : accounts;

  return (
    <AppShell>
      <SEO title="Accounts — ImpulsoIQ" description="Company account management" />
      <div className="px-4 sm:px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Accounts</h1>
            <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">{accounts.length} companies tracked</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm mb-5">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Search companies or industries…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-8 pr-3 text-sm rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
          />
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
          <div className="grid px-5 py-2.5 border-b border-slate-100 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 bg-slate-50/60 dark:bg-white/[0.02]"
            style={{ gridTemplateColumns: '1fr 120px 80px 80px 120px 100px 30px' }}>
            <span>Company</span><span>Industry</span>
            <span className="text-center">Contacts</span><span className="text-center">Deals</span>
            <span>Open pipeline</span><span>Last activity</span><span />
          </div>

          {loading ? (
            <div className="py-16 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">Loading accounts…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">No accounts found</div>
          ) : filtered.map((acc, i) => (
            <motion.div
              key={acc.company}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.025 }}
              className="grid px-5 py-3.5 border-b border-slate-50 dark:border-white/[0.03] last:border-0 items-center text-[0.82rem] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer group"
              style={{ gridTemplateColumns: '1fr 120px 80px 80px 120px 100px 30px' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn('w-8 h-8 rounded-xl bg-gradient-to-br text-white text-[0.65rem] font-bold flex items-center justify-center flex-shrink-0', AVATAR_COLORS[i % AVATAR_COLORS.length])}>
                  {acc.company.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{acc.company}</p>
                  <p className="text-[0.7rem] text-slate-400 dark:text-slate-600">{acc.contacts.length} contact{acc.contacts.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <span className="text-[0.75rem] bg-slate-100 dark:bg-white/[0.07] text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-lg w-fit">{acc.industry}</span>
              <span className="text-center font-semibold text-slate-700 dark:text-slate-300">{acc.contacts.length}</span>
              <span className="text-center font-semibold text-indigo-600 dark:text-indigo-400">{acc.deals.length}</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {acc.pipeline > 0 ? `$${(acc.pipeline/1000).toFixed(0)}K` : <span className="text-slate-400 dark:text-slate-600">—</span>}
              </span>
              <span className="text-[0.75rem] text-slate-400 dark:text-slate-600">{timeAgo(acc.lastActivity)}</span>
              <ChevronRight size={14} className="text-slate-300 dark:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
            </motion.div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
