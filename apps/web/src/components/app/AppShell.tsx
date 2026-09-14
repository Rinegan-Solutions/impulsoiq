import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, Menu, X, DoorOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth, roleOf, ROLE_LABEL, initialsOf, displayNameOf } from '@/lib/auth/useAuth';
import type { SessionUser } from '@/lib/auth/cognito';
import { useTenant } from '@/lib/useTenant';
import { workspaceHost } from '@/lib/tenant';
import { VoiceInterface } from '@/components/app/VoiceInterface';
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

// ─── Sidebar content ─────────────────────────────────────────────────────────

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth();
  const tenant = useTenant(user?.tenantId);
  const signOutAndLeave = useSignOutAndLeave();
  const location = useLocation();

  if (!user) return null;
  const workspaceName = tenant?.name || user.tenantId;
  const modes = modesFor(roleOf(user), tenant?.tier);
  const activeMode = modeForPath(location.pathname, modes);

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between px-5 h-[60px] border-b border-slate-200 dark:border-white/[0.06] flex-shrink-0">
        <Link to="/home" onClick={onClose} className="flex items-center gap-2.5">
          <img src="/android-chrome-192x192.png" alt="" className="w-7 h-7 rounded-lg object-cover" />
          <span className="font-extrabold text-[1.05rem] tracking-tight bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
            ImpulsoIQ
          </span>
        </Link>
        {onClose && (
          <button onClick={onClose} aria-label="Close menu" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Workspace — the tenant this session is scoped to */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.04]">
          <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[0.6rem] font-bold flex items-center justify-center flex-shrink-0">
            {workspaceName.slice(0, 2).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[0.78rem] font-semibold text-slate-700 dark:text-slate-200 truncate">{workspaceName}</p>
            <p className="text-[0.68rem] text-slate-400 dark:text-slate-600 truncate">{workspaceHost(user.tenantId)}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isMode = activeMode?.id === mode.id;
          return (
            <NavLink
              key={mode.id}
              to={mode.href}
              onClick={onClose}
              className={() => cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[0.84rem] font-medium transition-all duration-150',
                isMode
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white',
              )}
            >
              <Icon size={16} />
              {mode.label}
            </NavLink>
          );
        })}
      </nav>

      {/* User profile — click to go to settings; door icon to log out */}
      <div className="px-3 py-3 border-t border-slate-200 dark:border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Link
            to="/settings"
            onClick={onClose}
            className="flex items-center gap-2.5 flex-1 min-w-0 px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
            title="Open settings"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[0.65rem] font-bold flex items-center justify-center flex-shrink-0">
              {initialsOf(user)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[0.78rem] font-semibold text-slate-700 dark:text-slate-200 truncate">{displayNameOf(user)}</p>
              <p className="text-[0.68rem] text-slate-400 dark:text-slate-600 truncate">{roleLabel(user)}</p>
            </div>
          </Link>
          <button
            onClick={signOutAndLeave}
            title="Sign out"
            aria-label="Sign out"
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-xl text-slate-400 dark:text-slate-600 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-all"
          >
            <DoorOpen size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Header avatar dropdown ───────────────────────────────────────────────────

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
          'w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[0.65rem] font-bold flex items-center justify-center transition-all',
          open ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-[#020617]' : 'hover:ring-2 hover:ring-indigo-400 hover:ring-offset-2 hover:ring-offset-white dark:hover:ring-offset-[#020617]',
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
            {/* User info header */}
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06] mb-1">
              <p className="text-[0.82rem] font-bold text-slate-900 dark:text-white truncate">{displayNameOf(user)}</p>
              {user.name && <p className="text-[0.72rem] text-slate-500 dark:text-slate-400 truncate">{user.email}</p>}
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

// ─── Top header ───────────────────────────────────────────────────────────────

function TopHeader({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="h-[60px] flex items-center justify-between px-4 sm:px-6 border-b border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#020617] flex-shrink-0 z-10">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <CommandPalette />
      </div>
      <div className="flex items-center gap-2">
        <VoiceInterface />
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
    <div className="h-11 flex items-center gap-1 px-4 sm:px-6 border-b border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#020617] overflow-x-auto">
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

// ─── Shell ────────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#020617] font-sans antialiased">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-[240px] flex-shrink-0 bg-white dark:bg-[#0a0f1e] border-r border-slate-200 dark:border-white/[0.06]">
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed left-0 top-0 bottom-0 w-[260px] bg-white dark:bg-[#0a0f1e] border-r border-slate-200 dark:border-white/[0.06] z-50 lg:hidden"
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <SidebarContent onClose={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopHeader onMenuClick={() => setMobileOpen(true)} />
        <ModeTabs />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
