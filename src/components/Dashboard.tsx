import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { User, Project, SurveyType, PROJECT_STATUS_DISPLAY } from '../types';
import type { ThemeMode } from './Profile';
import type { ProjectSortMode } from './App';
import PortalLayout, { PortalNavKey } from './PortalLayout';
import { notifyAdminsTechnicianResponse, type InAppNotification } from '../utils/inAppNotifications';
import { SURVEY_DISPLAY, SURVEY_MODAL_ITEMS, technicianSurveyTasks } from '../utils/projectSurveyVisibility';
import { DEFAULT_DATE_FILTER, matchDateFilter, toDisplayDateMDY, toIsoDate, type DateFilterState } from '../utils/dateFilters';

function memberInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

interface Props {
  /** The authenticated user's profile information, containing fullName and email. */
  user: User;
  /** The logged-in role for role-specific dashboard behavior. */
  userRole: 'TECHNICIAN' | 'ADMIN' | null;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  compactMode: boolean;
  onCompactModeChange: (compact: boolean) => void;
  /** Active workspace tab (ongoing / upcoming / history). Owned by App for sidebar sync. */
  workspaceSection: 'ONGOING' | 'UPCOMING' | 'HISTORY';
  /** Sidebar / workspace navigation (ongoing, create, finalized, etc.). */
  onPortalNavigate: (key: PortalNavKey) => void;
  /** Logic callback to open an existing project + selected survey for editing. */
  onEditAuditFromList: (projectRecord: any, index: number, surveyType: SurveyType) => void;
  /** Opens report summary for Sales/Admin review. */
  onOpenSummaryFromList: (projectRecord: any, index: number) => void;
  onNotificationNavigate: (n: InAppNotification) => void;
  /** Open account profile and settings. */
  onOpenProfile: () => void;
  /** Logic callback to clear the local session and return to role selection. */
  onLogout: () => void;
  /** Standalone intercom service estimation tool (field survey). */
  onOpenIntercomServiceSurvey?: () => void;
  projectSortMode: ProjectSortMode;
  onProjectSortModeChange: (mode: ProjectSortMode) => void;
  /** Optional target project for auto-opening the original Start Audit system picker modal. */
  openSystemModalTarget?: { projectId: string; timestamp?: string; nonce: number } | null;
  /** Callback fired once auto-open target has been consumed. */
  onOpenSystemModalTargetConsumed?: () => void;
}

/**
 * DASHBOARD COMPONENT
 * Purpose: This is the central operational hub for technicians. It provides 
 * high-level navigation to the core features of the site survey system.
 */
