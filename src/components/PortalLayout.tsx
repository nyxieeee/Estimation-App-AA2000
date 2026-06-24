import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { User } from '../types';
import type { ThemeMode } from './Profile';
import {
  countUnreadVisible,
  getVisibleNotifications,
  markAllVisibleRead,
  markNotificationRead,
  NOTIFICATIONS_UPDATED_EVENT,
  type InAppNotification,
} from '../utils/inAppNotifications';

export type PortalNavKey = 'ongoing' | 'upcoming' | 'history' | 'create' | 'finalized';

interface Props {
  user: User;
  userRole: 'TECHNICIAN' | 'ADMIN' | null;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  compactMode: boolean;
  onCompactModeChange: (compact: boolean) => void;
  /** Which primary nav item is active (sidebar). Omit on profile-only views. */
  activeNav?: PortalNavKey | null;
  onNavigate: (key: PortalNavKey) => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  /** Header title override (e.g. page name). */
  headerTitle?: string;
  /** When set, each notification row is clickable and routes by role + payload (`projectId`, `kind`). */
  onNotificationNavigate?: (n: InAppNotification) => void;
  /** When true, the workspace sidebar is hidden and the mobile nav drawer cannot open (modal focus mode). */
  suppressSidebar?: boolean;
  children: React.ReactNode;
}

