import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';

export default function SupportComingPage() {
  return (
    <AppShell>
      <SEO title="Support — ImpulsoIQ" description="Contact center module" />
      <div className="px-4 sm:px-6 py-6 max-w-xl">
        <h1 className="text-[1.25rem] font-extrabold text-slate-900 dark:text-white">Support module</h1>
        <p className="text-[0.88rem] text-slate-500 mt-2 leading-relaxed">
          Contact center surfaces are not live. Queue, knowledge base, and insight stay off the primary spine until that product exits its own build phase. This placeholder exists so Growth and Enterprise operators are not sent into an empty Support Queue.
        </p>
      </div>
    </AppShell>
  );
}
