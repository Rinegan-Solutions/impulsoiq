export function Footer() {
  return (
    <footer className="border-t border-slate-200 dark:border-white/[0.065] bg-slate-50 dark:bg-[#080e1d] px-4 sm:px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <div className="flex items-center gap-2.5 tracking-tight mb-1">
            <img src="/android-chrome-192x192.png" alt="" aria-hidden="true" className="w-6 h-6 rounded-md object-cover" />
            <span className="font-extrabold text-[1rem] bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
              ImpulsoIQ
            </span>
          </div>
          <div className="text-[0.74rem] text-slate-400 dark:text-slate-600">AI agents for your revenue team</div>
        </div>
        <nav className="flex flex-wrap gap-6" aria-label="Footer navigation">
          {[
            ['/#features', 'Features'],
            ['/#how', 'How it works'],
            ['/#testimonials', 'Stories'],
            ['/pricing', 'Pricing'],
            ['/sign-up', 'Get access'],
            ['/privacy', 'Privacy'],
            ['/terms', 'Terms'],
          ].map(([href, label]) => (
            <a key={label} href={href} className="text-[0.83rem] text-slate-500 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">{label}</a>
          ))}
        </nav>
        <div className="text-[0.74rem] text-slate-400 dark:text-slate-600">
          © 2026 ImpulsoIQ · Built by Rinegan Solutions Limited
        </div>
      </div>
    </footer>
  );
}