function formatNotifTime(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function roleLabel(userRole: 'TECHNICIAN' | 'ADMIN' | null): string {
  if (userRole === 'ADMIN') return 'Admin';
  if (userRole === 'TECHNICIAN') return 'Technician';
  return 'Guest';
}

function userInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

/** Unread notifications that map to each workspace nav section (for sidebar badges). */
function unreadCountForNav(
  items: InAppNotification[],
  navKey: PortalNavKey,
  userRole: 'TECHNICIAN' | 'ADMIN' | null
): number {
  const unread = items.filter((n) => !n.read);
  if (userRole === 'TECHNICIAN') {
    if (navKey === 'ongoing') return unread.filter((n) => n.kind === 'TECH_ASSIGNMENT').length;
    if (navKey === 'history') return unread.filter((n) => n.kind === 'TECH_FINALIZATION').length;
    return 0;
  }
  if (userRole === 'ADMIN') {
    if (navKey === 'ongoing')
      return unread.filter((n) => n.kind === 'ADMIN_TECH_RESPONSE' || n.kind === 'ADMIN_TECH_COMPLETED').length;
    if (navKey === 'finalized')
      return unread.filter((n) => n.kind === 'ADMIN_FINALIZATION_REQUEST' || n.kind === 'ADMIN_FINALIZATION_CONFIRMATION').length;
    return 0;
  }
  return 0;
}

/**
 * Shared portal chrome: blue EMS-style sidebar with branding, notifications, profile, and workspace nav.
 */
const PortalLayout: React.FC<Props> = ({
  user,
  userRole,
  theme,
  onThemeChange,
  compactMode,
  onCompactModeChange,
  activeNav,
  onNavigate,
  onOpenProfile,
  onLogout,
  headerTitle,
  onNotificationNavigate,
  suppressSidebar = false,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [badgeCount, setBadgeCount] = useState(0);
  const [notifItems, setNotifItems] = useState<InAppNotification[]>([]);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [displaySectionOpen, setDisplaySectionOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpLanguage, setHelpLanguage] = useState<'en' | 'tl'>('en');
  const [sidebarHovered, setSidebarHovered] = useState(false);

  const asideRef = useRef<HTMLElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const notifFlyoutRef = useRef<HTMLDivElement>(null);
  const accountPanelRef = useRef<HTMLDivElement>(null);
  const accountFlyoutRef = useRef<HTMLDivElement>(null);

  type NavFlyoutLayout = { left: number; top: number; width: number; maxHeight: number };
  const [navFlyoutLayout, setNavFlyoutLayout] = useState<NavFlyoutLayout | null>(null);

  const isDark = theme === 'dark';

  const refreshNotifications = useCallback(() => {
    setBadgeCount(countUnreadVisible(user.email, userRole));
    setNotifItems(getVisibleNotifications(user.email, userRole));
  }, [user.email, userRole]);

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    const onUpdated = () => refreshNotifications();
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    window.addEventListener('storage', onUpdated);
    return () => {
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
      window.removeEventListener('storage', onUpdated);
    };
  }, [refreshNotifications]);

  /** Wide sidebar: mobile drawer or desktop hover (flyouts render outside the rail). */
  const railExpanded = suppressSidebar ? false : mobileOpen || sidebarHovered;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      const inNotif =
        notifRef.current?.contains(t) || notifFlyoutRef.current?.contains(t);
      const inAccount =
        accountPanelRef.current?.contains(t) || accountFlyoutRef.current?.contains(t);
      if (notifOpen && !inNotif) setNotifOpen(false);
      if (accountPanelOpen && !inAccount) {
        setAccountPanelOpen(false);
        setDisplaySectionOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [notifOpen, accountPanelOpen]);

  const updateNavFlyoutLayout = useCallback(() => {
    const aside = asideRef.current;
    if (!aside || suppressSidebar || (!notifOpen && !accountPanelOpen)) {
      setNavFlyoutLayout(null);
      return;
    }
    const r = aside.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const maxW = 400;
    const minW = 260;
    const spaceAfter = window.innerWidth - r.right - gap - margin;
    let width: number;
    let left: number;
    if (spaceAfter < minW) {
      left = r.right + gap;
      width = Math.max(220, Math.min(maxW, window.innerWidth - left - margin));
    } else {
      width = Math.min(maxW, spaceAfter);
      left = r.right + gap;
    }
    const top = Math.max(margin, r.top);
    const maxHeight = Math.max(200, window.innerHeight - top - margin);
    setNavFlyoutLayout({ left, top, width, maxHeight });
  }, [suppressSidebar, notifOpen, accountPanelOpen]);

  useLayoutEffect(() => {
    updateNavFlyoutLayout();
    if (!notifOpen && !accountPanelOpen) return;
    let rafId = 0;
    const scheduleLayout = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateNavFlyoutLayout();
      });
    };

    window.addEventListener('resize', scheduleLayout);
    window.addEventListener('scroll', scheduleLayout, true);

    const aside = asideRef.current;
    const onAsideTransition = (e: TransitionEvent) => {
      if (e.propertyName === 'width' || e.propertyName === 'transform') {
        scheduleLayout();
      }
    };
    aside?.addEventListener('transitionrun', onAsideTransition);
    aside?.addEventListener('transitionend', onAsideTransition);

    const ro = aside ? new ResizeObserver(() => scheduleLayout()) : null;
    ro?.observe(aside);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleLayout);
      window.removeEventListener('scroll', scheduleLayout, true);
      aside?.removeEventListener('transitionrun', onAsideTransition);
      aside?.removeEventListener('transitionend', onAsideTransition);
      ro?.disconnect();
    };
  }, [updateNavFlyoutLayout, notifOpen, accountPanelOpen, mobileOpen, sidebarHovered]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifOpen(false);
        setAccountPanelOpen(false);
        setDisplaySectionOpen(false);
        setHelpOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!suppressSidebar) return;
    setMobileOpen(false);
  }, [suppressSidebar]);

  const navItems: { key: PortalNavKey; label: string; icon: string; adminOnly?: boolean }[] = [
    { key: 'ongoing', label: 'Active', icon: 'fa-play-circle' },
    { key: 'upcoming', label: 'Scheduled', icon: 'fa-calendar-alt' },
    { key: 'history', label: 'Archive', icon: 'fa-archive' },
    { key: 'create', label: 'New Project', icon: 'fa-plus-circle', adminOnly: true },
    { key: 'finalized', label: 'Closed', icon: 'fa-check-circle', adminOnly: true },
  ];

  const visibleNav = navItems.filter((i) => !i.adminOnly || userRole === 'ADMIN');

  const NavButton: React.FC<{ item: (typeof navItems)[0]; badge?: number }> = ({ item, badge = 0 }) => {
    const active = activeNav === item.key;
    const compact = !railExpanded;

    if (compact) {
      const ringActive = active
        ? 'bg-sky-300 text-[#0a1628] shadow-[0_0_16px_-2px_rgba(56,189,248,0.85)] ring-2 ring-sky-400/60'
        : isDark
          ? 'border border-white/10 bg-white/[0.07] text-slate-200 hover:bg-white/12 hover:text-white'
          : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 hover:text-slate-900';
      return (
        <button
          type="button"
          title={item.label}
          onClick={() => {
            onNavigate(item.key);
            setMobileOpen(false);
          }}
          className={`group relative mx-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${ringActive}`}
          aria-current={active ? 'page' : undefined}
          aria-label={item.label}
        >
          <i className={`fas ${item.icon} text-[15px]`} aria-hidden="true"></i>
          {badge > 0 && (
            <span className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-0.5 text-[9px] font-black text-white ring-2 ${isDark ? 'ring-[#0a1628]' : 'ring-slate-100'}`}>
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </button>
      );
    }

    const baseBtn = active
      ? isDark
        ? 'bg-sky-400/20 font-bold text-sky-50 ring-1 ring-sky-400/50 shadow-[0_0_20px_-6px_rgba(56,189,248,0.65)]'
        : 'bg-sky-200/70 font-bold text-slate-900 ring-1 ring-sky-300 shadow-[0_0_16px_-8px_rgba(2,132,199,0.5)]'
      : isDark
        ? 'font-semibold text-slate-300 hover:bg-white/[0.06] hover:text-white'
        : 'font-semibold text-slate-900 hover:bg-slate-200/70 hover:text-slate-900';

    const iconBox = active
      ? 'bg-sky-300 text-slate-900 shadow-md'
      : isDark
        ? 'bg-white/[0.08] text-slate-200 group-hover:bg-white/15 group-hover:text-white'
        : 'bg-white text-slate-800 ring-1 ring-slate-200 group-hover:bg-slate-100 group-hover:text-slate-900';

    return (
      <button
        type="button"
        onClick={() => {
          onNavigate(item.key);
          setMobileOpen(false);
        }}
        className={`group relative flex w-full items-center rounded-2xl py-3 pl-2.5 pr-3 text-left justify-start gap-3.5 touch-target transition-colors duration-200 ${baseBtn}`}
        aria-current={active ? 'page' : undefined}
      >
        <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBox}`}>
          <i className={`fas ${item.icon} text-sm`} aria-hidden="true"></i>
          {badge > 0 && (
            <span className={`absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-0.5 text-[9px] font-black text-white ring-2 ${isDark ? 'ring-[#0a1628]' : 'ring-slate-100'}`}>
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </span>
        <span className={`min-w-0 flex-1 truncate text-left text-[11px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
          {item.label}
        </span>
      </button>
    );
  };

  const copy = {
    language: helpLanguage === 'tl' ? 'Wika' : 'Language',
    english: 'English',
    tagalog: 'Tagalog',
    helpTitle: helpLanguage === 'tl' ? 'Tulong at Suporta' : 'Help & Support',
    aboutTitle: helpLanguage === 'tl' ? 'Tungkol sa app na ito' : 'About this app',
    aboutBody:
      helpLanguage === 'tl'
        ? 'Ang AA2000 Site Survey ay tumutulong sa team na kumuha ng field audit, gumamit ng AI-assisted clarification, at gumawa ng estimates at summaries. Ang data rito ay naka-save sa device na ito maliban kung nakakonekta sa server ng inyong organization.'
        : 'AA2000 Site Survey helps teams capture field audits, run AI-assisted clarification, and produce estimates and summaries. Data shown here is stored on this device unless your organization connects a server.',
    quickStartTitle: helpLanguage === 'tl' ? 'Mabilis na simula' : 'Quick start',
    technicianWorkflowTitle: helpLanguage === 'tl' ? 'Daloy ng trabaho ng Technician' : 'Technician workflow',
    adminWorkflowTitle: helpLanguage === 'tl' ? 'Daloy ng trabaho ng Sales at Admin' : 'Sales & Admin workflow',
    guestGuidanceTitle: helpLanguage === 'tl' ? 'Gabay para sa Guest' : 'Guest guidance',
    guestGuidanceBody:
      helpLanguage === 'tl'
        ? 'Mag-sign in gamit ang Technician o Admin account para makita ang role-specific workflows at support instructions.'
        : 'Sign in with a Technician or Admin account to see role-specific workflows and support instructions.',
    technicianFaqTitle: helpLanguage === 'tl' ? 'FAQ para sa Technician' : 'Technician FAQ',
    adminFaqTitle: helpLanguage === 'tl' ? 'FAQ para sa Sales at Admin' : 'Sales & Admin FAQ',
    genericFaqTitle: helpLanguage === 'tl' ? 'Mga madalas itanong (FAQ)' : 'Frequently asked questions (FAQ)',
    close: helpLanguage === 'tl' ? 'Isara' : 'Close',
  };

  const quickStartSteps = helpLanguage === 'tl'
    ? [
        'Gamitin ang sidebar para lumipat sa Ongoing, Upcoming, History, at Finalized (Admin lamang).',
        'Buksan ang anumang project para i-update ang details, tapusin ang surveys, at panatilihing tama ang status.',
        'Gamitin ang notifications sa sidebar para makita ang assignments, status updates, at approval notes.',
        'Kumpletuhin ang lahat ng required fields bago magsumite para maiwasan ang pabalik-balik na revisions.',
      ]
    : [
        'Use the sidebar to move between Ongoing, Upcoming, History, and Finalized (Admin only).',
        'Open any project to update details, complete surveys, and keep status current.',
        'Use notifications in the sidebar to catch assignments, status updates, and approval notes.',
        'Complete all required fields before submitting to avoid back-and-forth and delays.',
      ];

  const technicianGuide = helpLanguage === 'tl'
    ? [
        'Buksan ang Ongoing projects at piliin ang na-assign sa iyo.',
        'Sa Project Details, i-verify ang site info, contact details, at floor/area data bago magsimula.',
        'Kumpletuhin nang maingat ang bawat survey section (CCTV, Fire Alarm, Access Control, Others).',
        'Gamitin ang AI Clarification para sa kulang na specs, saka i-update ang form gamit ang confirmed values.',
        'I-review ang Survey Summary at estimation output, pagkatapos ay isumite para sa Admin review.',
      ]
    : [
        'Open Ongoing projects and select your assigned job from the list.',
        'In Project Details, verify site info, contact details, and floor/area data before starting.',
        'Complete each survey section carefully (CCTV, Fire Alarm, Access Control, Others).',
        'Use AI Clarification to resolve missing specs, then update the form with confirmed values.',
        'Review Survey Summary and estimation output, then submit for Admin review.',
      ];

  const salesAdminGuide = helpLanguage === 'tl'
    ? [
        'Gamitin ang Create para mag-register ng bagong opportunities na kumpleto ang customer at project metadata.',
        'Mag-assign ng technicians at i-monitor ang progreso sa Ongoing at Upcoming queues.',
        'I-review ang submitted surveys para sa quality, scope alignment, at pricing readiness.',
        'I-finalize ang approved projects at mag-export ng reports mula sa Finalized workspace.',
        'Gamitin ang History para sa references, repeat jobs, at audit trail tracking.',
      ]
    : [
        'Use Create to register new opportunities with complete customer and project metadata.',
        'Assign technicians and monitor progress through Ongoing and Upcoming queues.',
        'Review submitted surveys for quality, scope alignment, and pricing readiness.',
        'Finalize approved projects and export reports from the Finalized workspace.',
        'Use History for references, repeat jobs, and audit trail tracking.',
      ];

  const faqItems: { question: string; answer: string }[] = helpLanguage === 'tl'
    ? [
        {
          question: 'Kailan ko gagamitin ang Ongoing at Upcoming?',
          answer:
            'Gamitin ang Upcoming para sa planadong trabaho na hindi pa nagsisimula. Ilipat sa Ongoing kapag may aktwal nang field activity, survey capture, o active coordination.',
        },
        {
          question: 'Bakit hindi ko makita ang Create o Finalized tabs?',
          answer:
            'Role-based ang sections na ito. Ang Create at Finalized ay para sa Sales/Admin users. Karaniwang Ongoing, Upcoming, at History ang nakikita ng technicians.',
        },
        {
          question: 'Paano kung kulang ang required survey details sa site?',
          answer:
            'I-save muna ang tamang nakuhang data, gamitin ang AI Clarification para makita ang kulang, at makipag-coordinate sa client/site contacts bago mag-final submit.',
        },
      ]
    : [
        {
          question: 'When should I use Ongoing vs Upcoming?',
          answer:
            'Use Upcoming for planned work that has not started yet. Move work to Ongoing once field activity, survey capture, or active coordination begins.',
        },
        {
          question: 'Why can I not see the Create or Finalized tabs?',
          answer:
            'These sections are role-based. Create and Finalized are available to Sales/Admin users. Technicians typically work in Ongoing, Upcoming, and History.',
        },
        {
          question: 'What if required survey details are missing from site?',
          answer:
            'Save what you can accurately capture, use AI Clarification to identify gaps, then coordinate with client/site contacts before final submission.',
        },
      ];
  const technicianFaqItems: { question: string; answer: string }[] = helpLanguage === 'tl'
    ? [
        {
          question: 'Ano ang gagawin ko kung kulang ang site data?',
          answer:
            'I-record muna ang verified details, markahan ang unknown values, at gamitin ang AI Clarification para malaman kung ano pa ang dapat i-confirm bago magsumite.',
        },
        {
          question: 'Kailan ako dapat magsumite para sa review?',
          answer:
            'Magsumite lamang kapag kumpleto ang required survey fields at tumutugma ang Survey Summary sa aktwal na kondisyon sa site.',
        },
        {
          question: 'Paano mababawasan ang rework mula sa admin feedback?',
          answer:
            'I-double check ang quantities, equipment placement assumptions, cable routes, at notes para sa special client requirements.',
        },
      ]
    : [
        {
          question: 'What should I do if site data is incomplete?',
          answer:
            'Record verified details first, flag unknown values, and use AI Clarification to identify what must be confirmed before submission.',
        },
        {
          question: 'When should I submit a project for review?',
          answer:
            'Submit only after required survey fields are complete and the Survey Summary reflects the actual on-site conditions.',
        },
        {
          question: 'How do I reduce rework from admin feedback?',
          answer:
            'Double-check quantities, equipment placement assumptions, cable routes, and notes for special client requirements.',
        },
      ];
  const adminFaqItems: { question: string; answer: string }[] = helpLanguage === 'tl'
    ? [
        {
          question: 'Paano ko mapapanatiling on schedule ang projects?',
          answer:
            'Maglagay ng kumpletong project details sa creation, tamang technician assignment nang maaga, at araw-araw na monitoring ng Ongoing at Upcoming queues.',
        },
        {
          question: 'Ano ang tamang paraan sa pag-review ng technician submissions?',
          answer:
            'I-validate ang scope completeness, pricing readiness, at client-specific constraints bago finalization at report export.',
        },
        {
          question: 'Paano maiiwasan ang approval delays?',
          answer:
            'Magbigay ng malinaw na review comments, i-standardize ang required survey fields, at siguraduhing resolved ang clarification gaps bago i-mark bilang finalized.',
        },
      ]
    : [
        {
          question: 'How do I keep projects moving on schedule?',
          answer:
            'Set complete project details at creation, assign the right technician early, and monitor Ongoing and Upcoming queues daily.',
        },
        {
          question: 'What is the best way to review technician submissions?',
          answer:
            'Validate scope completeness, pricing readiness, and client-specific constraints before finalization and report export.',
        },
        {
          question: 'How can I prevent approval delays?',
          answer:
            'Use clear review comments, standardize required survey fields, and ensure clarification gaps are resolved before marking finalized.',
        },
      ];
  const roleFaqItems =
    userRole === 'TECHNICIAN' ? technicianFaqItems : userRole === 'ADMIN' ? adminFaqItems : faqItems;

  const menuSurface = isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white';
  const menuMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const railSurface = isDark
    ? 'border-r border-sky-900/45 bg-gradient-to-b from-[#0f2847] to-[#0a1628] shadow-xl shadow-sky-950/40 md:border md:border-sky-900/35'
    : 'border-r border-slate-200 bg-gradient-to-b from-slate-100 to-slate-50 shadow-xl shadow-slate-300/40 md:border md:border-slate-200';
  const railPanelBorder = isDark ? 'border-white/10' : 'border-slate-200';
  const railSubtleSurface = isDark
    ? 'border-white/10 bg-white/[0.08] text-sky-100 hover:bg-white/12'
    : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100';
  const railHeading = isDark ? 'text-white' : 'text-slate-900';
  const railMuted = isDark ? 'text-sky-300/95' : 'text-slate-700';
  const railBadgeRing = isDark ? 'ring-[#0a1628] text-[#0a1628]' : 'ring-slate-100 text-slate-900';

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'}`}
    >
      {!suppressSidebar && (
        <button
          type="button"
          className={`fixed left-4 top-4 z-[885] flex h-12 w-12 items-center justify-center rounded-2xl border shadow-lg transition md:hidden ${
            isDark
              ? 'border-sky-500/35 bg-[#0a1628] text-sky-100 hover:bg-[#132f52]'
              : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100'
          } ${mobileOpen ? 'pointer-events-none opacity-0' : ''}`}
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
        >
          <i className="fas fa-bars" aria-hidden="true"></i>
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        {mobileOpen && !suppressSidebar && (
          <button
            type="button"
            className="fixed inset-0 z-[890] bg-black/50 md:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {!suppressSidebar && (
          <>
          <aside
            ref={asideRef}
            className={`fixed bottom-0 left-0 top-0 z-[891] flex h-full shrink-0 flex-col overflow-x-hidden overflow-y-auto transition-[width,transform,box-shadow] duration-300 ease-out max-md:w-[min(19.5rem,calc(100vw-1rem))] md:my-4 md:ml-2 md:h-[calc(100%-2rem)] md:max-h-[calc(100%-2rem)] md:self-center md:rounded-3xl md:shadow-2xl ${railSurface} ${
              railExpanded ? 'md:w-[19.5rem]' : 'md:w-[5.25rem]'
            } ${
              mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
            }`}
            aria-label="Main navigation"
            onMouseEnter={() => setSidebarHovered(true)}
            onMouseLeave={(e) => {
              const next = e.relatedTarget as Node | null;
              if (notifFlyoutRef.current?.contains(next) || accountFlyoutRef.current?.contains(next)) return;
              setSidebarHovered(false);
            }}
          >
            {!railExpanded ? (
              <div className="flex min-h-0 flex-1 flex-col items-center px-2 pb-5 pt-6 md:pt-7">
                <button
                  type="button"
                  className={`mb-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition md:hidden ${isDark ? 'bg-white/10 text-slate-200 hover:bg-white/15' : 'bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-100'}`}
                  aria-label="Close navigation"
                  onClick={() => setMobileOpen(false)}
                >
                  <i className="fas fa-times text-sm" aria-hidden="true"></i>
                </button>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-300 text-[#0a1628] shadow-md shadow-sky-900/25">
                  <i className="fas fa-bolt text-lg" aria-hidden="true"></i>
                </div>
                <nav className="mt-7 flex min-h-0 w-full flex-1 flex-col items-center gap-5 overflow-y-auto overflow-x-visible py-2" aria-label="Workspace">
                  {visibleNav.map((item) => (
                    <NavButton
                      key={item.key}
                      item={item}
                      badge={unreadCountForNav(notifItems, item.key, userRole)}
                    />
                  ))}
                </nav>
                <div className="mt-auto flex w-full flex-col items-center gap-4 pt-10">
                  <div className="relative w-full" ref={notifRef}>
                    <button
                      type="button"
                      className={`relative mx-auto flex h-12 w-12 items-center justify-center rounded-full border transition ${railSubtleSurface}`}
                      title="Notifications"
                      aria-label={`Notifications${badgeCount ? `, ${badgeCount} unread` : ''}`}
                      onClick={() => {
                        setNotifOpen((o) => !o);
                        setAccountPanelOpen(false);
                      }}
                    >
                      <i className="fas fa-bell text-[15px]" aria-hidden="true"></i>
                      {badgeCount > 0 && (
                        <span className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-sky-400 px-0.5 text-[9px] font-black ring-2 ${railBadgeRing}`}>
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="relative w-full" ref={accountPanelRef}>
                    <button
                      type="button"
                      title="Settings & Profile"
                      className={`relative mx-auto flex h-12 w-12 items-center justify-center rounded-full border text-[15px] transition ${
                        accountPanelOpen
                          ? 'border-sky-400/60 bg-sky-400/25 text-white shadow-[0_0_14px_-2px_rgba(56,189,248,0.6)]'
                          : railSubtleSurface
                      }`}
                      aria-expanded={accountPanelOpen}
                      aria-controls="account-settings-panel"
                      aria-label="Settings and profile"
                      onClick={() => {
                        setAccountPanelOpen((o) => !o);
                        setNotifOpen(false);
                      }}
                    >
                      <i className="fas fa-user-gear" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
                <div
                  className="mt-5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-sky-400/45 bg-sky-300 text-xs font-black tracking-tight text-[#0a1628] shadow-md"
                  aria-hidden="true"
                >
                  {userInitials(user.fullName || 'User')}
                </div>
              </div>
            ) : (
            <div className="flex min-h-0 flex-1 flex-col">
            <div className={`flex shrink-0 flex-col gap-4 border-b px-5 pb-5 pt-6 ${railPanelBorder}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-300 text-[#0a1628] shadow-md shadow-sky-900/30">
                    <i className="fas fa-bolt text-lg" aria-hidden="true"></i>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[0.8125rem] font-black leading-tight ${railHeading}`}>{headerTitle ?? 'AA2000 Portal'}</p>
                    <p className={`mt-1 truncate text-[11px] font-semibold leading-snug ${railMuted}`}>Site Survey</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition md:hidden ${isDark ? 'bg-white/10 text-slate-200 hover:bg-white/15' : 'bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-100'}`}
                  aria-label="Close navigation"
                  onClick={() => setMobileOpen(false)}
                >
                  <i className="fas fa-times" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div className={`flex min-h-0 flex-1 flex-col border-b px-4 pb-4 pt-2 ${railPanelBorder}`}>
              <p className={`mb-2.5 pl-1 text-[10px] font-black uppercase tracking-[0.2em] ${isDark ? 'text-sky-400/70' : 'text-slate-700'}`}>Workspace</p>
              <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto py-1" aria-label="Workspace">
                {visibleNav.map((item) => (
                  <NavButton
                    key={item.key}
                    item={item}
                    badge={unreadCountForNav(notifItems, item.key, userRole)}
                  />
                ))}
              </nav>
            </div>

            <div className={`flex shrink-0 flex-col gap-2.5 border-b px-5 py-4 ${railPanelBorder}`}>
                <div className="relative" ref={notifRef}>
                  <button
                    type="button"
                    className={`touch-target relative flex w-full items-center justify-center gap-2.5 rounded-2xl border px-4 py-3.5 text-sm font-bold transition ${
                      isDark
                        ? 'border-white/10 bg-white/[0.07] text-sky-50 hover:bg-white/10'
                        : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100'
                    }`}
                    aria-label={`Notifications${badgeCount ? `, ${badgeCount} unread` : ''}`}
                    onClick={() => {
                      setNotifOpen((o) => !o);
                      setAccountPanelOpen(false);
                    }}
                  >
                    <i className={`fas fa-bell ${isDark ? 'text-sky-100' : 'text-sky-600'}`} aria-hidden="true"></i>
                    Notifications
                    {badgeCount > 0 && (
                      <span className={`absolute right-3 top-2.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-400 px-1 text-[10px] font-black ring-2 ${railBadgeRing}`}>
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </span>
                    )}
                  </button>
                </div>

                <div className="relative" ref={accountPanelRef}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-center gap-2.5 rounded-2xl border px-4 py-3.5 text-sm font-bold transition ${
                      accountPanelOpen
                        ? 'border-sky-400/50 bg-sky-400/15 text-white ring-1 ring-sky-400/35'
                        : isDark
                          ? 'border-white/10 bg-white/[0.07] text-sky-50 hover:bg-white/10'
                          : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100'
                    }`}
                    aria-expanded={accountPanelOpen}
                    aria-controls="account-settings-panel"
                    onClick={() => {
                      setAccountPanelOpen((o) => !o);
                      setNotifOpen(false);
                    }}
                  >
                    <i className={`fas fa-user-gear ${isDark ? 'text-sky-100' : 'text-sky-600'}`} aria-hidden="true"></i>
                    Settings &amp; Profile
                  </button>
                </div>
              </div>

            <div className={`shrink-0 border-t px-5 py-5 ${railPanelBorder}`}>
              <div className="flex items-center gap-3.5">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-sky-400/40 bg-sky-300 text-sm font-black tracking-tight text-[#0a1628] shadow-md"
                  aria-hidden="true"
                >
                  {userInitials(user.fullName || 'User')}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className={`truncate text-sm font-bold leading-snug ${railHeading}`}>{user.fullName || 'User'}</p>
                  <p className={`mt-0.5 truncate text-[11px] font-medium ${railMuted}`}>{roleLabel(userRole)}</p>
                </div>
              </div>
            </div>
            </div>
            )}
          </aside>

          {navFlyoutLayout && notifOpen && (
            <div
              ref={notifFlyoutRef}
              className={`fixed z-[892] flex flex-col overflow-hidden rounded-2xl border shadow-2xl transition-[left,top,width,max-height] duration-200 ease-out ${menuSurface}`}
              style={{
                left: navFlyoutLayout.left,
                top: navFlyoutLayout.top,
                width: navFlyoutLayout.width,
                maxHeight: navFlyoutLayout.maxHeight,
              }}
              role="menu"
              onMouseLeave={(e) => {
                const next = e.relatedTarget as Node | null;
                if (asideRef.current?.contains(next) || notifFlyoutRef.current?.contains(next)) return;
                setSidebarHovered(false);
              }}
            >
              <div className={`shrink-0 border-b px-4 py-3 ${isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50/80'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-[11px] font-black uppercase tracking-widest ${menuMuted}`}>Notifications</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                      badgeCount
                        ? isDark
                          ? 'bg-blue-500/20 text-blue-200'
                          : 'bg-blue-100 text-blue-700'
                        : isDark
                          ? 'bg-slate-800 text-slate-300'
                          : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {badgeCount ? `${badgeCount} unread` : 'All read'}
                  </span>
                </div>
              </div>

              <div className={`min-h-0 flex-1 overflow-y-auto px-3 py-2 ${notifItems.length ? '' : 'pb-3'}`}>
                {notifItems.length === 0 ? (
                  <div
                    className={`rounded-xl border px-3 py-4 text-center text-[11px] ${
                      isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'
                    } ${menuMuted}`}
                  >
                    No notifications yet.
                  </div>
                ) : (
                  notifItems.map((n) => {
                    const rowSurface = n.read
                      ? isDark
                        ? 'bg-white/[0.02] ring-1 ring-white/[0.05]'
                        : 'bg-slate-50 ring-1 ring-slate-200/70'
                      : isDark
                        ? 'bg-blue-950/45 ring-1 ring-blue-500/30'
                        : 'bg-blue-50 ring-1 ring-blue-200';
                    const interactive = !!onNotificationNavigate;
                    const rowClasses = `mb-2 w-full rounded-xl px-3 py-3 text-left transition ${rowSurface} ${
                      interactive
                        ? isDark
                          ? 'cursor-pointer hover:bg-slate-800/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
                          : 'cursor-pointer hover:bg-blue-100/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
                        : ''
                    }`;
                    const body = (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <p className={`min-w-0 break-words text-[12px] leading-snug ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                            {n.message}
                          </p>
                          {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-hidden="true"></span>}
                        </div>
                        {n.projectName && (
                          <p className={`mt-1.5 truncate text-[11px] font-bold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{n.projectName}</p>
                        )}
                        <p className={`mt-1.5 text-[10px] font-bold uppercase tracking-wider ${menuMuted}`}>{formatNotifTime(n.createdAt)}</p>
                      </>
                    );
                    if (interactive) {
                      return (
                        <button
                          key={n.id}
                          type="button"
                          role="menuitem"
                          className={rowClasses}
                          onClick={() => {
                            markNotificationRead(n.id);
                            refreshNotifications();
                            setNotifOpen(false);
                            onNotificationNavigate!(n);
                          }}
                        >
                          {body}
                        </button>
                      );
                    }
                    return (
                      <div key={n.id} className={rowClasses}>
                        {body}
                      </div>
                    );
                  })
                )}
              </div>
              <div className={`shrink-0 border-t px-3 py-2.5 ${isDark ? 'border-slate-700/80 bg-slate-900/40' : 'border-slate-200 bg-slate-50/70'}`}>
                <button
                  type="button"
                  className={`w-full rounded-lg px-3 py-2 text-left text-xs font-bold transition ${
                    isDark ? 'text-slate-100 hover:bg-slate-800' : 'text-slate-800 hover:bg-white'
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                  disabled={!notifItems.some((n) => !n.read)}
                  onClick={() => {
                    markAllVisibleRead(user.email, userRole);
                    refreshNotifications();
                  }}
                >
                  Mark all as read
                </button>
              </div>
              <p className={`shrink-0 border-t px-4 py-2 text-[10px] ${isDark ? 'border-slate-700/80' : 'border-slate-200'} ${menuMuted}`}>
                Types you see depend on your role; turn channels on or off in profile.
              </p>
            </div>
          )}

          {navFlyoutLayout && accountPanelOpen && (
            <div
              ref={accountFlyoutRef}
              id="account-settings-panel"
              className={`fixed z-[892] space-y-0.5 overflow-y-auto rounded-2xl border p-3 shadow-2xl transition-[left,top,width,max-height] duration-200 ease-out ${menuSurface}`}
              style={{
                left: navFlyoutLayout.left,
                top: navFlyoutLayout.top,
                width: navFlyoutLayout.width,
                maxHeight: navFlyoutLayout.maxHeight,
              }}
              role="region"
              aria-label="Account and settings"
              onMouseLeave={(e) => {
                const next = e.relatedTarget as Node | null;
                if (asideRef.current?.contains(next) || accountFlyoutRef.current?.contains(next)) return;
                setSidebarHovered(false);
              }}
            >
              <div
                className={`mb-3 rounded-xl border px-3 py-3 ${
                  isDark ? 'border-white/10 bg-white/[0.04]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-[9px] font-black uppercase tracking-widest text-sky-500">Signed in</p>
                <div className="mt-1 flex items-center gap-2.5">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xs font-black tracking-tight ${
                      isDark
                        ? 'border-sky-400/40 bg-sky-500/20 text-sky-100'
                        : 'border-sky-300 bg-sky-100 text-sky-700'
                    }`}
                    aria-hidden="true"
                  >
                    {userInitials(user.fullName || 'User')}
                  </div>
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{user.fullName || 'User'}</p>
                    <p className={`truncate text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{user.email}</p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                  isDark ? 'text-slate-100 hover:bg-white/10' : 'text-slate-800 hover:bg-slate-100'
                }`}
                onClick={() => {
                  setAccountPanelOpen(false);
                  setMobileOpen(false);
                  onOpenProfile();
                }}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 ${
                    isDark ? 'text-sky-200' : 'text-sky-700'
                  }`}
                >
                  <i className="fas fa-shield-halved text-sm" aria-hidden="true"></i>
                </span>
                <span className="min-w-0">Settings &amp; Privacy</span>
              </button>

              <button
                type="button"
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                  isDark ? 'text-slate-100 hover:bg-white/10' : 'text-slate-800 hover:bg-slate-100'
                }`}
                onClick={() => {
                  setAccountPanelOpen(false);
                  setHelpOpen(true);
                }}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 ${
                    isDark ? 'text-sky-200' : 'text-sky-700'
                  }`}
                >
                  <i className="fas fa-circle-question text-sm" aria-hidden="true"></i>
                </span>
                <span className="min-w-0">Help &amp; Support</span>
              </button>

              <div className={`border-t pt-1 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                    isDark ? 'text-slate-100 hover:bg-white/10' : 'text-slate-800 hover:bg-slate-100'
                  }`}
                  onClick={() => setDisplaySectionOpen((v) => !v)}
                  aria-expanded={displaySectionOpen}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 ${
                        isDark ? 'text-sky-200' : 'text-sky-700'
                      }`}
                    >
                      <i className="fas fa-universal-access text-sm" aria-hidden="true"></i>
                    </span>
                    <span className="min-w-0">Display &amp; Accessibility</span>
                  </span>
                  <i className={`fas fa-chevron-down text-xs text-sky-400/80 transition ${displaySectionOpen ? 'rotate-180' : ''}`} aria-hidden="true"></i>
                </button>

                {displaySectionOpen && (
                  <div className="mt-2 space-y-2.5 px-1 pb-2">
                    <div
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-xs ${
                        isDark ? 'border-white/10 bg-[#0d1f35]/80' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <span className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Dark mode</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isDark}
                        onClick={() => onThemeChange(isDark ? 'light' : 'dark')}
                        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${
                          isDark ? 'bg-sky-600' : 'bg-slate-500'
                        }`}
                      >
                        <span
                          className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                            isDark ? 'translate-x-6' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                    <div
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-xs ${
                        isDark ? 'border-white/10 bg-[#0d1f35]/80' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div>
                        <p className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Compact mode</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">Smaller interface text</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={compactMode}
                        onClick={() => onCompactModeChange(!compactMode)}
                        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${
                          compactMode ? 'bg-sky-600' : 'bg-slate-500'
                        }`}
                      >
                        <span
                          className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                            compactMode ? 'translate-x-6' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-600/90 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-red-500"
                onClick={() => {
                  setAccountPanelOpen(false);
                  onLogout();
                }}
              >
                <i className="fas fa-right-from-bracket text-white" aria-hidden="true"></i>
                Logout
              </button>
            </div>
          )}
          </>
        )}

        <main
          className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${!suppressSidebar ? 'pt-16 md:pt-0 md:pl-[calc(0.5rem+5.25rem+0.75rem)]' : ''} ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}
        >
          {children}
        </main>
      </div>

      {helpOpen && (
        <div
          className="fixed inset-0 z-[940] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-[1px]"
          role="presentation"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className={`my-auto w-full max-w-3xl rounded-2xl border p-6 shadow-2xl ${menuSurface}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id="help-dialog-title" className={`text-lg font-black ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                {copy.helpTitle}
              </h2>
              <button
                type="button"
                className={`rounded-lg p-2 ${isDark ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                aria-label={copy.close}
                onClick={() => setHelpOpen(false)}
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>
            <div className="mb-4 flex items-center justify-end gap-2">
              <span className={`text-[11px] font-black uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{copy.language}</span>
              <div className={`inline-flex rounded-lg border p-1 ${isDark ? 'border-slate-700 bg-slate-900/70' : 'border-slate-200 bg-slate-100/90'}`}>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                    helpLanguage === 'en'
                      ? isDark
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-600 text-white'
                      : isDark
                        ? 'text-slate-300 hover:bg-slate-800'
                        : 'text-slate-700 hover:bg-white'
                  }`}
                  onClick={() => setHelpLanguage('en')}
                >
                  {copy.english}
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                    helpLanguage === 'tl'
                      ? isDark
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-600 text-white'
                      : isDark
                        ? 'text-slate-300 hover:bg-slate-800'
                        : 'text-slate-700 hover:bg-white'
                  }`}
                  onClick={() => setHelpLanguage('tl')}
                >
                  {copy.tagalog}
                </button>
              </div>
            </div>
            <div className={`max-h-[70vh] space-y-5 overflow-y-auto pr-1 text-sm ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              <section>
                <h3 className={`mb-1 text-xs font-black uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{copy.aboutTitle}</h3>
                <p>{copy.aboutBody}</p>
              </section>
              <section>
                <h3 className={`mb-2 text-xs font-black uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                  {copy.quickStartTitle}
                </h3>
                <ul className="list-disc space-y-1 pl-5">
                  {quickStartSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </section>
              {userRole === 'TECHNICIAN' && (
                <section>
                  <article className={`rounded-xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50/70'}`}>
                    <h3 className={`mb-2 text-xs font-black uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{copy.technicianWorkflowTitle}</h3>
                    <ul className="list-disc space-y-1 pl-5">
                      {technicianGuide.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </article>
                </section>
              )}
              {userRole === 'ADMIN' && (
                <section>
                  <article className={`rounded-xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50/70'}`}>
                    <h3 className={`mb-2 text-xs font-black uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{copy.adminWorkflowTitle}</h3>
                    <ul className="list-disc space-y-1 pl-5">
                      {salesAdminGuide.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </article>
                </section>
              )}
              {userRole !== 'TECHNICIAN' && userRole !== 'ADMIN' && (
                <section className={`rounded-xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50/70'}`}>
                  <h3 className={`mb-2 text-xs font-black uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{copy.guestGuidanceTitle}</h3>
                  <p className="text-xs leading-relaxed">{copy.guestGuidanceBody}</p>
                </section>
              )}
              <section>
                <h3 className={`mb-2 text-xs font-black uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                  {userRole === 'TECHNICIAN' ? copy.technicianFaqTitle : userRole === 'ADMIN' ? copy.adminFaqTitle : copy.genericFaqTitle}
                </h3>
                <div className="space-y-2">
                  {roleFaqItems.map((faq) => (
                    <details
                      key={faq.question}
                      className={`rounded-xl border px-3 py-2 ${isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-white/80'}`}
                    >
                      <summary className={`cursor-pointer text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{faq.question}</summary>
                      <p className="mt-2 text-xs leading-relaxed">{faq.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
            </div>
            <button
              type="button"
              className={`mt-6 w-full rounded-xl py-3 text-sm font-black uppercase tracking-wider ${isDark ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-slate-200 text-slate-900 hover:bg-slate-300'}`}
              onClick={() => setHelpOpen(false)}
            >
              {copy.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalLayout;
