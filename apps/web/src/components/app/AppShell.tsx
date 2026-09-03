import { useEffect, useRef, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, LayoutGrid, Users, Briefcase, Building2, Zap,
  Cpu, BarChart3, Settings, Shield, BookOpen, Bell, Search, Menu, X,
  MessageSquare, ChevronRight, DoorOpen, FlaskConical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOut } from '@/lib/auth/cognito';
import { VoiceInterface } from '@/components/app/VoiceInterface';

// ─── Nav structure ───────────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    label: 'CRM',
    items: [
      { href: '/contacts',  label: 'Contacts',  icon: Users     },
      { href: '/deals',     label: 'Deals',     icon: Briefcase },
      { href: '/accounts',  label: 'Accounts',  icon: Building2 },
    ],
  },
  {
    label: 'Campaigns',
    items: [
      { href: '/campaigns',     label: 'Campaigns',     icon: Zap      },
      { href: '/control-panel', label: 'Agent Control', icon: Cpu      },
      { href: '/analytics',     label: 'Analytics',     icon: BarChart3 },
      { href: '/research',      label: 'Deep Research', icon: FlaskConical },
    ],
  },
  {
    label: 'Expand',
    items: [{ href: '/workspace', label: 'Workspace Templates', icon: LayoutGrid }],
  },
  {
    label: 'Support',
    items: [
      { href: '/support/queue',   label: 'Support Queue',   icon: MessageSquare },
      { href: '/support/kb',      label: 'Knowledge Base',  icon: BookOpen      },
      { href: '/support/insight', label: 'Support Insight', icon: BarChart3     },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings',   label: 'Settings',             icon: Settings   },
      { href: '/enterprise', label: 'Enterprise',           icon: Shield     },
      { href: '/registry',   label: 'Agent Registry',       icon: BookOpen   },
    ],
  },
];

function doSignOut() {
  signOut();
  window.location.replace('/sign-in');
}

// ─── Sidebar content ─────────────────────────────────────────────────────────

function SidebarContent({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between px-5 h-[60px] border-b border-slate-200 dark:border-white/[0.06] flex-shrink-0">
        <a href="/" className="flex items-center gap-2.5">
          <img src="/android-chrome-192x192.png" alt="" className="w-7 h-7 rounded-lg object-cover" />
          <span className="font-extrabold text-[1.05rem] tracking-tight bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
            ImpulsoIQ
          </span>
        </a>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Workspace pill */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.04] cursor-pointer hover:bg-slate-200 dark:hover:bg-white/[0.07] transition-colors group">
          <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[0.6rem] font-bold flex items-center justify-center flex-shrink-0">Q4</span>
          <div className="flex-1 min-w-0">
            <p className="text-[0.78rem] font-semibold text-slate-700 dark:text-slate-200 truncate">Q4 SaaS Outreach</p>
            <p className="text-[0.68rem] text-slate-400 dark:text-slate-600">Active workspace</p>
          </div>
          <ChevronRight size={13} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors flex-shrink-0" />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-5">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="px-2.5 mb-1.5 text-[0.63rem] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-600">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  onClick={onClose}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[0.84rem] font-medium transition-all duration-150',
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white',
                  )}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon size={16} className={isActive ? 'text-white' : ''} />
                      {item.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
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
              SA
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[0.78rem] font-semibold text-slate-700 dark:text-slate-200 truncate">Sales Admin</p>
              <p className="text-[0.68rem] text-slate-400 dark:text-slate-600">Manager · All access</p>
            </div>
          </Link>
          <button
            onClick={doSignOut}
            title="Sign out"
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
        SA
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-[calc(100%+10px)] w-48 bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.1] rounded-2xl shadow-xl shadow-slate-900/10 dark:shadow-black/50 py-1.5 z-[100]"
          >
            {/* User info header */}
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06] mb-1">
              <p className="text-[0.82rem] font-bold text-slate-900 dark:text-white">Sales Admin</p>
              <p className="text-[0.72rem] text-slate-400 dark:text-slate-600">Manager · All access</p>
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
              onClick={() => { setOpen(false); doSignOut(); }}
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
        <div className="hidden sm:flex items-center gap-2 h-9 px-3.5 rounded-xl bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.07] text-[0.84rem] text-slate-400 dark:text-slate-600 cursor-pointer hover:border-slate-300 dark:hover:border-white/15 transition-colors min-w-[220px]">
          <Search size={14} />
          <span>Search anything…</span>
          <span className="ml-auto text-[0.7rem] bg-slate-200 dark:bg-white/[0.07] px-1.5 py-0.5 rounded font-mono">⌘K</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* Phase 4A: Ambient voice interface */}
        <VoiceInterface />
        <button className="relative w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-700 dark:hover:text-white transition-all">
          <Bell size={17} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-indigo-500 rounded-full ring-2 ring-white dark:ring-[#020617]" />
        </button>
        <AvatarDropdown />
      </div>
    </header>
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
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
