import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { activitiesApi } from '@/api/client';
import type { Activity } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { ActivityTimeline } from '@/components/app/ActivityTimeline';
import { SEO } from '@/components/SEO';

export default function ActivityPage() {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void activitiesApi.list(1, 50)
      .then((r) => setItems(r.items))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <SEO title="Activity — ImpulsoIQ" description="Human and agent activity" />
      <div className="px-4 sm:px-6 py-6 max-w-3xl">
        <h1 className="text-[1.25rem] font-extrabold text-slate-900 dark:text-white mb-1">Activity</h1>
        <p className="text-[0.82rem] text-slate-500 mb-5">One timeline for people and agents. Approvals live in Control.</p>
        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : <ActivityTimeline items={items} empty="No activity yet. Start a run from Home." />}
        {!loading && items.length === 0 && (
          <Link to="/home?intent=compose" className="inline-block mt-4 text-sm font-semibold text-indigo-600">Go to Home →</Link>
        )}
      </div>
    </AppShell>
  );
}
