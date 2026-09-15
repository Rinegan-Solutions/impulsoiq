import type { LucideIcon } from 'lucide-react';
import {
  Home, Users, Building2, Briefcase, List, Zap, GitBranch, Cpu,
  Inbox, Gauge, LayoutGrid, Settings, Shield, BookOpen, FlaskConical,
  LayoutDashboard, MessageSquare, BarChart3,
} from 'lucide-react';
import type { Role } from '@/lib/auth/useAuth';

export type NavChild = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  growthPlus?: boolean;
};

export type NavMode = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  children?: NavChild[];
};

export function modesFor(role: Role | null, tier: string | undefined): NavMode[] {
  const moreChildren: NavChild[] = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/workspace', label: 'Templates', icon: LayoutGrid },
    { href: '/research', label: 'Deep Research', icon: FlaskConical },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];
  if (role === 'admin' || role === 'manager') {
    moreChildren.push(
      { href: '/registry', label: 'Registry', icon: BookOpen, roles: ['admin', 'manager'] },
      { href: '/enterprise', label: 'Enterprise', icon: Shield, roles: ['admin', 'manager'] },
    );
  }
  const t = (tier ?? '').toLowerCase();
  if (t === 'growth' || t === 'enterprise') {
    moreChildren.push({ href: '/support/coming', label: 'Support (coming)', icon: MessageSquare, growthPlus: true });
  }

  return [
    { id: 'home', href: '/home', label: 'Home', icon: Home },
    {
      id: 'crm',
      href: '/contacts',
      label: 'CRM',
      icon: Users,
      children: [
        { href: '/contacts', label: 'Contacts', icon: Users },
        { href: '/accounts', label: 'Companies', icon: Building2 },
        { href: '/deals', label: 'Deals', icon: Briefcase },
        { href: '/activity', label: 'Activity', icon: List },
      ],
    },
    {
      id: 'campaigns',
      href: '/campaigns',
      label: 'Campaigns',
      icon: Zap,
      children: [
        { href: '/campaigns', label: 'Campaigns', icon: Zap },
        { href: '/sequences', label: 'Sequences', icon: GitBranch },
      ],
    },
    {
      id: 'control',
      href: '/control-panel',
      label: 'Control',
      icon: Cpu,
      children: [
        { href: '/control-panel', label: 'Runs', icon: Cpu },
        { href: '/approvals', label: 'Approvals', icon: Inbox },
        { href: '/usage', label: 'Usage', icon: Gauge },
        { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      ],
    },
    { id: 'more', href: '/dashboard', label: 'More', icon: LayoutGrid, children: moreChildren },
  ];
}

export function modeForPath(pathname: string, modes: NavMode[]): NavMode | undefined {
  const scored = modes
    .map((m) => {
      const hrefs = [m.href, ...(m.children ?? []).map((c) => c.href)];
      const hit = hrefs.some((h) => pathname === h || pathname.startsWith(`${h}/`));
      return { m, hit };
    })
    .filter((x) => x.hit);
  // Prefer the mode whose child is the longest prefix (CRM /contacts vs More nothing).
  return scored.sort((a, b) => {
    const al = Math.max(...[a.m.href, ...(a.m.children ?? []).map((c) => c.href)].map((h) => h.length));
    const bl = Math.max(...[b.m.href, ...(b.m.children ?? []).map((c) => c.href)].map((h) => h.length));
    return bl - al;
  })[0]?.m;
}

export function childActive(pathname: string, href: string): boolean {
  if (href === '/contacts') return pathname === '/contacts' || pathname.startsWith('/contacts/');
  if (href === '/accounts') return pathname === '/accounts' || pathname.startsWith('/accounts/');
  return pathname === href || pathname.startsWith(`${href}/`);
}
