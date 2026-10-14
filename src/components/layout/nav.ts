import type { Role } from '@/lib/auth/session';

export interface NavItem { href: string; label: string; icon: string; roles: Role[] }
export interface NavGroup { label: string; items: NavItem[] }

/** Organizer navigation. Visibility is a convenience — every route also enforces its role server-side. */
export const NAV: NavGroup[] = [
  { label: 'Event', items: [
    { href: '/admin/dashboard', label: 'Overview', icon: 'gauge', roles: ['admin'] },
    { href: '/admin/attendance', label: 'Registration desk', icon: 'desk', roles: ['admin', 'volunteer'] },
    { href: '/admin/entries', label: 'Participants', icon: 'users', roles: ['admin'] },
  ] },
  { label: 'Competition', items: [
    { href: '/admin/round1', label: 'Round 1', icon: 'swords', roles: ['admin'] },
    { href: '/admin/challenges', label: 'Challenge pool', icon: 'library', roles: ['admin'] },
    { href: '/admin/round2', label: 'Round 2', icon: 'trophy', roles: ['admin'] },
    { href: '/judge/dashboard', label: 'Jury', icon: 'gavel', roles: ['admin', 'judge'] },
  ] },
  { label: 'Results & comms', items: [
    { href: '/admin/results', label: 'Results', icon: 'podium', roles: ['admin'] },
    { href: '/admin/announcements', label: 'Announcements', icon: 'megaphone', roles: ['admin'] },
    { href: '/display', label: 'Projector screen', icon: 'monitor', roles: ['admin', 'volunteer', 'judge'] },
  ] },
  { label: 'System', items: [
    { href: '/admin/ai-settings', label: 'AI judging', icon: 'sparkles', roles: ['admin'] },
    { href: '/admin/users', label: 'Accounts', icon: 'key', roles: ['admin'] },
    { href: '/admin/settings', label: 'Settings & health', icon: 'settings', roles: ['admin'] },
  ] },
];

export function navFor(role: Role): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length);
}
