import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { downloadTextFile, parseCsv } from '@/lib/csv';

export function CsvImportBar({
  sampleName,
  sampleCsv,
  onRows,
}: {
  sampleName: string;
  sampleCsv: string;
  onRows: (rows: Record<string, string>[]) => Promise<{ imported: number; skipped: number; errors: string[] }>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setResult('No data rows in that file. Download the sample to see the header row.');
        return;
      }
      const out = await onRows(rows);
      const errN = out.errors.length;
      setResult(
        `Imported ${out.imported}. Skipped ${out.skipped}.`
        + (errN ? ` ${errN} issue${errN === 1 ? '' : 's'}: ${out.errors.slice(0, 5).join('; ')}${errN > 5 ? '…' : ''}` : ''),
      );
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => downloadTextFile(sampleName, sampleCsv)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-[0.78rem] font-semibold rounded-xl border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300"
      >
        <Download size={13} /> Sample CSV
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-[0.78rem] font-semibold rounded-xl border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 disabled:opacity-40"
      >
        <Upload size={13} /> {busy ? 'Importing…' : 'Import CSV'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      {result && <p className="text-[0.75rem] text-slate-500 dark:text-slate-400 max-w-xl">{result}</p>}
    </div>
  );
}
