import { forwardRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Brand left-panel used in sign-in + sign-up ─────────────────────────────

interface BrandPanelProps {
  heading: string;
  sub: string;
  bullets: string[];
}

export function BrandPanel({ heading, sub, bullets }: BrandPanelProps) {
  return (
    <div className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700 p-12 relative overflow-hidden select-none">
      {/* Decorative orbs */}
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-16 w-64 h-64 rounded-full bg-violet-900/30 blur-3xl pointer-events-none" />

      {/* Logo */}
      <Link to="/" className="flex items-center gap-2.5 z-10">
        <img src="/android-chrome-192x192.png" alt="" className="w-8 h-8 rounded-xl object-cover" />
        <span className="font-extrabold text-[1.2rem] text-white tracking-tight">ImpulsoIQ</span>
      </Link>

      {/* Main copy */}
      <div className="z-10">
        <h2 className="text-[2rem] font-extrabold text-white leading-tight tracking-tight mb-3">{heading}</h2>
        <p className="text-indigo-200 text-[0.95rem] leading-relaxed mb-8 max-w-xs">{sub}</p>
        <ul className="space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 text-[0.88rem] text-indigo-100">
              <span className="mt-0.5 w-4 h-4 flex-shrink-0 rounded-full bg-white/20 flex items-center justify-center text-white text-[0.6rem] font-bold">✓</span>
              {b}
            </li>
          ))}
        </ul>
      </div>

      {/* Balances the logo so the copy stays vertically centred. */}
      <div aria-hidden="true" />
    </div>
  );
}

// ─── Split page wrapper ──────────────────────────────────────────────────────

interface SplitLayoutProps { children: React.ReactNode; panel: React.ReactNode }

export function SplitLayout({ children, panel }: SplitLayoutProps) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {panel}
      <div className="flex items-center justify-center p-6 sm:p-10 bg-white dark:bg-[#020617] relative overflow-hidden">
        {/* Subtle bg tint on mobile where panel is hidden */}
        <div className="absolute inset-0 bg-gradient-to-br from-white via-slate-50 to-indigo-50/20 dark:from-[#020617] dark:to-[#020617] lg:hidden pointer-events-none" />
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-indigo-100/40 dark:bg-indigo-600/8 blur-[100px] lg:hidden pointer-events-none" />
        <motion.div
          className="relative z-10 w-full max-w-[400px]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Mobile-only logo */}
          <Link to="/" className="flex items-center gap-2.5 mb-8 lg:hidden">
            <img src="/android-chrome-192x192.png" alt="" className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-extrabold text-[1.1rem] tracking-tight bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
              ImpulsoIQ
            </span>
          </Link>
          {children}
        </motion.div>
      </div>
    </div>
  );
}

// ─── Centered card wrapper (for simple flows) ────────────────────────────────

interface CardLayoutProps { children: React.ReactNode }

export function CardLayout({ children }: CardLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-slate-50 to-indigo-50/30 dark:from-[#020617] dark:via-[#020617] dark:to-[#080e1d] px-4 py-12 relative overflow-hidden">
      <div className="absolute -top-20 right-0 w-80 h-80 rounded-full bg-indigo-100/50 dark:bg-indigo-600/8 blur-[110px] pointer-events-none" />
      <div className="absolute bottom-0 -left-10 w-64 h-64 rounded-full bg-violet-100/40 dark:bg-violet-600/6 blur-[100px] pointer-events-none" />
      <motion.div
        className="relative z-10 w-full max-w-[420px]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-8">
          <img src="/android-chrome-192x192.png" alt="" className="w-8 h-8 rounded-xl object-cover" />
          <span className="font-extrabold text-[1.2rem] tracking-tight bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
            ImpulsoIQ
          </span>
        </Link>
        <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.07] rounded-3xl shadow-xl shadow-slate-900/5 dark:shadow-black/40 p-8">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Form heading ────────────────────────────────────────────────────────────

export function AuthHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-7">
      <h1 className="text-[1.5rem] font-extrabold tracking-tight text-slate-900 dark:text-white mb-1">{title}</h1>
      {sub && <p className="text-[0.88rem] text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

// ─── Text input ──────────────────────────────────────────────────────────────

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const FormField = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, error, hint, className, ...props }, ref) => (
    <div>
      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
        {label}
      </label>
      <input
        ref={ref}
        className={cn(
          'w-full h-11 px-3.5 rounded-xl border text-slate-900 dark:text-white bg-white dark:bg-white/[0.04] placeholder:text-slate-400 dark:placeholder:text-slate-600 text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-400 dark:focus:border-indigo-500',
          error
            ? 'border-red-400 dark:border-red-500/60 bg-red-50/50 dark:bg-red-500/5'
            : 'border-slate-200 dark:border-white/[0.1] hover:border-slate-300 dark:hover:border-white/20',
          className,
        )}
        {...props}
      />
      {hint && !error && <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-1">{hint}</p>}
      {error && <p className="text-[0.75rem] text-red-500 dark:text-red-400 mt-1">{error}</p>}
    </div>
  ),
);
FormField.displayName = 'FormField';

// ─── Password input with toggle ──────────────────────────────────────────────

interface PasswordFieldProps extends Omit<FieldProps, 'type'> {
  labelRight?: React.ReactNode;
}

export function PasswordField({ label = 'Password', labelRight, error, hint, className, ...props }: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</label>
        {labelRight}
      </div>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          className={cn(
            'w-full h-11 pl-3.5 pr-10 rounded-xl border text-slate-900 dark:text-white bg-white dark:bg-white/[0.04] placeholder:text-slate-400 dark:placeholder:text-slate-600 text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-400 dark:focus:border-indigo-500',
            error
              ? 'border-red-400 dark:border-red-500/60 bg-red-50/50 dark:bg-red-500/5'
              : 'border-slate-200 dark:border-white/[0.1] hover:border-slate-300 dark:hover:border-white/20',
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400 transition-colors"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hint && !error && <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-1">{hint}</p>}
      {error && <p className="text-[0.75rem] text-red-500 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
}

// ─── Global error banner ─────────────────────────────────────────────────────

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/25 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-[0.84rem]">
      <span className="mt-px flex-shrink-0">⚠</span>
      <span>{message}</span>
    </div>
  );
}

// ─── Success / info banner ───────────────────────────────────────────────────

export function NoticeBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="status" className="flex items-start gap-2.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 text-emerald-700 dark:text-emerald-400 rounded-xl px-4 py-3 text-[0.84rem]">
      <span className="mt-px flex-shrink-0">✓</span>
      <span>{message}</span>
    </div>
  );
}

// ─── Primary submit button ───────────────────────────────────────────────────

interface PrimaryBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
}

export function PrimaryBtn({ loading, children, className, ...props }: PrimaryBtnProps) {
  return (
    <button
      className={cn(
        'relative w-full h-11 rounded-xl font-semibold text-white text-sm overflow-hidden',
        'inline-flex items-center justify-center gap-2',
        'bg-gradient-to-r from-indigo-600 to-violet-600',
        'hover:shadow-lg hover:shadow-indigo-500/30 hover:-translate-y-0.5 active:translate-y-0',
        'transition-all duration-200',
        'disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none',
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading
        ? <Loader2 size={18} className="animate-spin mx-auto" />
        : children}
    </button>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.08]" />
      <span className="text-[0.75rem] text-slate-400 dark:text-slate-600 font-medium">{label}</span>
      <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.08]" />
    </div>
  );
}
