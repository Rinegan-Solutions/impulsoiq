/**
 * App chrome — top-bar navigation.
 *
 * WHY A TOP BAR
 * The spine is 5 modes (Home · CRM · Campaigns · Control · More), well inside
 * the 3–6 a horizontal bar carries comfortably; nesting lives in the second row
 * (ModeTabs). Dropping the 240px rail also lets the Home composer sit in a
 * genuinely centred column, which is the point of an intent-first surface.
 *
 * The microphone deliberately does NOT live here: the ambient assistant is
 * offered next to the greeting on Home, where the conversation actually starts.
 */
import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Menu, X, DoorOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth, roleOf, ROLE_LABEL, initialsOf, displayNameOf } from '@/lib/auth/useAuth';
import type { SessionUser } from '@/lib/auth/cognito';
import { useTenant } from '@/lib/useTenant';
import { workspaceHost } from '@/lib/tenant';
import { CommandPalette } from '@/components/app/CommandPalette';
import { childActive, modeForPath, modesFor } from '@/lib/nav';

function roleLabel(user: SessionUser): string {
  const role = roleOf(user);
  // No group means tenant-provisioner did not finish for this account.
  return role ? ROLE_LABEL[role] : 'No role assigned';
}

/** Revoke the session, then leave the app. RequireAuth would redirect anyway; this makes it immediate. */
function useSignOutAndLeave() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
  };
}

// ─── Wordmark ─────────────────────────────────────────────────────────────────

/**
 * The product name stays the wordmark; the workspace it belongs to sits under
 * it, dimmed but still legible. Not a tooltip-only detail — people need to see
 * which workspace they are typing into.
 */
