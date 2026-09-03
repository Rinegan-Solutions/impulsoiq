import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  return (
    <nav
      className={cn(
        'fixed top-0 inset-x-0 z-50 h-[60px] flex items-center justify-between px-4 sm:px-6 transition-all duration-300',
        scrolled
          ? 'bg-white/85 dark:bg-[#020617]/85 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/[0.065] shadow-sm dark:shadow-none'
          : 'bg-transparent',
      )}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Logo */}
      <a href="/" className="flex items-center gap-2.5 tracking-tight">
        <img src="/android-chrome-192x192.png" alt="" aria-hidden="true" className="w-7 h-7 rounded-lg object-cover" />
        <span className="font-extrabold text-[1.3rem] bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
          ImpulsoIQ
        </span>
      </a>

      {/* Links */}
      <ul className="hidden md:flex items-center gap-7 text-sm font-extrabold text-slate-600 dark:text-slate-400">
        {[['/#how', 'How it works'], ['/#features', 'Features'], ['/#panel', 'Control Panel'], ['/pricing', 'Pricing'], ['/#testimonials', 'Stories']].map(([href, label]) => (
          <li key={href}>
            <a href={href} className="hover:text-slate-900 dark:hover:text-white transition-colors">{label}</a>
          </li>
        ))}
      </ul>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <a href="/sign-in" className="hidden sm:block px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors rounded-lg">
          Sign in
        </a>
        <a
          href="/sign-up"
          className="px-4 py-2 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-px transition-all"
        >
          Get early access
        </a>
      </div>
    </nav>
  );
}
