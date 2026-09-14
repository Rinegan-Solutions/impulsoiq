/**
 * One agent run, in full.
 *
 * WHY THIS EXISTS
 * `agent_run.output` is written by every agent and was rendered by nothing. A
 * Deep Research Swarm could run for half an hour, cost real tokens, write 8KB of
 * findings to the database — and the only trace a person could reach was a row
 * in a list saying "completed". The findings were unreachable from the product.
 *
 * It is also the address the rest of the app needed. Control Panel's `?run=`
 * merely filtered the list to one row, so notifications, emails and the research
 * page had nowhere to point. /control-panel/:runId is that somewhere.
 *
 * SHAPE
 * Progressive disclosure, per current agentic-UX practice: the answer first
 * (synthesis), then each strategy's own result behind a disclosure, then the raw
 * input/output for anyone who needs to audit exactly what ran. Nobody is made to
 * read JSON to find out what happened, and nobody is prevented from reading it.
 *
 * A run that is still going keeps polling, so this page is equally the "watch
 * it" surface and the "read it afterwards" surface — the same URL either way.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, ChevronRight, Copy, Loader2, TriangleAlert } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { agentRunsApi } from '@/api/client';
import type { AgentRun } from '@/api/schemas';
import { agentFullLabel } from '@/lib/agentLabels';
import { Markdown } from '@/components/app/Markdown';
import { parseResearchCompanyNames, saveResearchCompaniesToCrm } from '@/lib/researchCompanies';
import { cn } from '@/lib/utils';

const ease = [0.22, 1, 0.36, 1] as const;
/** Only while the run is unfinished; a finished run never changes again. */
const POLL_MS = 15_000;

const STATUS_CLS: Record<AgentRun['status'], string> = {
  pending:   'bg-slate-100 text-slate-600 dark:bg-white/[0.08] dark:text-slate-300',
  running:   'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  paused:    'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  failed:    'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};

function duration(run: AgentRun): string {
  const start = new Date(run.startedAt).getTime();
  const end = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return mins < 60 ? `${mins}m ${secs % 60}s` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Paragraph-preserving markdown from agent output. HTML is not rendered. */
function Prose({ text }: { text: string }) {
  return <Markdown text={text} />;
}

function Disclosure({
  title, subtitle, tone = 'default', children, defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  tone?: 'default' | 'warn';
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
      >
        <ChevronRight
          size={15}
          className={cn('flex-shrink-0 text-slate-400 transition-transform', open && 'rotate-90')}
        />
        <span className="flex-1 min-w-0">
          <span className="block text-[0.85rem] font-semibold text-slate-900 dark:text-white">{title}</span>
          {subtitle && (
            <span className={cn(
              'block text-[0.74rem]',
              tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-600',
            )}>
              {subtitle}
            </span>
          )}
        </span>
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-slate-100 dark:border-white/[0.05]">{children}</div>}
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="mt-2 max-h-[420px] overflow-auto rounded-xl bg-slate-50 dark:bg-white/[0.04] p-3 text-[0.72rem] leading-relaxed font-mono text-slate-700 dark:text-slate-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }).catch(() => { /* clipboard blocked — the id is still selectable */ });
      }}
      className="inline-flex items-center gap-1.5 text-[0.72rem] font-mono text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
      aria-label="Copy run id"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {id}
    </button>
  );
}

// ─── Deep research rendering ──────────────────────────────────────────────────

interface SubAgentResult { strategy?: string; status?: string; result?: string }