const Dashboard: React.FC<Props> = ({
  user,
  userRole,
  theme,
  onThemeChange,
  compactMode,
  onCompactModeChange,
  workspaceSection,
  onPortalNavigate,
  onEditAuditFromList,
  onOpenSummaryFromList,
  onNotificationNavigate,
  onOpenProfile,
  onLogout,
  onOpenIntercomServiceSurvey,
  projectSortMode,
  onProjectSortModeChange,
  openSystemModalTarget,
  onOpenSystemModalTargetConsumed,
}) => {
  const activeSection = workspaceSection;
  const [savedProjects, setSavedProjects] = useState<Array<{ record: any; index: number }>>([]);
  const [selectedRecord, setSelectedRecord] = useState<{ record: any; index: number } | null>(null);
  const [editableProject, setEditableProject] = useState<Project | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showSystemModal, setShowSystemModal] = useState(false);
  const [historyDateFilter, setHistoryDateFilter] = useState<DateFilterState>(DEFAULT_DATE_FILTER);
  const [searchQuery, setSearchQuery] = useState('');
  const historyDateInputRef = useRef<HTMLInputElement | null>(null);
  const openNativeDatePicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    if (typeof (input as HTMLInputElement & { showPicker?: () => void }).showPicker === 'function') {
      (input as HTMLInputElement & { showPicker: () => void }).showPicker();
      return;
    }
    input.focus();
  };
  useEffect(() => {
    const savedRaw = localStorage.getItem('aa2000_saved_projects');
    const parsed = savedRaw ? JSON.parse(savedRaw) : [];
    const recordsWithIndex = parsed.map((record: any, index: number) => ({ record, index }));
    const visible = userRole === 'ADMIN'
      ? recordsWithIndex
      : recordsWithIndex.filter((item: { record: any; index: number }) => {
          const project = item.record?.project;
          if (!project) return false;
          const assigned = Array.isArray(project.assignedTechnicians) ? project.assignedTechnicians : [];
          if (!assigned.length) return project.technicianName === user.fullName;
          return assigned.some((t: any) => t.email === user.email || t.fullName === user.fullName);
        });
    setSavedProjects(visible);
  }, [user.email, user.fullName, userRole]);

  useEffect(() => {
    if (userRole !== 'TECHNICIAN' || !openSystemModalTarget) return;
    const match = savedProjects.find(({ record }) => {
      if (record?.project?.id !== openSystemModalTarget.projectId) return false;
      if (openSystemModalTarget.timestamp) return record?.timestamp === openSystemModalTarget.timestamp;
      return true;
    });
    if (!match) return;
    setSelectedRecord({ record: match.record, index: match.index });
    setEditableProject({ ...match.record.project });
    setShowProjectModal(true);
    setShowSystemModal(true);
    onOpenSystemModalTargetConsumed?.();
  }, [openSystemModalTarget, savedProjects, userRole, onOpenSystemModalTargetConsumed]);

  const resolveCategory = (project: Project): 'ONGOING' | 'UPCOMING' | 'HISTORY' => {
    if (
      project.status === 'Finalized' ||
      project.status === 'Finalized - Approved' ||
      project.status === 'Finalized - Rejected' ||
      project.status === 'Completed'
    ) return 'HISTORY';
    if (!project.startDate) return 'ONGOING';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(project.startDate);
    start.setHours(0, 0, 0, 0);
    if (start.getTime() > today.getTime()) return 'UPCOMING';
    return 'ONGOING';
  };

  const filteredProjects = useMemo(() => {
    const getSortDate = ({ record }: { record: any; index: number }) =>
      new Date(
        record?.project?.completedAt ||
        record?.project?.finalization?.actedAt ||
        record?.project?.startDate ||
        record?.timestamp ||
        0
      ).getTime();
    const getSortName = ({ record }: { record: any; index: number }) =>
      String(record?.project?.name || '').toLowerCase();
    const sorted = [...savedProjects].sort((a, b) => {
      if (projectSortMode === 'oldest') return getSortDate(a) - getSortDate(b);
      if (projectSortMode === 'name-asc') return getSortName(a).localeCompare(getSortName(b));
      if (projectSortMode === 'name-desc') return getSortName(b).localeCompare(getSortName(a));
      return getSortDate(b) - getSortDate(a);
    });
    return sorted.filter(({ record }) => {
      if (!record?.project) return false;
      const sectionMatch = resolveCategory(record.project) === activeSection;
      if (!sectionMatch) return false;
      if (activeSection !== 'HISTORY') return true;
      const projectDate = record.project?.completedAt || record.project?.startDate || record.timestamp;
      return matchDateFilter(projectDate, historyDateFilter);
    }).filter(({ record }) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      const p = record?.project || {};
      const searchable = [
        p.name,
        p.clientName,
        p.clientContactName,
        p.locationName,
        p.location,
        p.technicianName,
        record?.timestamp,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(q);
    });
  }, [savedProjects, activeSection, historyDateFilter, projectSortMode, searchQuery]);

  const workspaceSnapshot = useMemo(() => {
    const counts = { ongoing: 0, upcoming: 0, history: 0, pendingResponse: 0 };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const { record } of savedProjects) {
      if (!record?.project) continue;
      const project = record.project as Project;
      let cat: 'ONGOING' | 'UPCOMING' | 'HISTORY';
      if (
        project.status === 'Finalized' ||
        project.status === 'Finalized - Approved' ||
        project.status === 'Finalized - Rejected' ||
        project.status === 'Completed'
      ) {
        cat = 'HISTORY';
      } else if (!project.startDate) {
        cat = 'ONGOING';
      } else {
        const start = new Date(project.startDate);
        start.setHours(0, 0, 0, 0);
        cat = start.getTime() > today.getTime() ? 'UPCOMING' : 'ONGOING';
      }
      if (cat === 'ONGOING') counts.ongoing += 1;
      else if (cat === 'UPCOMING') counts.upcoming += 1;
      else counts.history += 1;
      if (cat === 'ONGOING' && userRole === 'TECHNICIAN') {
        const r = project.technicianResponses?.[user.email];
        if (r == null) counts.pendingResponse += 1;
      }
    }
    return counts;
  }, [savedProjects, userRole, user.email]);

  const getTechnicianResponse = (project: Project): 'ACCEPTED' | 'DECLINED' | null => {
    if (!project.technicianResponses) return null;
    return project.technicianResponses[user.email] || null;
  };

  const openProjectModal = (record: any, index: number) => {
    setSelectedRecord({ record, index });
    setEditableProject({ ...record.project });
    setShowProjectModal(true);
  };

  const handleTechnicianResponse = (index: number, response: 'ACCEPTED' | 'DECLINED') => {
    const raw = localStorage.getItem('aa2000_saved_projects');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!parsed[index]?.project) return;
    const project = parsed[index].project;
    if (project.technicianResponses?.[user.email]) return;
    const nextResponses = { ...(project.technicianResponses || {}), [user.email]: response };
    parsed[index] = {
      ...parsed[index],
      project: { ...project, technicianResponses: nextResponses },
    };
    localStorage.setItem('aa2000_saved_projects', JSON.stringify(parsed));
    setSavedProjects((prev) => prev.map((item) => item.index === index
      ? { ...item, record: { ...item.record, project: { ...item.record.project, technicianResponses: nextResponses } } }
      : item
    ));
    notifyAdminsTechnicianResponse(project, user.fullName || user.email, response);
  };

  const closeProjectModal = () => {
    setShowProjectModal(false);
    setShowSystemModal(false);
    setSelectedRecord(null);
    setEditableProject(null);
  };

  const technicianAllowedForModal = useMemo(
    () => (editableProject ? technicianSurveyTasks(editableProject, user.email) : []),
    [editableProject, user.email]
  );

  const proceedToSurvey = (type: SurveyType) => {
    if (!selectedRecord || !editableProject) return;
    if (!technicianAllowedForModal.includes(type)) return;
    onEditAuditFromList(selectedRecord.record, selectedRecord.index, type);
    closeProjectModal();
  };

  const proceedToSurveyCompleted = () => {
    if (!selectedRecord) return;
    onOpenSummaryFromList(selectedRecord.record, selectedRecord.index);
    closeProjectModal();
  };

  const isSurveyCompletedForSelectedRecord = (type: SurveyType): boolean => {
    if (!selectedRecord?.record) return false;
    const record = selectedRecord.record as any;
    const hasEstimation = !!record?.estimations?.[type];
    const hasSurveyData =
      (type === SurveyType.CCTV && !!record?.cctvData) ||
      (type === SurveyType.FIRE_ALARM && !!record?.faData) ||
      (type === SurveyType.FIRE_PROTECTION && !!record?.fpData) ||
      (type === SurveyType.ACCESS_CONTROL && !!record?.acData) ||
      (type === SurveyType.BURGLAR_ALARM && !!record?.baData) ||
      (type === SurveyType.OTHER && !!record?.otherData);
    return hasEstimation && hasSurveyData;
  };

  /** Lock page scroll while project/system modals are open (dashboard + portal main scroll). */
  useEffect(() => {
    if (!showProjectModal) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const mainEl = document.querySelector('main');
    const prevMainOverflow = mainEl instanceof HTMLElement ? mainEl.style.overflow : '';
    if (mainEl instanceof HTMLElement) mainEl.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      if (mainEl instanceof HTMLElement) mainEl.style.overflow = prevMainOverflow;
    };
  }, [showProjectModal]);

  const activeNav: PortalNavKey =
    activeSection === 'ONGOING' ? 'ongoing' : activeSection === 'UPCOMING' ? 'upcoming' : 'history';
  const detailLabelClass = 'block text-[9px] uppercase font-bold tracking-wide text-slate-400 mb-0.5 ml-0.5';
  const detailValueClass =
    'w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-slate-900 font-bold text-xs leading-snug break-words dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100';

  /** Shared modal shell (z-index set per layer: project 1200, system picker 1210 > sidebar 891). */
  const modalOverlayBaseClass =
    'fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[1px] p-2 sm:p-3 md:p-5 animate-fade-in';
  const modalPanelClass =
    'flex max-h-[90vh] w-[95vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:w-[92vw] md:w-[75vw] md:max-w-[80vw] lg:w-[72vw] dark:bg-slate-900 dark:border dark:border-slate-700';

  return (
    <>
      <PortalLayout
        user={user}
        userRole={userRole}
        theme={theme}
        onThemeChange={onThemeChange}
        compactMode={compactMode}
        onCompactModeChange={onCompactModeChange}
        suppressSidebar={userRole === 'TECHNICIAN' && showProjectModal}
        activeNav={activeNav}
        onNavigate={onPortalNavigate}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
        onNotificationNavigate={onNotificationNavigate}
        headerTitle="Dashboard"
      >
        <div className="scrollbar-hide mx-auto w-full max-w-7xl px-3 py-5 sm:px-4 md:px-6 md:py-8 lg:px-8" role="region" aria-label="Dashboard">
          <div className="w-full">
            <div className="space-y-2 pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <h1 className="text-2xl md:text-4xl font-black text-blue-900 dark:text-blue-400">
                  {activeSection === 'ONGOING' ? 'Active' : activeSection === 'UPCOMING' ? 'Scheduled' : 'Archive'}
                </h1>
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Sort
                  <select
                    value={projectSortMode}
                    onChange={(e) => onProjectSortModeChange(e.target.value as ProjectSortMode)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                    aria-label="Sort projects"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="name-asc">Name A-Z</option>
                    <option value="name-desc">Name Z-A</option>
                  </select>
                </label>
              </div>
              <div className="relative max-w-md">
                <i className="fas fa-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400" aria-hidden="true"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search project or company"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm transition focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                  aria-label="Search projects by name or company"
                />
              </div>
              {activeSection === 'HISTORY' && (
                <div className="flex justify-end">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openNativeDatePicker(historyDateInputRef.current)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-blue-700 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-slate-800"
                      aria-label="Open history date picker"
                    >
                      <i className="fas fa-calendar-alt"></i>
                    </button>
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      {historyDateFilter.specificDate ? toDisplayDateMDY(historyDateFilter.specificDate) : 'All dates'}
                    </span>
                    <input
                      ref={historyDateInputRef}
                      type="date"
                      value={historyDateFilter.specificDate}
                      onChange={(e) =>
                        setHistoryDateFilter((prev) => ({
                          ...prev,
                          specificDate: e.target.value,
                        }))
                      }
                      className="sr-only"
                      aria-label="History date filter in M/D/YYYY format"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-6 xl:gap-8">
              <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
              {filteredProjects.length === 0 && (
                <div className="w-full rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center dark:border-slate-700">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">No projects in this category</p>
                </div>
              )}
              {filteredProjects.map(({ record, index }) => {
                const project = record.project as Project;
                const myResponse = getTechnicianResponse(project);
                const isTechnicianHistory = userRole === 'TECHNICIAN' && activeSection === 'HISTORY';
                const scopeCount =
                  project.projectSurveyTypes?.length ||
                  [record.cctvData, record.faData, record.fpData, record.acData, record.baData, record.otherData].filter(Boolean).length;
                const badgeCount = Math.max(scopeCount || 0, 1);
                const scheduleRaw = project.startDate || record.timestamp;
                const scheduleIso = toIsoDate(scheduleRaw) || '—';
                const statusDisplay = PROJECT_STATUS_DISPLAY[project.status] || project.status || 'In Progress';
                const activityLabel =
                  project.projectSurveyTypes?.map((t) => String(t).toUpperCase()).join(' / ') || 'SITE SURVEY / INSPECTION';
                const leadName =
                  project.clientContactName?.trim() || project.technicianName?.trim() || user.fullName || '—';
                const teamMembers = project.assignedTechnicians?.length
                  ? project.assignedTechnicians
                  : project.technicianName
                    ? [{ fullName: project.technicianName, email: '' }]
                    : [];
                const acceptedTeamForAvatars = (() => {
                  const responses = project.technicianResponses || {};
                  const acceptedEmails = Object.entries(responses)
                    .filter(([, v]) => v === 'ACCEPTED')
                    .map(([e]) => e);
                  const matched = teamMembers.filter((t) => Boolean(t.email) && responses[t.email] === 'ACCEPTED');
                  if (matched.length > 0) return matched;
                  if (teamMembers.length === 1 && !teamMembers[0].email && acceptedEmails.length > 0) {
                    return [{ fullName: teamMembers[0].fullName, email: acceptedEmails[0] }];
                  }
                  return matched;
                })();
                const cardInteractive = isTechnicianHistory
                  ? 'cursor-pointer transition-[box-shadow,transform] hover:shadow-md active:scale-[0.99]'
                  : '';
                return (
                  <article
                    key={`${project.id}-${index}`}
                    className={`w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-100/80 text-left shadow-sm dark:border-slate-700 dark:bg-slate-900/60 ${cardInteractive} border-b-[4px] border-b-blue-950 dark:border-b-blue-400`}
                    role={isTechnicianHistory ? 'button' : undefined}
                    tabIndex={isTechnicianHistory ? 0 : undefined}
                    onClick={isTechnicianHistory ? () => onOpenSummaryFromList(record, index) : undefined}
                    onKeyDown={
                      isTechnicianHistory
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onOpenSummaryFromList(record, index);
                            }
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 bg-slate-200/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80 md:px-5">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold uppercase leading-snug tracking-tight text-blue-950 dark:text-blue-100 md:text-base">
                          {project.name || 'Untitled project'}
                        </h3>
                        <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {(project.clientName || 'No client') + ' · ' + (project.locationName || project.location || 'No location')}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span
                          className="flex h-8 min-w-[2rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-black text-white shadow-sm"
                          title="Systems in scope for this visit"
                        >
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                        <span className="hidden text-[9px] font-black uppercase tracking-widest text-blue-800/80 dark:text-blue-300/90 sm:block">
                          {activeSection}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 p-4 md:flex-row md:items-stretch md:gap-0 md:p-0">
                      <div className="min-w-0 flex-1 space-y-3 md:p-5">
                        <p className="text-sm font-medium text-blue-950 dark:text-slate-100">{leadName}</p>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Activity</p>
                          <p className="mt-1 text-xs font-black uppercase leading-snug tracking-tight text-blue-950 dark:text-blue-50 md:text-sm">
                            {activityLabel}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-slate-400 dark:text-slate-500">
                          <span title="Scheduled start">{scheduleIso}</span>
                          {activeSection === 'HISTORY' && project.completedAt && (
                            <span className="text-slate-400 dark:text-slate-500">
                              Completed {toIsoDate(project.completedAt) || toDisplayDateMDY(project.completedAt)}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {statusDisplay}
                        </p>
                      </div>

                      <div
                        className="hidden w-px shrink-0 bg-slate-200 dark:bg-slate-700 md:block"
                        aria-hidden="true"
                      />

                      <div className="min-w-0 border-t border-slate-200 pt-4 dark:border-slate-700 md:w-[min(38%,18rem)] md:border-t-0 md:border-l md:pt-0 md:pl-5 md:pr-5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="flex min-w-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-950 dark:text-blue-200">
                            <i className="fas fa-users shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true"></i>
                            <span>Team</span>
                          </p>
                          {acceptedTeamForAvatars.length > 0 && (
                            <div
                              className="flex shrink-0 items-center -space-x-2"
                              aria-label={`Accepted: ${acceptedTeamForAvatars.map((t) => t.fullName).join(', ')}`}
                            >
                              {acceptedTeamForAvatars.slice(0, 4).map((tech, i) => (
                                <span
                                  key={tech.email}
                                  className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-sky-200 to-sky-400 text-[10px] font-bold text-slate-900 shadow-sm dark:border-slate-900 dark:from-sky-500 dark:to-blue-800 dark:text-white"
                                  style={{ zIndex: i }}
                                  title={tech.fullName}
                                >
                                  <span className="sr-only">{tech.fullName}, accepted</span>
                                  {memberInitials(tech.fullName)}
                                </span>
                              ))}
                              {acceptedTeamForAvatars.length > 4 && (
                                <span
                                  className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[9px] font-bold text-slate-700 shadow-sm dark:border-slate-900 dark:bg-slate-600 dark:text-slate-100"
                                  style={{ zIndex: 20 }}
                                  title={`${acceptedTeamForAvatars.length - 4} more accepted`}
                                >
                                  +{acceptedTeamForAvatars.length - 4}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <ul className="flex flex-col gap-2">
                          {teamMembers.length === 0 ? (
                            <li className="text-[11px] font-medium text-slate-500 dark:text-slate-400">No assignees yet</li>
                          ) : userRole === 'ADMIN' ? (
                            teamMembers.map((tech) => {
                              const res = project.technicianResponses?.[tech.email];
                              const pill =
                                res === 'ACCEPTED'
                                  ? 'border-emerald-200/80 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
                                  : res === 'DECLINED'
                                    ? 'border-red-200/90 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100'
                                    : 'border-slate-200/80 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200';
                              const dot =
                                res === 'ACCEPTED'
                                  ? 'bg-emerald-600 dark:bg-emerald-400'
                                  : res === 'DECLINED'
                                    ? 'bg-rose-600 dark:bg-rose-400'
                                    : 'bg-slate-400 dark:bg-slate-500';
                              return (
                                <li key={tech.email || tech.fullName}>
                                  <span
                                    className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${pill}`}
                                  >
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                                    <span className="min-w-0 truncate">{tech.fullName}{tech.role ? ` (${tech.role})` : ''}</span>
                                  </span>
                                </li>
                              );
                            })
                          ) : (
                            teamMembers.map((tech) => {
                              const res = tech.email ? project.technicianResponses?.[tech.email] : undefined;
                              const pill =
                                res === 'ACCEPTED'
                                  ? 'border-emerald-200/80 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
                                  : res === 'DECLINED'
                                    ? 'border-rose-200/80 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100'
                                    : 'border-slate-200/80 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200';
                              const dot =
                                res === 'ACCEPTED'
                                  ? 'bg-emerald-600 dark:bg-emerald-400'
                                  : res === 'DECLINED'
                                    ? 'bg-rose-600 dark:bg-rose-400'
                                    : 'bg-slate-400 dark:bg-slate-500';
                              const statusLabel =
                                res === 'DECLINED' ? 'Declined' : '';
                              return (
                                <li key={tech.email || tech.fullName}>
                                  <span className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${pill}`}>
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                                    <span className="min-w-0 truncate">{tech.fullName}{tech.role ? ` (${tech.role})` : ''}</span>
                                    {statusLabel && (
                                      <span
                                        className={`shrink-0 text-[9px] font-black uppercase ${
                                          res === 'DECLINED'
                                            ? 'text-red-700 dark:text-red-300'
                                            : 'opacity-80'
                                        }`}
                                      >
                                        {statusLabel}
                                      </span>
                                    )}
                                  </span>
                                </li>
                              );
                            })
                          )}
                        </ul>
                      </div>
                    </div>

                    {userRole === 'TECHNICIAN' && activeSection !== 'HISTORY' && (
                      <div className="flex flex-wrap gap-2 border-t border-slate-200/80 bg-white/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/50 md:px-5">
                        <button
                          type="button"
                          disabled={myResponse != null}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTechnicianResponse(index, 'ACCEPTED');
                          }}
                          className={`rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition ${myResponse === 'ACCEPTED' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/50 dark:text-green-300'} ${myResponse != null ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={myResponse != null}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTechnicianResponse(index, 'DECLINED');
                          }}
                          className={`rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition ${myResponse === 'DECLINED' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-300'} ${myResponse != null ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          disabled={myResponse !== 'ACCEPTED'}
                          onClick={(e) => {
                            e.stopPropagation();
                            openProjectModal(record, index);
                          }}
                          className={`rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition ${myResponse === 'ACCEPTED' ? 'bg-blue-900 text-white hover:bg-blue-800' : 'cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500'}`}
                        >
                          Start audit
                        </button>
                      </div>
                    )}

                    {userRole === 'ADMIN' && (
                      <div className="flex flex-wrap gap-2 border-t border-slate-200/80 bg-white/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/50 md:px-5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSummaryFromList(record, index);
                          }}
                          className="rounded-xl bg-blue-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-800"
                        >
                          Review summary
                        </button>
                        {project.status === 'Completed' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenSummaryFromList(record, index);
                            }}
                            className="rounded-xl bg-green-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-green-500"
                          >
                            Finalize project
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              </div>

              <aside
                className="mt-6 lg:mt-0 lg:col-span-4 space-y-4"
                aria-label="Workspace summary"
              >
                <div className="rounded-2xl border border-slate-200/90 bg-slate-100/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-950 dark:text-blue-200">
                    Overview
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      Projects by status
                    </p>
                  <ul className="mt-4 space-y-2">
                    <li className="flex items-center justify-between gap-3 rounded-xl bg-white/90 px-3 py-2.5 dark:bg-slate-800/80">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Active</span>
                      <span
                        className={`text-lg font-black tabular-nums ${activeSection === 'ONGOING' ? 'text-blue-900 dark:text-blue-300' : 'text-blue-950 dark:text-slate-100'}`}
                      >
                        {workspaceSnapshot.ongoing}
                      </span>
                    </li>
                    <li className="flex items-center justify-between gap-3 rounded-xl bg-white/90 px-3 py-2.5 dark:bg-slate-800/80">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Scheduled</span>
                      <span
                        className={`text-lg font-black tabular-nums ${activeSection === 'UPCOMING' ? 'text-blue-900 dark:text-blue-300' : 'text-blue-950 dark:text-slate-100'}`}
                      >
                        {workspaceSnapshot.upcoming}
                      </span>
                    </li>
                    <li className="flex items-center justify-between gap-3 rounded-xl bg-white/90 px-3 py-2.5 dark:bg-slate-800/80">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Archive</span>
                      <span
                        className={`text-lg font-black tabular-nums ${activeSection === 'HISTORY' ? 'text-blue-900 dark:text-blue-300' : 'text-blue-950 dark:text-slate-100'}`}
                      >
                        {workspaceSnapshot.history}
                      </span>
                    </li>
                  </ul>
                </div>

                {userRole === 'TECHNICIAN' && (
                  <div
                    className={`rounded-2xl border p-4 shadow-sm ${
                      workspaceSnapshot.pendingResponse > 0
                        ? 'border-amber-200/90 bg-amber-50/90 dark:border-amber-800/60 dark:bg-amber-950/30'
                        : 'border-slate-200/90 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/40'
                    }`}
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-950 dark:text-blue-200">
                      <i className="fas fa-clipboard-check mr-1.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                      Your assignments
                    </p>
                    <p className="mt-2 text-[11px] leading-snug text-slate-700 dark:text-slate-300">
                      {workspaceSnapshot.pendingResponse > 0 ? (
                        <>
                          <span className="font-bold text-amber-900 dark:text-amber-200">
                            {workspaceSnapshot.pendingResponse}
                          </span>{' '}
                          {workspaceSnapshot.pendingResponse === 1 ? 'project needs' : 'projects need'} your response.
                        </>
                      ) : (
                        'No pending responses needed.'
                      )}
                    </p>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-blue-900/5 to-transparent p-4 dark:border-slate-700 dark:from-blue-400/10">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-950 dark:text-blue-200">
                    Tip
                  </p>
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                      Accept a project to start your survey.
                    </p>
                </div>
              </aside>
            </div>

            <footer className="pt-8 md:pt-10 text-center text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest shrink-0">
              AA2000 SURVEY PROFESSIONAL
            </footer>
          </div>
        </div>
      </PortalLayout>

      {userRole === 'TECHNICIAN' && showProjectModal && editableProject && (
        <div
          className={`${modalOverlayBaseClass} z-[1200]`}
          role="presentation"
          aria-hidden={showSystemModal}
        >
          <div
            className={`${modalPanelClass} animate-fade-in`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-project-details-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-3 text-blue-900 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300 md:px-5 md:py-3.5">
              <div className="flex items-center justify-between gap-3">
                <h3 id="dashboard-project-details-title" className="font-black uppercase tracking-widest text-[11px]">
                  Project Details
                </h3>
                <button
                  type="button"
                  onClick={closeProjectModal}
                  className="touch-target text-slate-400 transition hover:text-blue-900 dark:hover:text-blue-200"
                  aria-label="Close modal"
                >
                  <i className="fas fa-times text-base" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5 md:py-5">
              <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 md:grid-cols-2">
                <div>
                  <label className={detailLabelClass}>Project Name</label>
                  <div className={detailValueClass}>{editableProject.name || '—'}</div>
                </div>
                <div>
                  <label className={detailLabelClass}>Company name</label>
                  <div className={detailValueClass}>{editableProject.clientName || '—'}</div>
                </div>
                <div>
                  <label className={detailLabelClass}>Client name</label>
                  <div className={detailValueClass}>{editableProject.clientContactName?.trim() || '—'}</div>
                </div>
                <div>
                  <label className={detailLabelClass}>Date</label>
                  <div className={detailValueClass}>{toDisplayDateMDY(editableProject.startDate) || '—'}</div>
                </div>
                <div className="md:col-span-2">
                  <label className={detailLabelClass}>Project Location</label>
                  <div className={detailValueClass}>{editableProject.locationName || editableProject.location || '—'}</div>
                </div>
                <div className="md:col-span-2">
                  <label className={detailLabelClass}>Team on site</label>
                  <div className={detailValueClass}>
                    {(editableProject.assignedTechnicians || []).map((t) => t.fullName).join(', ') || '—'}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-800/80 md:col-span-2 md:flex-row md:flex-wrap md:items-center">
                  <p className="shrink-0 text-[9px] font-black uppercase tracking-wide text-slate-400 sm:mr-1">
                    Your surveys on this project
                  </p>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {technicianAllowedForModal.length ? (
                      technicianAllowedForModal.map((st) => (
                        <span
                          key={st}
                          className="rounded-md bg-blue-900/10 px-2 py-0.5 text-[9px] font-black uppercase text-blue-900 dark:bg-blue-950/80 dark:text-blue-300"
                        >
                          {SURVEY_DISPLAY[st].label}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300">
                        No surveys assigned to you. Contact your coordinator.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 md:px-5">
              <button
                type="button"
                disabled={technicianAllowedForModal.length === 0}
                onClick={() => setShowSystemModal(true)}
                className={`w-full rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest transition ${technicianAllowedForModal.length === 0 ? 'cursor-not-allowed bg-slate-300 text-slate-500 dark:bg-slate-700 dark:text-slate-500' : 'bg-blue-900 text-white hover:bg-blue-800'}`}
              >
                Select Survey System
              </button>
            </div>
          </div>
        </div>
      )}

      {userRole === 'TECHNICIAN' && showProjectModal && showSystemModal && (
        <div
          className={`${modalOverlayBaseClass} z-[1210]`}
          role="presentation"
          onClick={() => setShowSystemModal(false)}
        >
          <div
            className={`${modalPanelClass} animate-fade-in`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-3 text-blue-900 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300 md:px-5 md:py-3.5">
              <div className="flex items-center justify-between gap-3">
                <h3 id="modal-title" className="font-black uppercase tracking-widest text-[11px]">
                  Choose System to Audit
                </h3>
                <button
                  type="button"
                  onClick={() => setShowSystemModal(false)}
                  className="touch-target text-slate-400 transition hover:text-blue-900 dark:hover:text-blue-200"
                  aria-label="Close modal"
                >
                  <i className="fas fa-times text-base" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5 md:py-5">
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-3">
                {SURVEY_MODAL_ITEMS.filter((item) => technicianAllowedForModal.includes(item.type)).length === 0 ? (
                  <div className="col-span-full rounded-2xl border-2 border-amber-100 bg-amber-50/80 p-5 text-center dark:border-amber-900/40 dark:bg-amber-950/30 md:col-span-2">
                    <p className="text-sm font-black uppercase text-amber-900 dark:text-amber-200">No surveys available</p>
                    <p className="mt-2 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                      You do not have survey tasks on this project.
                    </p>
                  </div>
                ) : (
                  SURVEY_MODAL_ITEMS.filter((item) => technicianAllowedForModal.includes(item.type)).map((item) => (
                    (() => {
                      const isCompleted = isSurveyCompletedForSelectedRecord(item.type);
                      return (
                        <button
                          key={item.type}
                          type="button"
                          onClick={() => {
                            if (isCompleted) return;
                            proceedToSurvey(item.type);
                          }}
                          disabled={isCompleted}
                          className={`group flex w-full items-center justify-between rounded-xl border p-3.5 shadow-sm transition-all dark:bg-slate-800/80 md:p-4 ${
                            isCompleted
                              ? 'cursor-not-allowed border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : 'active:scale-[0.99] border-blue-900/15 bg-white text-blue-900 hover:border-blue-900 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-2 text-left">
                            <p className="text-sm font-black uppercase leading-tight md:text-base">{item.label}</p>
                            <p className={`mt-0.5 text-[10px] font-bold ${isCompleted ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                              {isCompleted ? 'Completed audit' : item.desc}
                            </p>
                          </div>
                          <i
                            className={`fas ${isCompleted ? 'fa-check-circle' : item.icon} shrink-0 text-xl transition-opacity md:text-2xl ${
                              isCompleted ? 'opacity-70' : 'opacity-10 group-hover:opacity-30'
                            }`}
                            aria-hidden="true"
                          ></i>
                        </button>
                      );
                    })()
                  ))
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-center dark:border-slate-700 dark:bg-slate-950 md:px-5">
              <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={proceedToSurveyCompleted}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 transition hover:text-blue-900 dark:hover:text-blue-300"
              >
                Proceed To Survey Completed
              </button>
              <button
                type="button"
                onClick={() => setShowSystemModal(false)}
                className="mt-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 transition hover:text-blue-900 dark:hover:text-blue-300"
              >
                Cancel Selection
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scale-up {
          animation: scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes scaleUp {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.2s ease-in-out 0s 2; }
      `}</style>
    </>
  );
};

export default Dashboard;