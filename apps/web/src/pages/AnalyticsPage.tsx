import { TrendingUp } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';

// The LineChart / BarChart / DonutChart components and the Analytics interface
// were removed with the MSW fixtures that fed them. They rendered arrays of
// invented numbers; there is no endpoint producing the real equivalents yet, so
// keeping them would leave unused code shaped around data that does not exist.
// Rebuild them against the real response when a reporting read is added.

export default function AnalyticsPage() {
  // No analytics endpoint exists. The charts below were driven by an MSW
  // fixture; the underlying numbers (reply-rate trend, call outcomes, sequence
  // performance) would come from aggregating `activity` and `call_result` over
  // time, and nothing computes or exposes them yet.
  //
  // Note the schema cannot currently answer reply rate at all: activity.type is
  // email|sms|call|note|task|meeting, with no event recording a reply. Call
  // outcomes ARE available (call_result.outcome), so that chart is the natural
  // first one to make real.
  return (
    <AppShell>
      <SEO title="Analytics — ImpulsoIQ" description="Revenue and campaign analytics" />
      <div className="px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Analytics</h1>
          <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">Campaign and revenue performance</p>
        </div>

        <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-12 text-center">
          <TrendingUp className="mx-auto mb-4 text-slate-300 dark:text-slate-700" size={32} />
          <p className="text-[0.95rem] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
            Analytics are not available yet
          </p>
          <p className="text-[0.84rem] text-slate-400 dark:text-slate-600 max-w-md mx-auto">
            Campaign and call performance will appear here once enough activity
            has been recorded and the reporting pipeline is exposed through the API.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
