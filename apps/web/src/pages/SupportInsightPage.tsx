/**
 * Support Insight Page — Phase 9A.
 *
 * Support health dashboard. Non-agentic — renders the report written by
 * the Support Insight Agent. Same pattern as the DashboardPage forecasting
 * section (Phase 3A), applied to support operations.
 *
 * Industry benchmark targets shown inline (v4 §9A):
 *   Deflection:  40% target / 59% top-quartile
 *   Resolution:  66% target / 80% best-in-class
 *   CSAT:        4.1/5 AI baseline / 4.25/5 hybrid target
 *   SLA breach:  < 5%
 */
import { BarChart3 } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';

// The MOCK_REPORT / KB_GAPS fixtures and the MetricCard component were removed
// along with them.
//
// The Support Insight Agent runs weekly, reads raw tickets and conversations
// via get_support_metrics, and writes a computed report (SLA attainment, CSAT,
// deflection rate, KB gaps) to the DynamoDB reporting table. Nothing reads that
// report back over HTTP, so the page had been rendering an analysis that was
// never performed against this tenant's data.
//
// To make this live: expose a reporting read and restore the metric cards from
// its response.
export default function SupportInsightPage() {
  return (
    <AppShell>
      <SEO title="Support Insight — ImpulsoIQ" description="Support health metrics and KB gaps" />
      <div className="px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-[1.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white">Support Insight</h1>
          <p className="text-[0.82rem] text-slate-500 dark:text-slate-400 mt-0.5">Support health, SLA attainment and knowledge gaps</p>
        </div>

        <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl p-12 text-center">
          <BarChart3 className="mx-auto mb-4 text-slate-300 dark:text-slate-700" size={32} />
          <p className="text-[0.95rem] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
            No support report yet
          </p>
          <p className="text-[0.84rem] text-slate-400 dark:text-slate-600 max-w-md mx-auto">
            The Support Insight Agent publishes a report on its weekly schedule.
            Reports are not yet exposed through the API.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
