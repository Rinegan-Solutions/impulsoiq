import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { activitiesApi } from '@/api/client';
import type { Activity } from '@/api/schemas';
import { AppShell } from '@/components/app/AppShell';
import { ActivityTimeline } from '@/components/app/ActivityTimeline';
import { CsvImportBar } from '@/components/app/CsvImportBar';
import { SEO } from '@/components/SEO';
import { ACTIVITY_SAMPLE, importActivities } from '@/lib/crmBulk';
import { useAuth } from '@/lib/auth/useAuth';

export default function ActivityPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await activitiesApi.list(1, 50);
    setItems(r.items);
  }

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <SEO title="Activity — ImpulsoIQ" description="Human and agent activity" />
      <div className="px-4 sm:px-6 py-6 max-w-3xl">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
          <div>
            <h1 className="text-[1.25rem] font-extrabold text-slate-900 dark:text-white mb-1">Activity</h1>
            <p className="text-[0.82rem] text-slate-500">One timeline for people and agents. Approvals live in Control.</p>
          </div>
          <CsvImportBar
            sampleName="activity-sample.csv"
            sampleCsv={ACTIVITY_SAMPLE}
            onRows={async (rows) => {
              const out = await importActivities(rows, user?.sub ?? 'human');
              await load();
              return out;
            }}
          />
        </div>
        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : <ActivityTimeline items={items} empty="No activity yet. Start a run from Home." />}
        {!loading && items.length === 0 && (
          <Link to="/home?intent=compose" className="inline-block mt-4 text-sm font-semibold text-indigo-600">Go to Home →</Link>
        )}
      </div>
    </AppShell>
  );
}
