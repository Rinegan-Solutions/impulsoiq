/**
 * Agent Registry — Phase 6B.
 *
 * Discoverable catalog of all agents, tools, and templates for enterprise
 * admins. Lets RevOps/IT see what is available without reading source code.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Cpu, Wrench, LayoutGrid } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { registryApi } from '@/api/client';
import type { RegistryEntry } from '@/api/schemas';
import { cn } from '@/lib/utils';

type EntryType = 'agent' | 'tool' | 'template';

// The catalog is seeded into `agent_registry` by the registry-seeder Lambda and
// read back through get_registry. It used to be a hardcoded copy of that
// seeder's contents, which meant the page could not show what was ACTUALLY
// registered in the environment — only what someone had transcribed.

const TYPE_CONFIG: Record<EntryType, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  agent:    { label: 'Agents',    icon: Cpu,        color: 'text-indigo-600 dark:text-indigo-400',  bg: 'bg-indigo-100 dark:bg-indigo-500/15'  },
  tool:     { label: 'Tools',     icon: Wrench,     color: 'text-amber-600 dark:text-amber-400',    bg: 'bg-amber-100 dark:bg-amber-500/15'    },
  template: { label: 'Templates', icon: LayoutGrid, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-500/15' },
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function RegistryPage() {
  const [filter, setFilter]  = useState<EntryType | 'all'>('all');
  const [search, setSearch]  = useState('');
  const [all, setAll]        = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    registryApi.list()
      .then(setAll)
      .catch(() => setAll([]))
      .finally(() => setLoading(false));
  }, []);

  const entries = all.filter(e => {
    if (filter !== 'all' && e.entryType !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.name.toLowerCase().includes(q) ||
             (e.description ?? '').toLowerCase().includes(q) ||
             e.key.toLowerCase().includes(q) ||
             (e.capabilities ?? []).some(c => c.includes(q));
    }
    return true;
  });

  const counts = {
    agent:    all.filter(e => e.entryType === 'agent').length,
    tool:     all.filter(e => e.entryType === 'tool').length,
    template: all.filter(e => e.entryType === 'template').length,
  };

  return (
    <AppShell>
      <SEO title="Agent Registry — ImpulsoIQ" description="Discoverable catalog of all agents, tools, and templates" />
      <div className="px-4 sm:px-6 py-6">

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }} className="mb-6">
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-2">
            Phase 6B · Enterprise
          </div>
          <h1 className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-1">
            Agent Registry
          </h1>
          <p className="text-[0.84rem] text-slate-500 dark:text-slate-400">
            Complete catalog of {all.length} registered agents, tools, and workspace templates — discoverable by enterprise admins without reading source code.
          </p>
        </motion.div>

        {/* Filters + search */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/[0.04] rounded-xl p-1">
            {(['all', 'agent', 'tool', 'template'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('px-3 py-1.5 rounded-lg text-[0.8rem] font-semibold transition-all capitalize',
                  filter === f ? 'bg-white dark:bg-[#0d1526] text-slate-900 dark:text-white shadow-sm'
                               : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
                {f === 'all' ? `All (${all.length})` : `${f}s (${counts[f]})`}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-8 pr-3 text-sm rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition" />
          </div>
        </div>

        {/* Registry table */}
        <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
          <div className="grid px-5 py-2.5 border-b border-slate-100 dark:border-white/[0.04] text-[0.67rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 bg-slate-50/60 dark:bg-white/[0.02]"
            style={{ gridTemplateColumns: '32px 1fr 60px 80px auto' }}>
            <span />
            <span>Entry</span>
            <span className="text-center">Phase</span>
            <span className="text-center">Version</span>
            <span>Capabilities</span>
          </div>
          {entries.length === 0 ? (
            <div className="py-12 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">
              {loading
                ? 'Loading registry…'
                : search || filter !== 'all'
                  ? 'No matching entries'
                  : 'Registry is empty — run the registry-seeder Lambda to populate the catalog.'}
            </div>
          ) : entries.map((e, i) => {
            // entry_type is free text in the database, so an unrecognised value
            // must not crash the row — fall back to the 'tool' styling.
            const cfg = TYPE_CONFIG[e.entryType as EntryType] ?? TYPE_CONFIG.tool;
            const caps = e.capabilities ?? [];
            return (
              <motion.div key={`${e.entryType}-${e.key}`}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                className="grid px-5 py-3 border-b border-slate-50 dark:border-white/[0.03] last:border-0 items-start hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                style={{ gridTemplateColumns: '32px 1fr 60px 80px auto' }}>
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
                  <cfg.icon size={13} className={cfg.color} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-200">{e.name}</p>
                    <code className="text-[0.65rem] font-mono text-slate-400 dark:text-slate-600">{e.key}</code>
                  </div>
                  <p className="text-[0.76rem] text-slate-500 dark:text-slate-400 leading-relaxed">{e.description}</p>
                </div>
                <span className="text-center text-[0.75rem] font-semibold text-indigo-600 dark:text-indigo-400 mt-1">
                  P{e.phaseIntroduced}
                </span>
                <span className="text-center text-[0.72rem] text-slate-400 dark:text-slate-600 font-mono mt-1">
                  v{e.version}
                </span>
                <div className="flex flex-wrap gap-1 max-w-[260px] mt-0.5">
                  {caps.slice(0, 3).map(c => (
                    <span key={c} className="text-[0.62rem] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-400">
                      {c}
                    </span>
                  ))}
                  {caps.length > 3 && (
                    <span className="text-[0.62rem] text-slate-400 dark:text-slate-600 self-center">
                      +{caps.length - 3}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

      </div>
    </AppShell>
  );
}