function Wordmark({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const tenant = useTenant(user?.tenantId);
  if (!user) return null;
  const company = tenant?.name || user.tenantId;

  return (
    <Link
      to="/"
      onClick={onNavigate}
      className="flex items-center gap-2.5 min-w-0"
      title={workspaceHost(user.tenantId)}
    >
      <img src="/android-chrome-192x192.png" alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
      <span className="min-w-0 leading-tight">
        <span className="block font-extrabold text-[1.05rem] tracking-tight bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
          ImpulsoIQ
        </span>
        <span className="block text-[0.68rem] font-medium text-slate-400 dark:text-slate-500 truncate max-w-[150px]">
          {company}
        </span>
      </span>
    </Link>
  );
}

// ─── Account menu ─────────────────────────────────────────────────────────────

function AvatarDropdown() {
  const { user } = useAuth();
  const signOutAndLeave = useSignOutAndLeave();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(p => !p)}
        className={cn(
          'w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[0.7rem] font-bold flex items-center justify-center transition-all',
          open
            ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-[#020617]'
            : 'hover:ring-2 hover:ring-indigo-400 hover:ring-offset-2 hover:ring-offset-white dark:hover:ring-offset-[#020617]',
        )}
        aria-label="Account menu"
        aria-expanded={open}
      >
        {initialsOf(user)}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-[calc(100%+10px)] w-60 bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.1] rounded-2xl shadow-xl shadow-slate-900/10 dark:shadow-black/50 py-1.5 z-[100]"
          >
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06] mb-1">
              <p className="text-[0.82rem] font-bold text-slate-900 dark:text-white truncate">{displayNameOf(user)}</p>
              <p className="text-[0.72rem] text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
              <p className="text-[0.72rem] text-slate-400 dark:text-slate-600">{roleLabel(user)} · {user.tenantId}</p>
            </div>

            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-[0.84rem] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <Settings size={14} />
              Settings
            </Link>

            <div className="mx-2 my-1 h-px bg-slate-100 dark:bg-white/[0.06]" />

            <button
              onClick={() => { setOpen(false); void signOutAndLeave(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[0.84rem] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors rounded-b-2xl"
            >
              <DoorOpen size={14} />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────────

function ModeBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user } = useAuth();
  const tenant = useTenant(user?.tenantId);
  const location = useLocation();
  if (!user) return null;

  const modes = modesFor(roleOf(user), tenant?.tier);
  const activeMode = modeForPath(location.pathname, modes);

  return (
    <header className="h-[64px] flex items-center gap-3 sm:gap-5 px-4 sm:px-6 border-b border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#020617] flex-shrink-0 z-20">
      <button
        onClick={onMenuClick}
        className="lg:hidden text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition-colors"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      <Wordmark />

      <nav className="hidden lg:flex items-center gap-1 ml-2" aria-label="Main">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isActive = activeMode?.id === mode.id;
          return (
            <NavLink
              key={mode.id}
              to={mode.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl text-[0.84rem] font-semibold transition-colors',
                isActive
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white',
              )}
            >
              <Icon size={16} />
              {mode.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <CommandPalette />
        <AvatarDropdown />
      </div>
    </header>
  );
}

function ModeTabs() {
  const { user } = useAuth();
  const tenant = useTenant(user?.tenantId);
  const location = useLocation();
  if (!user) return null;
  const modes = modesFor(roleOf(user), tenant?.tier);
  const mode = modeForPath(location.pathname, modes);
  if (!mode?.children?.length) return null;
  return (
    <div className="h-11 flex items-center gap-1 px-4 sm:px-6 border-b border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#020617] overflow-x-auto flex-shrink-0">
      {mode.children.map((tab) => (
        <NavLink
          key={tab.href}
          to={tab.href}
          className={cn(
            'px-3 py-1.5 rounded-lg text-[0.78rem] font-semibold whitespace-nowrap',
            childActive(location.pathname, tab.href)
              ? 'bg-slate-100 dark:bg-white/[0.08] text-slate-900 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
          )}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}

// ─── Mobile drawer ────────────────────────────────────────────────────────────

function MobileNav({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const tenant = useTenant(user?.tenantId);
  const location = useLocation();
  const signOutAndLeave = useSignOutAndLeave();
  if (!user) return null;
  const modes = modesFor(roleOf(user), tenant?.tier);
  const activeMode = modeForPath(location.pathname, modes);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 h-[64px] border-b border-slate-200 dark:border-white/[0.06]">
        <Wordmark onNavigate={onClose} />
        <button onClick={onClose} aria-label="Close menu" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-1" aria-label="Main">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isActive = activeMode?.id === mode.id;
          return (
            <div key={mode.id}>
              <NavLink
                to={mode.href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[0.86rem] font-semibold',
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.05]',
                )}
              >
                <Icon size={16} />
                {mode.label}
              </NavLink>
              {isActive && mode.children?.length ? (
                <div className="mt-1 ml-6 space-y-0.5">
                  {mode.children.map((child) => (
                    <NavLink
                      key={child.href}
                      to={child.href}
                      onClick={onClose}
                      className={cn(
                        'block px-2.5 py-1.5 rounded-lg text-[0.8rem]',
                        childActive(location.pathname, child.href)
                          ? 'text-indigo-600 dark:text-indigo-300 font-semibold'
                          : 'text-slate-500 dark:text-slate-400',
                      )}
                    >
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-slate-200 dark:border-white/[0.06]">
        <button
          onClick={() => { onClose(); void signOutAndLeave(); }}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[0.84rem] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
        >
          <DoorOpen size={16} /> Sign out
        </button>
      </div>
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function AppShell({
  children,
  /**
   * Pages that own their own scrolling — the Home conversation docks a composer
   * to the bottom — set this false so there is no nested scroll container.
   */
  contentScroll = true,
}: {
  children: React.ReactNode;
  contentScroll?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 dark:bg-[#020617] font-sans antialiased">
      <ModeBar onMenuClick={() => setMobileOpen(true)} />
      <ModeTabs />

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed left-0 top-0 bottom-0 w-[276px] bg-white dark:bg-[#0a0f1e] border-r border-slate-200 dark:border-white/[0.06] z-50 lg:hidden"
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <MobileNav onClose={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className={cn('flex-1 min-h-0', contentScroll ? 'overflow-y-auto' : 'overflow-hidden')}>
        {children}
      </main>
    </div>
  );
}