function DeepResearchOutput({
  output,
  crmAccounts,
  savingCompanies,
  saveError,
}: {
  output: Record<string, unknown>;
  crmAccounts: Array<{ id?: string; name?: string; rank?: number }>;
  savingCompanies: boolean;
  saveError: string;
}) {
  const synthesis = str(output.synthesis);
  const results = Array.isArray(output.subAgentResults)
    ? (output.subAgentResults as SubAgentResult[])
    : [];
  const saved = crmAccounts;

  return (
    <div className="space-y-4">
      {synthesis && (
        <section>
          <h2 className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-600 mb-2">
            Synthesis
          </h2>
          <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1526] px-4 py-3.5">
            <Prose text={synthesis} />
          </div>
        </section>
      )}

      {savingCompanies && (
        <p className="flex items-center gap-2 text-[0.82rem] text-slate-500 dark:text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Saving companies to CRM…
        </p>
      )}
      {saveError && (
        <p className="text-[0.82rem] text-amber-700 dark:text-amber-300">{saveError}</p>
      )}

      {saved.length > 0 && (
        <section>
          <h2 className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-600 mb-2">
            Added to Companies ({saved.length})
          </h2>
          <ul className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1526] divide-y divide-slate-100 dark:divide-white/[0.05]">
            {saved.map((row, i) => {
              const name = str(row.name) || `Company ${i + 1}`;
              const href = row.id ? `/accounts/${row.id}` : '/accounts';
              return (
                <li key={row.id || `${name}-${i}`}>
                  <Link
                    to={href}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-[0.84rem] hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                  >
                    <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-200">
                      {typeof row.rank === 'number' ? `${row.rank}. ` : ''}{name}
                    </span>
                    <span className="flex-shrink-0 text-indigo-600 dark:text-indigo-400 font-semibold">
                      Open
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {results.length > 0 && (
        <section>
          <h2 className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-600 mb-2">
            Strategies ({results.length})
          </h2>
          <div className="space-y-2">
            {results.map((r, i) => {
              const strategy = str(r.strategy) || `Strategy ${i + 1}`;
              const status = str(r.status);
              // A strategy that returned nothing is a real outcome and is said
              // plainly here, rather than rendering an empty panel that reads
              // like a loading state.
              const empty = !str(r.result).trim();
              return (
                <Disclosure
                  key={`${strategy}-${i}`}
                  title={strategy.replace(/_/g, ' ')}
                  subtitle={empty ? 'no findings returned' : status || undefined}
                  tone={empty ? 'warn' : 'default'}
                >
                  {empty
                    ? <p className="text-[0.82rem] text-slate-500 dark:text-slate-400">This strategy produced no findings.</p>
                    : <Prose text={str(r.result)} />}
                </Disclosure>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RunDetailPage() {
  const { runId = '' } = useParams();
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importedAccounts, setImportedAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [savingCompanies, setSavingCompanies] = useState(false);
  const [saveError, setSaveError] = useState('');
  const importStarted = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRun(await agentRunsApi.get(runId));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this run.');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);

  const live = run?.status === 'running' || run?.status === 'pending' || run?.status === 'paused';
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  const output = (run?.output ?? null) as Record<string, unknown> | null;
  const hasOutput = output != null && Object.keys(output).length > 0;
  const isDeepResearch = run?.agentType === 'deep_research';
  const goal = str(run?.input?.goal) || str(output?.goal);
  const agentSaved = Array.isArray(output?.crmAccounts)
    ? (output?.crmAccounts as Array<{ id?: string; name?: string; rank?: number }>)
    : [];
  const crmAccounts = agentSaved.length > 0 ? agentSaved : importedAccounts;

  useEffect(() => {
    if (!run || !output || !isDeepResearch || run.status !== 'completed') return;
    if (agentSaved.length > 0) return;
    if (importStarted.current === run.id) return;
    const names = parseResearchCompanyNames(str(output.synthesis));
    if (names.length === 0) return;
    importStarted.current = run.id;
    setSavingCompanies(true);
    setSaveError('');
    void saveResearchCompaniesToCrm(names, {
      goal: str(output.goal) || str(run.input?.goal),
      sessionId: str(output.sessionId),
    })
      .then((rows) => setImportedAccounts(rows))
      .catch((err) => setSaveError(err instanceof Error ? err.message : 'Could not save companies.'))
      .finally(() => setSavingCompanies(false));
  }, [run, output, isDeepResearch, agentSaved.length]);

  return (
    <AppShell>
      <SEO title="Agent run — ImpulsoIQ" description="What this agent run did, and what it produced" />
      <div className="px-4 sm:px-6 py-6 max-w-[900px]">

        <Link
          to="/control-panel"
          className="inline-flex items-center gap-1.5 text-[0.82rem] text-slate-400 hover:text-indigo-500 transition-colors mb-4"
        >
          <ArrowLeft size={13} /> All runs
        </Link>

        {loading ? (
          <p className="text-[0.85rem] text-slate-400 dark:text-slate-600">Loading run…</p>
        ) : error ? (
          <p className="text-[0.85rem] text-rose-600 dark:text-rose-400">{error}</p>
        ) : !run ? (
          <div>
            <h1 className="text-[1.2rem] font-extrabold text-slate-900 dark:text-white">Run not found</h1>
            <p className="mt-1 text-[0.85rem] text-slate-500 dark:text-slate-400">
              This run does not exist in this workspace, or it belongs to another one.
            </p>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }}>

            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">
                {agentFullLabel(run.agentType)}
              </h1>
              <span className={cn('text-[0.7rem] font-bold px-2 py-0.5 rounded-full', STATUS_CLS[run.status])}>
                {run.status}
              </span>
              {live && <Loader2 size={14} className="animate-spin text-indigo-500" />}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.76rem] text-slate-400 dark:text-slate-600">
              <span>Started {new Date(run.startedAt).toLocaleString()}</span>
              <span>·</span>
              <span>{run.endedAt ? `Took ${duration(run)}` : `Running for ${duration(run)}`}</span>
              <span>·</span>
              <CopyId id={run.id} />
            </div>

            {goal && (
              <p className="mt-4 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] px-4 py-3 text-[0.86rem] leading-relaxed text-slate-700 dark:text-slate-300">
                {goal}
              </p>
            )}

            {run.status === 'failed' && (
              <p className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 dark:border-rose-500/25 bg-rose-50/70 dark:bg-rose-500/10 px-4 py-3 text-[0.84rem] text-rose-700 dark:text-rose-300">
                <TriangleAlert size={15} className="mt-0.5 flex-shrink-0" />
                {run.error || 'This run failed without recording a reason.'}
              </p>
            )}

            {live && (
              <p className="mt-4 rounded-2xl border border-indigo-200 dark:border-indigo-500/25 bg-indigo-50/70 dark:bg-indigo-500/10 px-4 py-3 text-[0.84rem] text-slate-700 dark:text-slate-300">
                This run is still going. The page refreshes itself — you can leave and come back to this address.
              </p>
            )}

            <div className="mt-5 space-y-4">
              {hasOutput && isDeepResearch && (
                <DeepResearchOutput
                  output={output}
                  crmAccounts={crmAccounts}
                  savingCompanies={savingCompanies}
                  saveError={saveError}
                />
              )}

              {hasOutput && !isDeepResearch && (
                <section>
                  <h2 className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-600 mb-2">
                    Result
                  </h2>
                  <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1526] px-4 py-3">
                    <Json value={output} />
                  </div>
                </section>
              )}

              {!hasOutput && run.status === 'completed' && (
                <p className="text-[0.84rem] text-slate-500 dark:text-slate-400">
                  This run completed without recording any output.
                </p>
              )}

              {/* Audit trail. Present for every run, never in the way of the answer. */}
              <Disclosure title="Inputs" subtitle="What this run was asked to do">
                <Json value={run.input ?? {}} />
              </Disclosure>

              {hasOutput && isDeepResearch && (
                <Disclosure title="Raw output" subtitle="Everything the agent recorded">
                  <Json value={output} />
                </Disclosure>
              )}

              {run.costJson && Object.keys(run.costJson).length > 0 && (
                <Disclosure title="Cost" subtitle="Tokens and calls recorded for this run">
                  <Json value={run.costJson} />
                </Disclosure>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </AppShell>
  );
}
