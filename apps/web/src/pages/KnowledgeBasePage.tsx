/**
 * Knowledge Base Page — Phase 7E.
 *
 * Non-agentic authoring/versioning UI for knowledge_article records.
 * The embedding pipeline (S3 Vectors) is built in Phase 7 but consumed
 * by the Resolution Agent in Phase 8. (v4 §7E)
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, Book, CheckCircle2, FileText, AlertCircle, Edit2 } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { knowledgeApi } from '@/api/client';
import type { KnowledgeArticle } from '@/api/schemas';
import { cn } from '@/lib/utils';

// The local Article interface and its six fixture rows are gone; the shape now
// comes from the API. Note search_knowledge_articles returns no updated_at, so
// last_reviewed_at is what the UI can show.
type Article = KnowledgeArticle;

const STATUS_CONFIG = {
  published:  { label: 'Published', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  draft:      { label: 'Draft',     icon: FileText,    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  deprecated: { label: 'Deprecated',icon: AlertCircle, cls: 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-500' },
};

export default function KnowledgeBasePage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState<Article | null>(null);
  const [editBody, setEditBody] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    // No status filter: the browse view shows drafts and deprecated articles
    // too, unlike the Resolution Agent which only ever reads published ones.
    knowledgeApi.search('', undefined, 100)
      .then(setArticles)
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = articles.filter(a =>
    !search ||
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    (a.tags ?? []).some(t => t.includes(search.toLowerCase()))
  );

  const published  = articles.filter(a => a.status === 'published').length;
  const drafts     = articles.filter(a => a.status === 'draft').length;
  const deprecated = articles.filter(a => a.status === 'deprecated').length;

  function selectArticle(a: Article) {
    setSelected(a);
    setEditBody(a.body ?? '');
    setIsEditing(false);
  }

  function publishSelected() {
    if (!selected) return;
    setArticles(p => p.map(a => a.id === selected.id ? { ...a, status: 'published', lastReviewedAt: new Date().toISOString().slice(0,10) } : a));
    setSelected(prev => prev ? { ...prev, status: 'published' } : null);
  }

  function saveEdit() {
    if (!selected) return;
    setArticles(p => p.map(a => a.id === selected.id ? { ...a, body: editBody, version: (a.version ?? 0) + 1 } : a));
    setSelected(prev => prev ? { ...prev, body: editBody } : null);
    setIsEditing(false);
  }

  return (
    <AppShell>
      <SEO title="Knowledge Base — ImpulsoIQ" description="Support knowledge base article management" />
      <div className="flex h-full overflow-hidden">

        {/* Left: Article list */}
        <div className="w-[320px] flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-white/[0.065] bg-white dark:bg-[#0a0f1e]">
          <div className="px-4 py-3.5 border-b border-slate-100 dark:border-white/[0.05] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Knowledge Base</h2>
              <button className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 transition-colors">
                <Plus size={14} />
              </button>
            </div>
            <div className="flex gap-3 text-[0.72rem]">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{published} published</span>
              <span className="text-amber-600 dark:text-amber-400 font-semibold">{drafts} draft</span>
              <span className="text-slate-400 dark:text-slate-600">{deprecated} deprecated</span>
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search articles…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full h-8 pl-7 pr-2.5 text-[0.8rem] rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.03] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {(loading || filtered.length === 0) && (
              <div className="py-12 px-4 text-center text-[0.84rem] text-slate-400 dark:text-slate-600">
                {loading
                  ? 'Loading articles…'
                  : search
                    ? 'No articles match your search'
                    : 'No knowledge articles yet'}
              </div>
            )}
            {filtered.map((a, i) => {
              const cfg = STATUS_CONFIG[a.status];
              return (
                <motion.button key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  onClick={() => selectArticle(a)}
                  className={cn('w-full text-left px-4 py-3 border-b border-slate-50 dark:border-white/[0.03] transition-colors',
                    selected?.id === a.id ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]')}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-[0.82rem] font-semibold text-slate-800 dark:text-slate-200 leading-snug flex-1">{a.title}</p>
                    <span className={cn('text-[0.62rem] font-bold px-1.5 py-0.5 rounded flex-shrink-0', cfg.cls)}>{cfg.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.68rem] text-slate-400 dark:text-slate-600">v{a.version}</span>
                    {(a.tags ?? []).slice(0,2).map(t => <span key={t} className="text-[0.62rem] bg-slate-100 dark:bg-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded">{t}</span>)}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Right: Article view/edit */}
        <div className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.065] bg-white dark:bg-[#0d1526] flex-shrink-0">
                <div>
                  <h2 className="text-[1rem] font-bold text-slate-900 dark:text-white">{selected.title}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={cn('text-[0.65rem] font-bold px-1.5 py-0.5 rounded', STATUS_CONFIG[selected.status].cls)}>
                      {STATUS_CONFIG[selected.status].label}
                    </span>
                    <span className="text-[0.72rem] text-slate-400 dark:text-slate-600">v{selected.version}</span>
                    {selected.lastReviewedAt && (
                      <span className="text-[0.72rem] text-slate-400 dark:text-slate-600">Reviewed {selected.lastReviewedAt}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selected.status === 'draft' && (
                    <button onClick={publishSelected}
                      className="px-3.5 py-1.5 text-[0.8rem] font-semibold rounded-xl bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/25 transition-colors flex items-center gap-1.5">
                      <CheckCircle2 size={13} /> Publish
                    </button>
                  )}
                  <button onClick={() => setIsEditing(p => !p)}
                    className={cn('px-3.5 py-1.5 text-[0.8rem] font-semibold rounded-xl flex items-center gap-1.5 transition-colors',
                      isEditing ? 'bg-indigo-600 text-white' : 'border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20')}>
                    <Edit2 size={13} /> {isEditing ? 'Cancel' : 'Edit'}
                  </button>
                  {isEditing && (
                    <button onClick={saveEdit}
                      className="px-3.5 py-1.5 text-[0.8rem] font-semibold rounded-xl text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 transition-all">
                      Save
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {isEditing ? (
                  <textarea
                    value={editBody}
                    onChange={e => setEditBody(e.target.value)}
                    className="w-full min-h-[300px] p-4 rounded-2xl border border-indigo-300 dark:border-indigo-500/40 bg-white dark:bg-white/[0.04] text-[0.9rem] text-slate-900 dark:text-white leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition font-mono"
                  />
                ) : (
                  <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-6">
                    <p className="text-[0.9rem] text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{selected.body}</p>
                    <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/[0.05] flex flex-wrap gap-1.5">
                      {(selected.tags ?? []).map(t => <span key={t} className="text-[0.72rem] font-medium px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/[0.07] text-slate-600 dark:text-slate-400">{t}</span>)}
                    </div>
                    <p className="mt-3 text-[0.72rem] text-slate-400 dark:text-slate-600">
                      Embedding pipeline: {selected.status === 'published' ? '✓ Embedded in S3 Vectors — available to Resolution Agent (Phase 8)' : '○ Not embedded — publish to make available for grounded resolution'}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-slate-400 dark:text-slate-600">
                <Book size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-[0.84rem] font-semibold">Select an article to view or edit</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}
