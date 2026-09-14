import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/useAuth';

// In-page sections stay plain anchors so the browser does the scrolling. They
// are absolute ("/#how") so they also work from /pricing. Routes go through the
// router, so moving between pages never reloads the app.
const SECTION_LINKS: [href: string, label: string][] = [
  ['/#how', 'How it works'],
  ['/#features', 'Features'],
  ['/#panel', 'Control Panel'],
];

const LINK_CLS = 'hover:text-slate-900 dark:hover:text-white transition-colors';
const PRIMARY_CLS =
  'px-4 py-2 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-px transition-all';

export function NavBar() {
  const { status } = useAuth();
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
      <Link to="/" className="flex items-center gap-2.5 tracking-tight">
        <img src="/android-chrome-192x192.png" alt="" aria-hidden="true" className="w-7 h-7 rounded-lg object-cover" />
        <span className="font-extrabold text-[1.3rem] bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
          ImpulsoIQ
        </span>
      </Link>

      {/* Links */}
      <ul className="hidden md:flex items-center gap-7 text-sm font-extrabold text-slate-600 dark:text-slate-400">
        {SECTION_LINKS.map(([href, label]) => (
          <li key={href}>
            <a href={href} className={LINK_CLS}>{label}</a>
          </li>
        ))}
        <li>
          <Link to="/pricing" className={LINK_CLS}>Pricing</Link>
        </li>
      </ul>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {status === 'signedIn' ? (
          <Link to="/home" className={PRIMARY_CLS}>
            Open workspace
          </Link>
        ) : (
          <>
            <Link to="/sign-in" className="hidden sm:block px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors rounded-lg">
              Sign in
            </Link>
            <Link to="/sign-up" className={PRIMARY_CLS}>
              Get early access
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
