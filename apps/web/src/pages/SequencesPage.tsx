import { useEffect, useState } from 'react';
import { sequencesApi } from '@/api/client';
import type { Sequence } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';

const STEP_TYPES = ['email', 'sms', 'wait', 'call', 'task'] as const;

type DraftStep = {
  id: string;
  type: (typeof STEP_TYPES)[number];
  waitSeconds?: number;
  subject?: string;
  body?: string;
  title?: string;
};

const EMPTY: DraftStep[] = [
  { id: 'email-1', type: 'email' },
  { id: 'wait-1', type: 'wait', waitSeconds: 172800 },
  { id: 'call-1', type: 'call' },
];

export default function SequencesPage() {
  const [items, setItems] = useState<Sequence[]>([]);
  const [name, setName] = useState('SDR qualification');
  const [steps, setSteps] = useState<DraftStep[]>(EMPTY);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setItems(await sequencesApi.list().catch(() => []));
  }
  useEffect(() => { void load(); }, []);

  function loadIntoEditor(seq: Sequence) {
    setEditingId(seq.id);
    setName(seq.name);
    setSteps(seq.steps.map((s, i) => ({
      id: s.id ?? `step-${i + 1}`,
      type: s.type,
      waitSeconds: s.waitSeconds,
      subject: s.subject,
      body: s.body,
      title: s.title,
    })));
  }

  async function save() {
    setNotice(null);
    try {
      await sequencesApi.save({ id: editingId, name, status: 'active', steps });
      setNotice('Sequence saved. Attach it on a campaign; new runs use these steps.');
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save sequence');
    }
  }

  return (
    <AppShell>
      <SEO title="Sequences — ImpulsoIQ" description="Editable email, wait, call cadences" />
      <div className="px-4 sm:px-6 py-6 max-w-3xl">
        <h1 className="text-[1.25rem] font-extrabold text-slate-900 dark:text-white">Sequences</h1>
        <p className="text-[0.82rem] text-slate-500 mt-1 mb-5">
          Email, SMS, wait, call, and task steps. LinkedIn is not in this product until a licensed API exists.
        </p>
        {notice && <p className="mb-4 text-[0.82rem] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{notice}</p>}

        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <div>
            <p className="text-[0.72rem] font-bold uppercase tracking-wide text-slate-400 mb-2">Saved</p>
            <ul className="space-y-1">
              {items.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => loadIntoEditor(s)}
                    className="w-full text-left px-3 py-2 rounded-xl text-[0.82rem] font-semibold border border-slate-200 dark:border-white/[0.08] hover:border-indigo-300">
                    {s.name}
                    <span className="block text-[0.7rem] font-normal text-slate-400">{s.steps.length} steps</span>
                  </button>
                </li>
              ))}
              {items.length === 0 && <li className="text-[0.8rem] text-slate-400">None yet. The graph uses a default email → 48h wait → call cadence until you save one and attach it.</li>}
            </ul>
            <button type="button" className="mt-3 text-[0.78rem] font-semibold text-indigo-600"
              onClick={() => { setEditingId(undefined); setName('New sequence'); setSteps(EMPTY); }}>
              New sequence
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] p-4 bg-white dark:bg-[#0d1526]">
            <label className="block text-[0.72rem] font-semibold text-slate-500 mb-1">Name</label>
            <input className="w-full h-9 px-3 mb-4 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-transparent text-sm"
              value={name} onChange={(e) => setName(e.target.value)} />
            <ol className="space-y-3">
              {steps.map((step, i) => (
                <li key={step.id} className="rounded-xl border border-slate-100 dark:border-white/[0.06] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[0.7rem] text-slate-400 w-5">{i + 1}</span>
                    <select
                      className="h-8 rounded-lg border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#0a1220] text-slate-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-sm px-2"
                      value={step.type}
                      onChange={(e) => setSteps((prev) => prev.map((s, j) => j === i ? { ...s, type: e.target.value as DraftStep['type'] } : s))}
                    >
                      {STEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button type="button" className="ml-auto text-[0.75rem] text-red-600"
                      onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                  {step.type === 'wait' && (
                    <label className="text-[0.75rem] text-slate-500">
                      Wait seconds
                      <input type="number" className="ml-2 w-28 h-8 px-2 rounded-lg border border-slate-200 bg-transparent"
                        value={step.waitSeconds ?? 3600}
                        onChange={(e) => setSteps((prev) => prev.map((s, j) => j === i ? { ...s, waitSeconds: Number(e.target.value) } : s))}
                      />
                    </label>
                  )}
                  {step.type === 'task' && (
                    <input className="w-full h-8 px-2 rounded-lg border border-slate-200 bg-transparent text-sm"
                      placeholder="Task title"
                      value={step.title ?? ''}
                      onChange={(e) => setSteps((prev) => prev.map((s, j) => j === i ? { ...s, title: e.target.value } : s))}
                    />
                  )}
                </li>
              ))}
            </ol>
            <div className="flex gap-2 mt-4">
              <button type="button" className="px-3 py-2 rounded-xl text-[0.8rem] font-semibold border border-slate-200"
                onClick={() => setSteps((prev) => [...prev, { id: `step-${Date.now()}`, type: 'email' }])}>
                Add step
              </button>
              <button type="button" onClick={() => void save()}
                className="px-3 py-2 rounded-xl text-[0.8rem] font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600">
                Save sequence
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
