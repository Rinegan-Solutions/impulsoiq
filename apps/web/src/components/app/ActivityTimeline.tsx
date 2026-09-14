import { Link } from 'react-router-dom';
import type { Activity } from '@/api/schemas';
import { cn } from '@/lib/utils';

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function ActivityTimeline({ items, empty }: { items: Activity[]; empty?: string }) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-[0.82rem] text-slate-400">{empty ?? 'No activity yet'}</p>;
  }
  return (
    <ol className="space-y-3">
      {items.map((a) => {
        const who = [a.firstName, a.lastName].filter(Boolean).join(' ');
        return (
          <li key={a.id} className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-[#0d1526] px-4 py-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className={cn(
                'text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg',
                a.actorType === 'agent'
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-300',
              )}>
                {a.actorType} · {a.type}
              </span>
              <span className="text-[0.72rem] text-slate-400">{timeAgo(a.occurredAt)}</span>
            </div>
            <p className="text-[0.84rem] font-semibold text-slate-800 dark:text-slate-100">
              {a.subject || a.type}
            </p>
            {a.body && <p className="text-[0.78rem] text-slate-500 dark:text-slate-400 mt-1 whitespace-pre-wrap line-clamp-6">{a.body}</p>}
            <p className="text-[0.72rem] text-slate-400 mt-2">
              {who ? (
                <Link to={`/contacts/${a.contactId}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{who}</Link>
              ) : 'Workspace'}
              {a.accountName ? ` · ${a.accountName}` : ''}
              {typeof a.metadata?.status === 'string' ? ` · ${a.metadata.status}` : ''}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
