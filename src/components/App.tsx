import React, { useState, useEffect, useRef } from 'react';
import { User, Project, SurveyType, EstimationDetail, CCTVSurveyData, FireAlarmSurveyData, AccessControlSurveyData, BurglarAlarmSurveyData, FireProtectionSurveyData, OtherSurveyData, ChatMessage } from '../types';
import Login from './Login';
import AdminLogin from './AdminLogin';
import Signup from './Signup';
import Dashboard from './Dashboard';
import CurrentProjects from './CurrentProjects';
import ProjectDetails from './ProjectDetails';
import CCTVSurvey from './CCTVSurvey';
import FireAlarmSurvey from './FireAlarmSurvey';
import FireProtectionSurvey from './FireProtectionSurvey';
import AccessControlSurvey from './AccessControlSurvey';
import BurglarAlarmSurvey from './BurglarAlarmSurvey';
import OtherSurvey from './OtherSurvey';
import IntercomServiceSurveyForm from './intercomServiceSurvey/IntercomServiceSurveyForm';
import AIClarification from './AIClarification';
import EstimationScreen from './EstimationScreen';
import SurveySummary from './SurveySummary';
import { createFinalizedReportPdfBlob } from '../utils/finalizedReportPdf';
import Profile, { THEME_KEY, ThemeMode, COMPACT_MODE_KEY } from './Profile';
import PortalLayout, { type PortalNavKey } from './PortalLayout';
import { AA2000_LOGO } from '../constants';
import { toSummaryViewByRole } from '../services/summaryAccess';
import { technicianSurveyTasks } from '../utils/projectSurveyVisibility';
import {
  notifyAdminsTechnicianCompleted,
  notifyAdminsProjectReadyForFinalization,
  notifyAdminsFinalizationConfirmation,
  notifyTechniciansAssigned,
  notifyTechniciansProjectFinalized,
  type InAppNotification,
} from '../utils/inAppNotifications';

export type ProjectSortMode = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

/**
 * APPLICATION WORKFLOW SCREENS
 * Defines the logical UI states the user can traverse.
 * ROLE_SELECTION -> LOGIN/SIGNUP -> DASHBOARD -> (Workflow Loop below)
 * TECHNICIAN: PROJECT_DETAILS -> SURVEY -> AI -> ESTIMATION -> SUMMARY (mark done -> Completed).
 * SALES/ADMIN: ... -> ESTIMATION -> SUMMARY (billing + finalize / remarks).
 */
type Screen =
  | 'ROLE_SELECTION'
  | 'START'
  | 'LOGIN'
  | 'ADMIN_LOGIN'
  | 'SIGNUP'
  | 'DASHBOARD'
  | 'PROFILE'
  | 'CURRENT_PROJECTS'
  | 'PROJECT_DETAILS'
  | 'CCTV_SURVEY'
  | 'FA_SURVEY'
  | 'FP_SURVEY'
  | 'AC_SURVEY'
  | 'BA_SURVEY'
  | 'OTHER_SURVEY'
  | 'INTERCOM_SERVICE_SURVEY'
  | 'AI_CLARIFICATION'
  | 'ESTIMATION'
  | 'SUMMARY';

/** URL path for each screen (used for address bar and back/forward). */
const SCREEN_TO_PATH: Record<Screen, string> = {
  ROLE_SELECTION: '/',
  START: '/start',
  LOGIN: '/login',
  ADMIN_LOGIN: '/admin-login',
  SIGNUP: '/signup',
  DASHBOARD: '/dashboard',
  PROFILE: '/profile',
  CURRENT_PROJECTS: '/projects',
  PROJECT_DETAILS: '/project-details',
  CCTV_SURVEY: '/survey/cctv',
  FA_SURVEY: '/survey/fire-alarm',
  FP_SURVEY: '/survey/fire-protection',
  AC_SURVEY: '/survey/access-control',
  BA_SURVEY: '/survey/burglar-alarm',
  OTHER_SURVEY: '/survey/other',
  INTERCOM_SERVICE_SURVEY: '/survey/intercom-service',
  AI_CLARIFICATION: '/survey/clarification',
  ESTIMATION: '/survey/estimation',
  SUMMARY: '/summary',
};

const PATH_TO_SCREEN: Record<string, Screen> = Object.fromEntries(
  (Object.entries(SCREEN_TO_PATH) as [Screen, string][]).map(([s, p]) => [p, s])
);

function pathnameToScreen(pathname: string): Screen {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return PATH_TO_SCREEN[normalized] ?? 'ROLE_SELECTION';
}

/** Screens that require an authenticated user; direct URL access without login shows auth notice. */
const PROTECTED_SCREENS: Screen[] = [
  'DASHBOARD', 'PROFILE', 'CURRENT_PROJECTS', 'PROJECT_DETAILS',
  'CCTV_SURVEY', 'FA_SURVEY', 'FP_SURVEY', 'AC_SURVEY', 'BA_SURVEY', 'OTHER_SURVEY',
  'INTERCOM_SERVICE_SURVEY',
  'AI_CLARIFICATION', 'ESTIMATION', 'SUMMARY',
];

/**
 * ROOT APPLICATION COMPONENT
 * Purpose: Manages global survey state, user authentication session, 
 * and handles top-level routing based on the 'screen' state.
 */
const App: React.FC = () => {
  // --- SESSION & USER STATE --- (initial screen from URL so direct /login etc. works)
  const [screen, setScreen] = useState<Screen>(() =>
    typeof window !== 'undefined' ? pathnameToScreen(window.location.pathname || '/') : 'ROLE_SELECTION'
  );
  const [userRole, setUserRole] = useState<'TECHNICIAN' | 'ADMIN' | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === 'light' || t === 'dark') return t;
      return 'dark';
    } catch {
      return 'dark';
    }
  });

  const [compactMode, setCompactMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(COMPACT_MODE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [workspaceSection, setWorkspaceSection] = useState<'ONGOING' | 'UPCOMING' | 'HISTORY'>('ONGOING');
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>('newest');
  const [openSurveyPickerOnProjectDetails, setOpenSurveyPickerOnProjectDetails] = useState(false);
  const [dashboardSystemModalTarget, setDashboardSystemModalTarget] = useState<{
    projectId: string;
    timestamp?: string;
    nonce: number;
  } | null>(null);

  // --- PROJECT BUFFERS ---
  // These states act as temporary containers for a survey currently "in-flight".
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [surveyType, setSurveyType] = useState<SurveyType | null>(null);

  // SYSTEM-SPECIFIC AUDIT BUFFERS
  const [cctvData, setCctvData] = useState<CCTVSurveyData | null>(null);
  const [faData, setFaData] = useState<FireAlarmSurveyData | null>(null);
  const [fpData, setFpData] = useState<FireProtectionSurveyData | null>(null);
  const [acData, setAcData] = useState<AccessControlSurveyData | null>(null);
  const [baData, setBaData] = useState<BurglarAlarmSurveyData | null>(null);
  const [otherData, setOtherData] = useState<OtherSurveyData | null>(null);

  // AI CHAT STATE
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pendingClarifications, setPendingClarifications] = useState<string[]>([]);
  const [chatInitialized, setChatInitialized] = useState(false);
  const [auditNarrative, setAuditNarrative] = useState('');

  // --- OFFLINE NEXA CALIBRATION (trainable heuristics) ---
  const NEXA_CALIBRATION_KEY = 'aa2000_nexa_calibration_v1';
  type NexaCalibrationEntry = {
    ts: string;
    surveyType: SurveyType;
    unitCount: number;
    days: number;
    techs: number;
  };

  const getUnitCountForSurvey = (t: SurveyType): number => {
    try {
      switch (t) {
        case SurveyType.CCTV:
          return cctvData?.cameras?.length ?? 0;
        case SurveyType.FIRE_ALARM: {
          const detectors = (faData?.detectionAreas ?? []).reduce((sum, area) => {
            return sum + (area.devices ?? []).reduce((s, d) => s + (Number(d.count) || 0), 0);
          }, 0);
          const notif = Number(faData?.notification?.deviceCount) || 0;
          const mcp = Number(faData?.notification?.mcpCount) || 0;
          return detectors + notif + mcp;
        }
        case SurveyType.ACCESS_CONTROL:
          return acData?.doors?.length ?? 0;
        case SurveyType.BURGLAR_ALARM: {
          const sensors = (baData?.sensors ?? []).reduce((sum, s) => sum + (Number(s.count) || 0), 0);
          const sirens = (Number(baData?.notification?.sirenIndoor) || 0) + (Number(baData?.notification?.sirenOutdoor) || 0);
          const keypads = Number(baData?.controlPanel?.keypads) || 0;
          return sensors + sirens + keypads;
        }
        case SurveyType.FIRE_PROTECTION: {
          const alarmCore =
            (Number(fpData?.alarmCore?.smokeCount) || 0) +
            (Number(fpData?.alarmCore?.heatCount) || 0) +
            (Number(fpData?.alarmCore?.mcpCount) || 0) +
            (Number(fpData?.alarmCore?.notifCount) || 0);
          const suppression = Number((fpData as any)?.suppression?.qty) || 0;
          const sprinkler = Number((fpData as any)?.sprinkler?.qty) || 0;
          const portable = Number((fpData as any)?.portable?.qty) || 0;
          return alarmCore + suppression + sprinkler + portable;
        }
        case SurveyType.OTHER:
        default:
          return Number((otherData as any)?.unitCount) || 0;
      }
    } catch {
      return 0;
    }
  };

  const saveNexaCalibration = (t: SurveyType, unitCount: number, est: EstimationDetail) => {
    if (!unitCount || unitCount <= 0) return;
    const days = Number(est.days) || 0;
    const techs = Number(est.techs) || 0;
    if (days <= 0 || techs <= 0) return;
    try {
      const raw = localStorage.getItem(NEXA_CALIBRATION_KEY);
      const parsed: NexaCalibrationEntry[] = raw ? JSON.parse(raw) : [];
      const next: NexaCalibrationEntry[] = [
        ...parsed,
        { ts: new Date().toISOString(), surveyType: t, unitCount, days, techs },
      ].slice(-50); // keep last 50 calibrations
      localStorage.setItem(NEXA_CALIBRATION_KEY, JSON.stringify(next));
    } catch {
      // ignore calibration write errors
    }
  };

  // ESTIMATION ACCUMULATOR
  // Logic: Stores estimations per survey type to allow projects with multiple systems (e.g. CCTV + Fire).
  const [estimations, setEstimations] = useState<Record<string, EstimationDetail>>({});

  // EDITING CONTEXT
  const [selectedHistoricalProject, setSelectedHistoricalProject] = useState<any>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const fromPopStateRef = useRef(false);
  const replaceStateRef = useRef(false);
  const finalizedBackfillSyncRef = useRef(false);
  const ESTIMATION_UPLOAD_SYNC_KEY = 'aa2000_estimation_upload_sync_v1';

  /**
   * INIT + URL: Ensure dev technician exists; if user has session and is on /, redirect to /dashboard.
   */
  useEffect(() => {
    const pathname = window.location.pathname || '/';

    const techniciansRaw = localStorage.getItem('aa2000_technicians');
    const technicians: any[] = techniciansRaw ? JSON.parse(techniciansRaw) : [];
    const devEmail = '17charlesnicomedes@gmail.com';
    const devExists = technicians.some((t: any) => t.email.toLowerCase() === devEmail.toLowerCase());
    if (!devExists) {
      technicians.push({ fullName: 'Developer', email: devEmail, password: '123123', role: 'Field Technician' });
      localStorage.setItem('aa2000_technicians', JSON.stringify(technicians));
    }

    const savedUser = localStorage.getItem('aa2000_user');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      const savedRole = localStorage.getItem('aa2000_userRole');
      const normalizedRole = savedRole === 'ADMIN' ? 'ADMIN' : 'TECHNICIAN';

      setUser(parsedUser);
      setUserRole(normalizedRole);

      if (pathname === '/' || pathname === '') {
        replaceStateRef.current = true;
        setScreen('DASHBOARD');
      }
    }
  }, []);

  /**
   * BROWSER BACK/FORWARD: When user clicks back/forward, update screen from URL.
   */
  useEffect(() => {
    const onPopState = () => {
      fromPopStateRef.current = true;
      setScreen(pathnameToScreen(window.location.pathname || '/'));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /**
   * SCREEN → URL: When screen changes (user navigation), update the address bar.
   */
  useEffect(() => {
    if (fromPopStateRef.current) {
      fromPopStateRef.current = false;
      return;
    }
    const path = SCREEN_TO_PATH[screen];
    const current = (window.location.pathname || '/').replace(/\/$/, '') || '/';
    if (current === path) return;
    if (replaceStateRef.current) {
      replaceStateRef.current = false;
      window.history.replaceState(null, '', path);
    } else {
      window.history.pushState(null, '', path);
    }
  }, [screen]);

  /**
   * NAVIGATION EFFECT
   * Logic: Resets the window scroll position whenever the active screen changes
   * to ensure new views always start from the top.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  /** Sales/Admin only: finalized reports route. */
  useEffect(() => {
    if (screen !== 'CURRENT_PROJECTS' || !user) return;
    if (userRole === 'TECHNICIAN') {
      replaceStateRef.current = true;
      setScreen('DASHBOARD');
    }
  }, [screen, user, userRole]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#020617' : '#2563eb');
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(COMPACT_MODE_KEY, compactMode ? '1' : '0');
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle('compact-ui', compactMode);
  }, [compactMode]);

  /**
   * AUTHENTICATION HANDLERS
   * Purpose: Transitions the app from guest to authenticated state.
   * Input: Valid user object from the Login component.
   */
  const handleLogin = (u: User) => {
    setUser(u);
    setUserRole('TECHNICIAN');
    localStorage.setItem('aa2000_user', JSON.stringify(u));
    localStorage.setItem('aa2000_userRole', 'TECHNICIAN');
    setScreen('DASHBOARD');
  };

  const handleAdminLogin = (u: User) => {
    setUser(u);
    setUserRole('ADMIN');
    localStorage.setItem('aa2000_user', JSON.stringify(u));
    localStorage.setItem('aa2000_userRole', 'ADMIN');
    // Admin should be able to create new projects from the same dashboard UI.
    setScreen('DASHBOARD');
  };

  const handleLogout = () => {
    setUser(null);
    setUserRole(null);
    localStorage.removeItem('aa2000_user');
    localStorage.removeItem('aa2000_userRole');
    setScreen('ROLE_SELECTION');
  };

  const handlePortalNavigate = (key: PortalNavKey) => {
    switch (key) {
      case 'ongoing':
        setWorkspaceSection('ONGOING');
        setScreen('DASHBOARD');
        break;
      case 'upcoming':
        setWorkspaceSection('UPCOMING');
        setScreen('DASHBOARD');
        break;
      case 'history':
        setWorkspaceSection('HISTORY');
        setScreen('DASHBOARD');
        break;
      case 'create':
        resetSurveyBuffers();
        setScreen('PROJECT_DETAILS');
        break;
      case 'finalized':
        setScreen('CURRENT_PROJECTS');
        break;
      default:
        break;
    }
  };

  /**
   * PROJECT INITIALIZATION
   * Purpose: Sets the context for a new survey project (client name, location, etc.).
   */
  const startProject = (p: Project) => {
    setActiveProject(p);
  };

  const resetSurveyBuffers = () => {
    setActiveProject(null);
    setCctvData(null);
    setFaData(null);
    setFpData(null);
    setAcData(null);
    setBaData(null);
    setOtherData(null);
    setChatMessages([]);
    setPendingClarifications([]);
    setChatInitialized(false);
    setAuditNarrative('');
    setEstimations({});
    setEditingIndex(null);
  };

  const handleCreateProjectSetup = (p: Project) => {
    const savedRaw = localStorage.getItem('aa2000_saved_projects');
    const saved = savedRaw ? JSON.parse(savedRaw) : [];
    const normalizedProject: Project = {
      ...p,
      status: 'In Progress',
      completedAt: undefined,
      completedBy: undefined,
      finalization: undefined,
      finalizationAuditTrail: undefined,
    };
    const newRecord = {
      project: normalizedProject,
      cctvData: null,
      faData: null,
      fpData: null,
      acData: null,
      baData: null,
      otherData: null,
      estimations: {},
      timestamp: new Date().toISOString(),
    };
    saved.push(newRecord);
    safeSetSavedProjects(saved);
    notifyTechniciansAssigned(normalizedProject);
    resetSurveyBuffers();
    setScreen('DASHBOARD');
  };

  /**
   * SURVEY ROUTING
   * Logic: Redirects the user to the specific technical audit form based on their selection.
   * Input: enum SurveyType.
   */
  const handleSurveySelection = (type: SurveyType) => {
    setOpenSurveyPickerOnProjectDetails(false);
    setSurveyType(type);
    if (type === SurveyType.CCTV) setScreen('CCTV_SURVEY');
    else if (type === SurveyType.FIRE_ALARM) setScreen('FA_SURVEY');
    else if (type === SurveyType.FIRE_PROTECTION) setScreen('FP_SURVEY');
    else if (type === SurveyType.ACCESS_CONTROL) setScreen('AC_SURVEY');
    else if (type === SurveyType.BURGLAR_ALARM) setScreen('BA_SURVEY');
    else setScreen('OTHER_SURVEY');
  };

  const continueToSurveyFromEstimation = (
    target: SurveyType,
    curEst: EstimationDetail,
    targetScreen: Screen
  ) => {
    saveNexaCalibration(surveyType!, getUnitCountForSurvey(surveyType!), curEst);
    setEstimations((prev) => ({ ...prev, [surveyType!]: curEst }));
    if (userRole === 'TECHNICIAN') {
      const allowed = technicianSurveyTasks(activeProject, user?.email || '');
      if (!allowed.includes(target)) {
        window.alert('You can only open survey systems assigned to you on this project.');
        return;
      }
    }
    setSurveyType(target);
    setScreen(targetScreen);
  };

  const captureProjectBuildingInfoFromSurvey = (
    surveyBuildingInfo:
      | CCTVSurveyData['buildingInfo']
      | FireAlarmSurveyData['buildingInfo']
      | FireProtectionSurveyData['buildingInfo']
      | AccessControlSurveyData['buildingInfo']
      | BurglarAlarmSurveyData['buildingInfo']
      | OtherSurveyData['buildingInfo']
      | undefined
  ) => {
    if (!surveyBuildingInfo) return;
    const isValid =
      !!surveyBuildingInfo.type &&
      (surveyBuildingInfo.type !== 'Other' || !!surveyBuildingInfo.otherType?.trim()) &&
      Number(surveyBuildingInfo.floors) > 0;
    if (!isValid) return;
    setActiveProject((prev) => {
      if (!prev) return prev;
      if (prev.buildingInfo && prev.buildingInfo.type && Number(prev.buildingInfo.floors) > 0) {
        return prev;
      }
      return { ...prev, buildingInfo: surveyBuildingInfo };
    });
  };

  const isProjectEditLocked = (status?: Project['status']): boolean =>
    status === 'Finalized' || status === 'Finalized - Approved';

  /** Load a project from the list into state and open the given survey for editing. */
  const handleEditAuditFromList = (projectRecord: any, index: number, surveyType: SurveyType) => {
    if (isProjectEditLocked(projectRecord?.project?.status)) {
      window.alert('This project is finalized and approved. Editing is locked.');
      return;
    }
    handleEditProject(projectRecord, index);
    setSurveyType(surveyType);
    const screenMap: Record<SurveyType, Screen> = {
      [SurveyType.CCTV]: 'CCTV_SURVEY',
      [SurveyType.FIRE_ALARM]: 'FA_SURVEY',
      [SurveyType.FIRE_PROTECTION]: 'FP_SURVEY',
      [SurveyType.ACCESS_CONTROL]: 'AC_SURVEY',
      [SurveyType.BURGLAR_ALARM]: 'BA_SURVEY',
      [SurveyType.OTHER]: 'OTHER_SURVEY',
    };
    setScreen(screenMap[surveyType]);
  };

  /**
   * FLOOR PLAN RESET LOGIC
   * Purpose: Clears all previous AI analysis, chat memory, and extracted data
   * when a new floor plan is uploaded.
   */
  const handleNewFloorPlan = () => {
    setChatMessages([
      {
        id: 'reset-msg-' + Date.now(),
        role: 'assistant',
        text: 'Previous floor plan data cleared. New floor plan detected. Starting fresh analysis...',
        timestamp: new Date()
      }
    ]);
    setPendingClarifications([]);
    setChatInitialized(false);
    setAuditNarrative('');
  };

  /**
   * PROJECT EDITING LOGIC
   * Logic: Populates all project and audit buffers from a historical record 
   * to allow modifications to an existing report.
   * @param item - The serialized project record from history.
   * @param index - Array index for updating in localStorage later.
   */
  const handleEditProject = (item: any, index: number, openScreen: Screen = 'PROJECT_DETAILS') => {
    if (openScreen !== 'SUMMARY' && isProjectEditLocked(item?.project?.status)) {
      window.alert('This project is finalized and approved. Editing is locked.');
      setSelectedHistoricalProject(item);
      setEditingIndex(index);
      setScreen('SUMMARY');
      return;
    }
    setActiveProject(item.project);
    setCctvData(item.cctvData);
    setFaData(item.faData);
    setFpData(item.fpData);
    setAcData(item.acData);
    setBaData(item.baData);
    setOtherData(item.otherData);

    // Legacy support for older project formats
    if (item.estimations) {
      setEstimations(item.estimations);
    } else if (item.estimationData) {
      const typeKey = item.cctvData ? SurveyType.CCTV : (item.faData ? SurveyType.FIRE_ALARM : SurveyType.OTHER);
      setEstimations({ [typeKey]: item.estimationData });
    } else {
      setEstimations({});
    }

    if (item.cctvData) setSurveyType(SurveyType.CCTV);
    else if (item.faData) setSurveyType(SurveyType.FIRE_ALARM);
    else if (item.fpData) setSurveyType(SurveyType.FIRE_PROTECTION);
    else if (item.acData) setSurveyType(SurveyType.ACCESS_CONTROL);
    else if (item.baData) setSurveyType(SurveyType.BURGLAR_ALARM);
    else setSurveyType(SurveyType.OTHER);

    setEditingIndex(index);
    if (openScreen === 'SUMMARY') {
      setSelectedHistoricalProject(item);
    }
    setScreen(openScreen);
  };

  /** Resolve saved-project row by `project.id` (latest timestamp wins). */
  const findSavedRecordByProjectId = (projectId: string): { record: any; index: number } | null => {
    try {
      const raw = localStorage.getItem('aa2000_saved_projects');
      if (!raw) return null;
      const saved = JSON.parse(raw) as any[];
      const matches = saved
        .map((record, index) => ({ record, index }))
        .filter(({ record }) => record?.project?.id === projectId);
      if (!matches.length) return null;
      matches.sort(
        (a, b) => new Date(b.record.timestamp || 0).getTime() - new Date(a.record.timestamp || 0).getTime()
      );
      return matches[0];
    } catch {
      return null;
    }
  };

  /**
   * Notification bell: open project details or approval/summary view from stored `projectId` + `kind`, by role.
   */
  const handleNotificationNavigate = (n: InAppNotification) => {
    const found = findSavedRecordByProjectId(n.projectId);
    if (!found) {
      window.alert('This project could not be found. It may have been removed from this device.');
      return;
    }
    const { record, index } = found;

    const openProjectDetails = () => handleEditProject(record, index, 'PROJECT_DETAILS');
    const openApprovalSummary = () => handleEditProject(record, index, 'SUMMARY');
    const projectStatus = record?.project?.status as Project['status'] | undefined;
    if (isProjectEditLocked(projectStatus)) {
      openApprovalSummary();
      return;
    }

    if (userRole === 'TECHNICIAN') {
      if (n.kind === 'TECH_FINALIZATION') openApprovalSummary();
      else openProjectDetails();
      return;
    }

    if (userRole === 'ADMIN') {
      switch (n.kind) {
        case 'ADMIN_FINALIZATION_CONFIRMATION':
        case 'ADMIN_FINALIZATION_REQUEST':
        case 'ADMIN_TECH_COMPLETED':
          openApprovalSummary();
          break;
        case 'ADMIN_TECH_RESPONSE':
        default:
          openProjectDetails();
          break;
      }
    }
  };

  const uploadApprovedEstimationFiles = async (record: any) => {
    const uploadPath = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ESTIMATION_UPLOAD_PATH)
      ? String(import.meta.env.VITE_ESTIMATION_UPLOAD_PATH).trim()
      : '';
    const normalizedPath = uploadPath ? `/${uploadPath.replace(/^\/+/, '')}` : '/service/estimation/post/upload/estimationFile';

    // Only use RELATIVE URLs so requests go through the Vite dev proxy (avoids CORS).
    // The proxy in vite.config.ts forwards /upload, /service, and /api to the correct backends.
    const candidateUrls = [
      '/service/estimation/post/upload/estimationFile',
      normalizedPath,
      '/upload/estimationFile',
      '/service/estimation/upload/estimationFile',
      '/api/estimation/upload',
    ];

    const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_KEY)
      ? String(import.meta.env.VITE_API_KEY)
      : '';
    const estimationEntries = Object.entries(record?.estimations || {}) as [SurveyType, EstimationDetail][];
    if (!estimationEntries.length) return [];

    const blob = await createFinalizedReportPdfBlob(record);
    if (!blob) return [];
    const primarySurveyType = estimationEntries[0][0];
    const fileName = `finalized_${record.project?.id || 'project'}.pdf`;
    const uploadFile = new File([blob], fileName, {
      type: 'application/pdf',
    });

    const headers: Record<string, string> = { 'X-Viewer-Role': 'ADMIN' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const doUploadOnce = async (targetUrl: string, fileField: string) => {
      const formData = new FormData();
      formData.append(fileField, uploadFile);
      formData.append('viewerRole', 'ADMIN');
      if (record?.project?.id) {
        formData.append('projectId', String(record.project.id));
      }
      if (primarySurveyType) {
        formData.append('surveyType', String(primarySurveyType));
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      try {
        return await fetch(targetUrl, {
          method: 'POST',
          body: formData,
          headers,
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
    };

    let res: Response | null = null;
    const uploadErrors: string[] = [];
    const fileFieldCandidates: Array<string> = ['estimationDoc', 'estimationFile', 'file'];
    for (const targetUrl of candidateUrls) {
      for (const fileField of fileFieldCandidates) {
        try {
          res = await doUploadOnce(targetUrl, fileField);
        } catch (firstErr) {
          // Retry once for transient network failures before trying next URL.
          try {
            res = await doUploadOnce(targetUrl, fileField);
          } catch (secondErr) {
            const message = (secondErr as Error)?.name === 'AbortError'
              ? `Timeout (20s): ${targetUrl}`
              : `Network failure at ${targetUrl}: ${String((secondErr as Error)?.message || secondErr)}`;
            uploadErrors.push(message);
            continue;
          }
        }
        if (res.ok) break;
        const errorBody = await res.text().catch(() => '');
        uploadErrors.push(`HTTP ${res.status} at ${targetUrl}${errorBody ? ` - ${errorBody}` : ''}`);
        res = null;
      }
      if (res?.ok) {
        break;
      }
    }

    if (!res) {
      throw new Error(`PDF upload failed. Tried: ${candidateUrls.join(' , ')}. Details: ${uploadErrors.join(' | ')}`);
    }
    const payload = await res.json().catch(() => ({} as any));
    const uploadedFiles: Array<{ surveyType: SurveyType; fileName: string; filePath?: string; uploadedAt: string }> = [{
      surveyType: primarySurveyType,
      fileName: String(payload?.fileName || fileName),
      filePath: payload?.filePath ? String(payload.filePath) : undefined,
      uploadedAt: new Date().toISOString(),
    }];
    return uploadedFiles;
  };

  const readUploadSyncMap = (): Record<string, string> => {
    try {
      const raw = localStorage.getItem(ESTIMATION_UPLOAD_SYNC_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  const writeUploadSyncMap = (map: Record<string, string>) => {
    try {
      localStorage.setItem(ESTIMATION_UPLOAD_SYNC_KEY, JSON.stringify(map));
    } catch {
      /* ignore storage errors */
    }
  };

  const buildUploadSyncKey = (record: any): string => {
    const projectId = String(record?.project?.id || 'unknown');
    const timestamp = String(record?.timestamp || '');
    const finalizedAt = String(record?.project?.finalization?.actedAt || '');
    return `${projectId}::${timestamp}::${finalizedAt}`;
  };

  /** Backfill: upload existing approved finalized estimations for Sales/Admin Finalized Reports. */
  const backfillApprovedFinalizedEstimations = async () => {
    if (finalizedBackfillSyncRef.current) return;
    finalizedBackfillSyncRef.current = true;
    try {
      const raw = localStorage.getItem('aa2000_saved_projects');
      const saved = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(saved) || !saved.length) return;

      const syncMap = readUploadSyncMap();
      let changed = false;
      for (const record of saved) {
        const status = record?.project?.status as Project['status'] | undefined;
        const isApprovedFinal = status === 'Finalized' || status === 'Finalized - Approved';
        const hasEstimations = !!record?.estimations && Object.keys(record.estimations).length > 0;
        if (!isApprovedFinal || !hasEstimations) continue;

        const syncKey = buildUploadSyncKey(record);
        if (syncMap[syncKey]) continue;

        try {
          const uploaded = await uploadApprovedEstimationFiles(record);
          if (uploaded.length) {
            record.estimationUploads = uploaded;
            changed = true;
          }
          syncMap[syncKey] = new Date().toISOString();
          writeUploadSyncMap(syncMap);
        } catch (err) {
          console.error('Failed to backfill upload finalized estimation file(s):', err);
        }
      }
      if (changed) {
        safeSetSavedProjects(saved);
      }
    } finally {
      finalizedBackfillSyncRef.current = false;
    }
  };

  useEffect(() => {
    if (screen !== 'CURRENT_PROJECTS' || userRole !== 'ADMIN') return;
    void backfillApprovedFinalizedEstimations();
  }, [screen, userRole]);

  /** Resolve storage row index for the project being edited or viewed. */
  const resolveStorageIndex = (fallbackRecord?: { project?: Project; timestamp?: string } | null): number | null => {
    if (editingIndex !== null) return editingIndex;
    const savedProjectsRaw = localStorage.getItem('aa2000_saved_projects');
    if (!savedProjectsRaw) return null;
    const savedProjects = JSON.parse(savedProjectsRaw) as any[];
    const id = fallbackRecord?.project?.id ?? activeProject?.id;
    const ts = fallbackRecord?.timestamp;
    if (!id) return null;
    const idx = savedProjects.findIndex(
      (p: any) => p.project?.id === id && (!ts || p.timestamp === ts)
    );
    return idx >= 0 ? idx : null;
  };

  const buildSavedRecord = (mergedEstimations: Record<string, EstimationDetail>, existing: any | null) => {
    const st = surveyType!;
    return {
      project: activeProject,
      cctvData: st === SurveyType.CCTV ? cctvData : (existing?.cctvData ?? null),
      faData: st === SurveyType.FIRE_ALARM ? faData : (existing?.faData ?? null),
      fpData: st === SurveyType.FIRE_PROTECTION ? fpData : (existing?.fpData ?? null),
      acData: st === SurveyType.ACCESS_CONTROL ? acData : (existing?.acData ?? null),
      baData: st === SurveyType.BURGLAR_ALARM ? baData : (existing?.baData ?? null),
      otherData: st === SurveyType.OTHER ? otherData : (existing?.otherData ?? null),
      estimations: mergedEstimations,
      timestamp: existing?.timestamp ?? new Date().toISOString(),
      remarks: existing?.remarks,
      techNotes: existing?.techNotes,
    };
  };

  const stripMeasurementImages = (measurements: any) => {
    if (!measurements || typeof measurements !== 'object') return measurements;
    const next = { ...measurements };
    delete next.planImage;
    delete next.planImages;
    return next;
  };

  const stripHeavyPlanDataFromRecord = (record: any) => {
    if (!record || typeof record !== 'object') return record;
    const trimSurvey = (surveyData: any) => {
      if (!surveyData || typeof surveyData !== 'object') return surveyData;
      const nextSurvey = { ...surveyData };
      if (nextSurvey.measurements) {
        nextSurvey.measurements = stripMeasurementImages(nextSurvey.measurements);
      }
      if (nextSurvey.buildingInfo?.measurements) {
        nextSurvey.buildingInfo = {
          ...nextSurvey.buildingInfo,
          measurements: stripMeasurementImages(nextSurvey.buildingInfo.measurements),
        };
      }
      return nextSurvey;
    };
    return {
      ...record,
      cctvData: trimSurvey(record.cctvData),
      faData: trimSurvey(record.faData),
      fpData: trimSurvey(record.fpData),
      acData: trimSurvey(record.acData),
      baData: trimSurvey(record.baData),
      otherData: trimSurvey(record.otherData),
    };
  };

  const safeSetSavedProjects = (savedProjects: any[]) => {
    const payload = JSON.stringify(savedProjects);
    try {
      localStorage.setItem('aa2000_saved_projects', payload);
      return savedProjects;
    } catch (err) {
      const isQuotaError =
        err instanceof DOMException &&
        (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
      if (!isQuotaError) throw err;
      const trimmed = savedProjects.map(stripHeavyPlanDataFromRecord);
      localStorage.setItem('aa2000_saved_projects', JSON.stringify(trimmed));
      return trimmed;
    }
  };

  /** Persists survey buffers + estimations; keeps prior systems and metadata when merging. */
  const persistMergedRecord = (mergedEstimations: Record<string, EstimationDetail>) => {
    const savedProjectsRaw = localStorage.getItem('aa2000_saved_projects');
    const savedProjects = savedProjectsRaw ? JSON.parse(savedProjectsRaw) : [];
    const idx = resolveStorageIndex(selectedHistoricalProject);
    const existing = idx !== null && savedProjects[idx] ? savedProjects[idx] : null;
    const newRecord = buildSavedRecord(mergedEstimations, existing);
    if (idx !== null) {
      savedProjects[idx] = newRecord;
      setEditingIndex(idx);
    } else {
      savedProjects.push(newRecord);
      setEditingIndex(savedProjects.length - 1);
    }
    const persisted = safeSetSavedProjects(savedProjects);
    const persistedRecord = idx !== null ? persisted[idx] : persisted[persisted.length - 1];
    setSelectedHistoricalProject(persistedRecord);
    setEstimations(mergedEstimations);
  };

  /**
   * FINALIZATION HANDLER (Sales/Admin estimation flow)
   * Persists financial + technical record and opens the summary.
   */
  const handleFinalize = (est: EstimationDetail) => {
    if (surveyType) {
      const units = getUnitCountForSurvey(surveyType);
      saveNexaCalibration(surveyType, units, est);
    }
    const finalEstimations = { ...estimations, [surveyType!]: est };
    persistMergedRecord(finalEstimations);
    setScreen('SUMMARY');
  };

  /**
   * DYNAMIC RENDERER
   * Logic: Switches the visible component based on 'screen' state. 
   * This implements a basic "state machine" router without external libraries.
   */
  const renderScreen = () => {
    // Auth gate: block protected pages when user is not logged in (e.g. direct URL access).
    if (PROTECTED_SCREENS.includes(screen) && !user) {
      return (
        <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in" aria-modal="true" role="dialog" aria-labelledby="auth-required-title">
          <div
            className="bg-white dark:bg-slate-900 dark:border dark:border-slate-700 rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="scale-110 origin-center">{AA2000_LOGO}</div>
            <div className="space-y-2">
              <h2 id="auth-required-title" className="text-xl font-bold text-slate-800 dark:text-slate-100">Authentication required</h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                You must log in or sign up first before you can access this page.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScreen('ROLE_SELECTION')}
              className="w-full py-3 bg-blue-900 text-white font-bold rounded-xl hover:bg-blue-800 transition"
            >
              Back
            </button>
          </div>
        </div>
      );
    }

    switch (screen) {
      case 'ROLE_SELECTION':
        return (
          <div className="flex flex-col items-center min-h-full h-full px-6 pt-14 pb-10 bg-white animate-fade-in overflow-y-auto overflow-x-hidden">
            <div className="text-center space-y-2 shrink-0">
              {AA2000_LOGO}
              <p className="text-blue-900 text-sm font-bold mt-2">Select your role to continue</p>
            </div>

            <div className="w-full max-w-lg mt-8 space-y-4">
              <button
                onClick={() => {
                  setUserRole('TECHNICIAN');
                  setScreen('START');
                }}
                className="w-full group p-5 bg-blue-900 rounded-2xl shadow-lg hover:bg-blue-800 transition-all active:scale-[0.98] text-white text-left flex items-center gap-4"
              >
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                  <i className="fas fa-tools text-xl"></i>
                </div>
                <div>
                  <p className="font-black text-sm">Technician</p>
                  <p className="text-blue-200 text-xs leading-tight">Conduct site surveys, fill audit forms, and submit reports</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUserRole('ADMIN');
                  setUser(null);
                  setScreen('ADMIN_LOGIN');
                }}
                className="w-full group p-5 bg-white border-2 border-blue-900 rounded-2xl shadow-sm hover:bg-blue-50 transition-all active:scale-[0.98] text-blue-900 text-left flex items-center gap-4"
              >
                <div className="w-12 h-12 bg-blue-900/10 rounded-xl flex items-center justify-center shrink-0">
                  <i className="fas fa-chart-bar text-xl"></i>
                </div>
                <div>
                  <p className="font-black text-sm">Sales &amp; Admin</p>
                  <p className="text-slate-500 text-xs leading-tight">Create projects, review reports, and finalize estimates</p>
                </div>
              </button>
            </div>

            <p className="text-slate-300 text-[10px] text-center font-bold uppercase tracking-widest mt-auto pt-10">
              AA2000 Security &amp; Technology Solutions
            </p>
          </div>
        );

      case 'START':
        return (
          <div className="flex flex-col items-center min-h-full h-full px-8 pt-20 pb-10 md:pt-28 md:pb-16 bg-white overflow-y-auto overflow-x-hidden">
            <div className="flex flex-col items-center space-y-12 w-full max-w-xs shrink-0">
              <div className="-mt-4 mb-4">
                <div className="scale-150 origin-center">
                  {AA2000_LOGO}
                </div>
              </div>
              <div className="w-full space-y-4">
                <button type="button" onClick={() => setScreen('LOGIN')} className="w-full py-4 bg-blue-900 text-white font-bold rounded-xl shadow-lg hover:bg-blue-800 transition">LOGIN</button>
                <button type="button" onClick={() => setScreen('SIGNUP')} className="w-full py-4 border-2 border-blue-900 text-blue-900 font-bold rounded-xl hover:bg-blue-50 transition">SIGN UP</button>
              </div>
              <button type="button" onClick={() => setScreen('ROLE_SELECTION')} className="text-slate-400 text-xs text-center font-black uppercase tracking-widest active:scale-95">
                <i className="fas fa-arrow-left mr-2"></i>Back to Role Selection
              </button>
            </div>
          </div>
        );

      case 'LOGIN':
        return <Login onBack={() => setScreen('START')} onLogin={handleLogin} />;

      case 'ADMIN_LOGIN':
        return <AdminLogin onBack={() => setScreen('ROLE_SELECTION')} onLogin={handleAdminLogin} />;

      case 'SIGNUP':
        return <Signup onBack={() => setScreen('START')} onSignupComplete={() => setScreen('LOGIN')} />;

      case 'DASHBOARD':
        return (
          <Dashboard
            user={user!}
            userRole={userRole}
            theme={theme}
            onThemeChange={setTheme}
            compactMode={compactMode}
            onCompactModeChange={setCompactMode}
            workspaceSection={workspaceSection}
            onPortalNavigate={handlePortalNavigate}
            onEditAuditFromList={handleEditAuditFromList}
            onOpenSummaryFromList={(projectRecord, index) => {
              setSelectedHistoricalProject(projectRecord);
              setEditingIndex(index);
              setScreen('SUMMARY');
            }}
            onNotificationNavigate={handleNotificationNavigate}
            onOpenProfile={() => setScreen('PROFILE')}
            onLogout={handleLogout}
            onOpenIntercomServiceSurvey={() => setScreen('INTERCOM_SERVICE_SURVEY')}
            projectSortMode={projectSortMode}
            onProjectSortModeChange={setProjectSortMode}
            openSystemModalTarget={dashboardSystemModalTarget}
            onOpenSystemModalTargetConsumed={() => setDashboardSystemModalTarget(null)}
          />
        );

      case 'INTERCOM_SERVICE_SURVEY':
        return <IntercomServiceSurveyForm onBack={() => setScreen('DASHBOARD')} />;

      case 'PROFILE':
        return (
          <Profile
            user={user!}
            userRole={userRole}
            theme={theme}
            onThemeChange={setTheme}
            compactMode={compactMode}
            onCompactModeChange={setCompactMode}
            onUserUpdate={setUser}
            onPortalNavigate={handlePortalNavigate}
            onNotificationNavigate={handleNotificationNavigate}
            onOpenProfile={() => setScreen('PROFILE')}
            onLogout={handleLogout}
          />
        );

      case 'CURRENT_PROJECTS':
        return (
          <CurrentProjects
            user={user}
            userRole={userRole}
            theme={theme}
            onThemeChange={setTheme}
            compactMode={compactMode}
            onCompactModeChange={setCompactMode}
            onPortalNavigate={handlePortalNavigate}
            onOpenProfile={() => setScreen('PROFILE')}
            onLogout={handleLogout}
            onGoToDashboardSection={
              userRole === 'ADMIN'
                ? (section) => {
                  setWorkspaceSection(section);
                  setScreen('DASHBOARD');
                }
                : undefined
            }
            onViewProject={(proj) => {
              setSelectedHistoricalProject(proj);
              const raw = localStorage.getItem('aa2000_saved_projects');
              if (raw) {
                const parsed = JSON.parse(raw);
                const i = parsed.findIndex(
                  (p: any) => p.project?.id === proj.project?.id && p.timestamp === proj.timestamp
                );
                if (i >= 0) setEditingIndex(i);
              }
              setScreen('SUMMARY');
            }}
            onEditProject={handleEditProject}
            onEditAuditFromList={handleEditAuditFromList}
            onNotificationNavigate={handleNotificationNavigate}
            projectSortMode={projectSortMode}
            onProjectSortModeChange={setProjectSortMode}
          />
        );

      case 'PROJECT_DETAILS': {
        const projectRecordForDetails = selectedHistoricalProject ?? {
          project: activeProject,
          cctvData,
          faData,
          fpData,
          acData,
          baData,
          otherData,
          estimations,
        };
        const completedSurveyTypes = (
          [
            projectRecordForDetails.cctvData && projectRecordForDetails.estimations?.[SurveyType.CCTV] ? SurveyType.CCTV : null,
            projectRecordForDetails.faData && projectRecordForDetails.estimations?.[SurveyType.FIRE_ALARM] ? SurveyType.FIRE_ALARM : null,
            projectRecordForDetails.fpData && projectRecordForDetails.estimations?.[SurveyType.FIRE_PROTECTION] ? SurveyType.FIRE_PROTECTION : null,
            projectRecordForDetails.acData && projectRecordForDetails.estimations?.[SurveyType.ACCESS_CONTROL] ? SurveyType.ACCESS_CONTROL : null,
            projectRecordForDetails.baData && projectRecordForDetails.estimations?.[SurveyType.BURGLAR_ALARM] ? SurveyType.BURGLAR_ALARM : null,
            projectRecordForDetails.otherData && projectRecordForDetails.estimations?.[SurveyType.OTHER] ? SurveyType.OTHER : null,
          ] as Array<SurveyType | null>
        ).filter((type): type is SurveyType => type !== null);
        const projectDetailsActiveNav: PortalNavKey =
          userRole === 'ADMIN'
            ? editingIndex !== null
              ? 'finalized'
              : 'create'
            : workspaceSection === 'ONGOING'
              ? 'ongoing'
              : workspaceSection === 'UPCOMING'
                ? 'upcoming'
                : 'history';
        const projectDetailsHeader =
          userRole === 'ADMIN' && editingIndex === null ? 'Create project' : 'Project details';

        return (
          <PortalLayout
            user={user!}
            userRole={userRole}
            theme={theme}
            onThemeChange={setTheme}
            compactMode={compactMode}
            onCompactModeChange={setCompactMode}
            activeNav={projectDetailsActiveNav}
            onNavigate={handlePortalNavigate}
            onOpenProfile={() => setScreen('PROFILE')}
            onLogout={handleLogout}
            headerTitle={projectDetailsHeader}
            onNotificationNavigate={handleNotificationNavigate}
          >
            <ProjectDetails
              user={user!}
              userRole={userRole}
              onBack={() => setScreen(editingIndex !== null ? 'CURRENT_PROJECTS' : 'DASHBOARD')}
              onStart={startProject}
              onSelectSurvey={handleSurveySelection}
              creationOnly={userRole === 'ADMIN'}
              onCreateProject={userRole === 'ADMIN' ? handleCreateProjectSetup : undefined}
              initialData={projectRecordForDetails.project || undefined}
              completedSurveyTypes={completedSurveyTypes}
              openSurveyModalOnMount={openSurveyPickerOnProjectDetails}
              onSurveyModalAutoOpened={() => setOpenSurveyPickerOnProjectDetails(false)}
            />
          </PortalLayout>
        );
      }

      case 'CCTV_SURVEY':
        return (
          <CCTVSurvey
            onBack={(draft) => { if (draft != null) setCctvData(draft); setScreen('PROJECT_DETAILS'); }}
            onComplete={(data) => { setCctvData(data); captureProjectBuildingInfoFromSurvey(data.buildingInfo); setScreen('AI_CLARIFICATION'); }}
            onNewFloorPlan={handleNewFloorPlan}
            initialData={cctvData || undefined}
            projectBuildingInfo={activeProject?.buildingInfo}
          />
        );

      case 'FA_SURVEY':
        return (
          <FireAlarmSurvey
            onBack={(draft) => { if (draft != null) setFaData(draft); setScreen('PROJECT_DETAILS'); }}
            onComplete={(data) => { setFaData(data); captureProjectBuildingInfoFromSurvey(data.buildingInfo); setScreen('AI_CLARIFICATION'); }}
            onNewFloorPlan={handleNewFloorPlan}
            initialData={faData || undefined}
            projectBuildingInfo={activeProject?.buildingInfo}
          />
        );

      case 'FP_SURVEY':
        return (
          <FireProtectionSurvey
            onBack={(draft) => { if (draft != null) setFpData(draft); setScreen('PROJECT_DETAILS'); }}
            onComplete={(data) => { setFpData(data); captureProjectBuildingInfoFromSurvey(data.buildingInfo); setScreen('AI_CLARIFICATION'); }}
            onNewFloorPlan={handleNewFloorPlan}
            initialData={fpData || undefined}
            projectBuildingInfo={activeProject?.buildingInfo}
          />
        );

      case 'AC_SURVEY':
        return (
          <AccessControlSurvey
            onBack={(draft) => { if (draft != null) setAcData(draft); setScreen('PROJECT_DETAILS'); }}
            onComplete={(data) => { setAcData(data); captureProjectBuildingInfoFromSurvey(data.buildingInfo); setScreen('AI_CLARIFICATION'); }}
            onNewFloorPlan={handleNewFloorPlan}
            initialData={acData || undefined}
            projectBuildingInfo={activeProject?.buildingInfo}
          />
        );

      case 'BA_SURVEY':
        return (
          <BurglarAlarmSurvey
            onBack={(draft) => { if (draft != null) setBaData(draft); setScreen('PROJECT_DETAILS'); }}
            onComplete={(data) => { setBaData(data); captureProjectBuildingInfoFromSurvey(data.buildingInfo); setScreen('AI_CLARIFICATION'); }}
            onNewFloorPlan={handleNewFloorPlan}
            initialData={baData || undefined}
            projectBuildingInfo={activeProject?.buildingInfo}
          />
        );

      case 'OTHER_SURVEY':
        return (
          <OtherSurvey
            onBack={(draft) => { if (draft != null) setOtherData(draft); setScreen('PROJECT_DETAILS'); }}
            onComplete={(data) => { setOtherData(data); captureProjectBuildingInfoFromSurvey(data.buildingInfo); setScreen('AI_CLARIFICATION'); }}
            onNewFloorPlan={handleNewFloorPlan}
            initialData={otherData || undefined}
            projectBuildingInfo={activeProject?.buildingInfo}
          />
        );

      case 'AI_CLARIFICATION':
        return (
          <AIClarification
            project={activeProject!}
            type={surveyType!}
            cctvData={cctvData}
            faData={faData}
            fpData={fpData}
            acData={acData}
            baData={baData}
            otherData={otherData}
            messages={chatMessages}
            setMessages={setChatMessages}
            pendingClarifications={pendingClarifications}
            setPendingClarifications={setPendingClarifications}
            initialized={chatInitialized}
            setInitialized={setChatInitialized}
            narrative={auditNarrative}
            setNarrative={setAuditNarrative}
            onComplete={({ narrative, suggestedEstimation }) => {
              setAuditNarrative(narrative);
              if (suggestedEstimation && surveyType) {
                setEstimations(prev => ({ ...prev, [surveyType]: suggestedEstimation }));
              }
              setScreen('ESTIMATION');
            }}
            onBack={() => {
              const prevMap: Record<string, Screen> = {
                [SurveyType.CCTV]: 'CCTV_SURVEY', [SurveyType.FIRE_ALARM]: 'FA_SURVEY', [SurveyType.FIRE_PROTECTION]: 'FP_SURVEY',
                [SurveyType.ACCESS_CONTROL]: 'AC_SURVEY', [SurveyType.BURGLAR_ALARM]: 'BA_SURVEY', [SurveyType.OTHER]: 'OTHER_SURVEY'
              };
              setScreen(prevMap[surveyType!] || 'PROJECT_DETAILS');
            }}
          />
        );

      case 'ESTIMATION':
        return (
          <EstimationScreen
            project={activeProject!}
            viewerRole={userRole}
            viewerEmail={user?.email}
            type={surveyType!}
            cctvData={cctvData}
            faData={faData}
            fpData={fpData}
            acData={acData}
            baData={baData}
            otherData={otherData}
            initialEstimation={estimations[surveyType!] || undefined}
            onComplete={handleFinalize}
            onContinueFA={(curEst) => continueToSurveyFromEstimation(SurveyType.FIRE_ALARM, curEst, 'FA_SURVEY')}
            onContinueFP={(curEst) => continueToSurveyFromEstimation(SurveyType.FIRE_PROTECTION, curEst, 'FP_SURVEY')}
            onContinueCCTV={(curEst) => continueToSurveyFromEstimation(SurveyType.CCTV, curEst, 'CCTV_SURVEY')}
            onContinueAC={(curEst) => continueToSurveyFromEstimation(SurveyType.ACCESS_CONTROL, curEst, 'AC_SURVEY')}
            onContinueBA={(curEst) => continueToSurveyFromEstimation(SurveyType.BURGLAR_ALARM, curEst, 'BA_SURVEY')}
            onContinueOther={(curEst) => continueToSurveyFromEstimation(SurveyType.OTHER, curEst, 'OTHER_SURVEY')}
            onBack={() => setScreen('AI_CLARIFICATION')}
          />
        );

      case 'SUMMARY':
        const dP = selectedHistoricalProject ? selectedHistoricalProject.project : activeProject;
        const dC = selectedHistoricalProject ? selectedHistoricalProject.cctvData : cctvData;
        const dF = selectedHistoricalProject ? selectedHistoricalProject.faData : faData;
        const dFP = selectedHistoricalProject ? selectedHistoricalProject.fpData : fpData;
        const dAC = selectedHistoricalProject ? selectedHistoricalProject.acData : acData;
        const dBA = selectedHistoricalProject ? selectedHistoricalProject.baData : baData;
        const dO = selectedHistoricalProject ? selectedHistoricalProject.otherData : otherData;
        const dE = selectedHistoricalProject ? selectedHistoricalProject.estimations : estimations;
        const summaryView =
          dP
            ? toSummaryViewByRole(
              {
                project: dP,
                cctvData: dC,
                faData: dF,
                fpData: dFP,
                acData: dAC,
                baData: dBA,
                otherData: dO,
                estimations: dE,
              },
              userRole
            )
            : null;

        if (!dP) {
          return (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-6 bg-white">
              <p className="text-slate-600 text-sm font-medium">No project selected.</p>
              <button
                onClick={() => setScreen(userRole === 'ADMIN' ? 'CURRENT_PROJECTS' : 'DASHBOARD')}
                className="px-4 py-2 bg-blue-900 text-white text-xs font-bold rounded-xl"
              >
                Go back
              </button>
            </div>
          );
        }

        const surveyTypeToKey: Record<SurveyType, string> = {
          [SurveyType.CCTV]: 'cctvData',
          [SurveyType.FIRE_ALARM]: 'faData',
          [SurveyType.FIRE_PROTECTION]: 'fpData',
          [SurveyType.ACCESS_CONTROL]: 'acData',
          [SurveyType.BURGLAR_ALARM]: 'baData',
          [SurveyType.OTHER]: 'otherData',
        };

        const handleDeleteSurvey = (type: SurveyType) => {
          if (type === SurveyType.CCTV) setCctvData(null);
          else if (type === SurveyType.FIRE_ALARM) setFaData(null);
          else if (type === SurveyType.FIRE_PROTECTION) setFpData(null);
          else if (type === SurveyType.ACCESS_CONTROL) setAcData(null);
          else if (type === SurveyType.BURGLAR_ALARM) setBaData(null);
          else if (type === SurveyType.OTHER) setOtherData(null);
          setEstimations((prev) => {
            const next = { ...prev };
            delete next[type];
            return next;
          });
          if (selectedHistoricalProject) {
            const key = surveyTypeToKey[type];
            const updated = { ...selectedHistoricalProject, [key]: null };
            const est = { ...(selectedHistoricalProject.estimations || {}) };
            delete est[type];
            updated.estimations = Object.keys(est).length ? est : undefined;
            setSelectedHistoricalProject(updated);
            const raw = localStorage.getItem('aa2000_saved_projects');
            if (raw) {
              const parsed = JSON.parse(raw);
              const idx = parsed.findIndex((p: any) => p.timestamp === selectedHistoricalProject.timestamp);
              if (idx !== -1) {
                parsed[idx] = updated;
                safeSetSavedProjects(parsed);
              }
            }
          }
        };

        const surveyTypeToScreen: Record<SurveyType, Screen> = {
          [SurveyType.CCTV]: 'CCTV_SURVEY',
          [SurveyType.FIRE_ALARM]: 'FA_SURVEY',
          [SurveyType.FIRE_PROTECTION]: 'FP_SURVEY',
          [SurveyType.ACCESS_CONTROL]: 'AC_SURVEY',
          [SurveyType.BURGLAR_ALARM]: 'BA_SURVEY',
          [SurveyType.OTHER]: 'OTHER_SURVEY',
        };

        const handleEditAudit = (surveyType: SurveyType) => {
          if (selectedHistoricalProject) {
            const raw = localStorage.getItem('aa2000_saved_projects');
            const parsed = raw ? JSON.parse(raw) : [];
            const idx = parsed.findIndex((p: any) => p.project?.id === selectedHistoricalProject.project?.id && p.timestamp === selectedHistoricalProject.timestamp);
            if (idx !== -1) handleEditProject(selectedHistoricalProject, idx);
          }
          setSurveyType(surveyType);
          setScreen(surveyTypeToScreen[surveyType]);
        };

        /** Hide only while waiting on admin or fully closed; Rejected allows resubmit after edits. */
        const technicianDoneHiddenStatuses: Project['status'][] = ['Pending Review', 'Finalized', 'Finalized - Approved', 'Finalized - Rejected', 'Completed'];
        const shouldHideTechnicianDoneButton =
          userRole === 'TECHNICIAN' &&
          !!selectedHistoricalProject &&
          technicianDoneHiddenStatuses.includes((dP.status || 'In Progress') as Project['status']);

        return (
          <SurveySummary
            user={user}
            userRole={userRole}
            project={summaryView!.project}
            cctvData={summaryView!.cctvData}
            faData={summaryView!.faData}
            fpData={summaryView!.fpData}
            acData={summaryView!.acData}
            baData={summaryView!.baData}
            otherData={summaryView!.otherData}
            estimations={summaryView!.estimations}
            hideDoneButton={userRole === 'ADMIN' || shouldHideTechnicianDoneButton}
            onAdminSetReportStatus={
              userRole === 'ADMIN'
                ? async ({ status, reason, actedByRole }) => {
                  const raw = localStorage.getItem('aa2000_saved_projects');
                  const parsed = raw ? JSON.parse(raw) : [];
                  const projId = selectedHistoricalProject?.project?.id ?? dP.id;
                  const ts = selectedHistoricalProject?.timestamp;
                  let idx = editingIndex;
                  if ((idx === null || idx < 0) && projId) {
                    const found = parsed.findIndex(
                      (p: any) => p.project?.id === projId && (!ts || p.timestamp === ts)
                    );
                    if (found >= 0) idx = found;
                  }
                  if (idx !== null && idx >= 0 && parsed[idx]?.project) {
                    const now = new Date().toISOString();
                    const outcome: 'APPROVED' | 'REJECTED' = status === 'Finalized - Approved' ? 'APPROVED' : 'REJECTED';
                    const auditEntry = {
                      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                      outcome,
                      reason: reason || undefined,
                      actedAt: now,
                      actedByRole,
                      actedByName: user?.fullName || undefined,
                    };
                    const nextAuditTrail = [...(parsed[idx].project?.finalizationAuditTrail || []), auditEntry];
                    const resolvedStatus: Extract<Project['status'], 'Finalized - Approved' | 'Finalized - Rejected'> =
                      outcome === 'REJECTED' ? 'Finalized - Rejected' : 'Finalized - Approved';
                    const nextProject = {
                      ...parsed[idx].project,
                      status: resolvedStatus,
                      finalization: {
                        outcome: resolvedStatus === 'Finalized - Rejected' ? 'REJECTED' : 'APPROVED',
                        reason: reason || undefined,
                        actedAt: now,
                        actedByRole,
                        actedByName: user?.fullName || undefined,
                      },
                      finalizationAuditTrail: nextAuditTrail,
                    };
                    parsed[idx] = {
                      ...parsed[idx],
                      project: nextProject,
                    };
                    safeSetSavedProjects(parsed);
                    setSelectedHistoricalProject(parsed[idx]);
                    if (editingIndex === null) setEditingIndex(idx);
                    notifyTechniciansProjectFinalized(nextProject, resolvedStatus, reason);
                    notifyAdminsFinalizationConfirmation(nextProject, outcome, actedByRole);
                    if (resolvedStatus === 'Finalized - Approved') {
                      try {
                        const uploadedFiles = await uploadApprovedEstimationFiles(parsed[idx]);
                        if (uploadedFiles.length) {
                          parsed[idx] = {
                            ...parsed[idx],
                            estimationUploads: uploadedFiles,
                          };
                          safeSetSavedProjects(parsed);
                          setSelectedHistoricalProject(parsed[idx]);
                        }
                        window.alert(`Project approved. Uploaded ${uploadedFiles.length} PDF file(s).`);
                      } catch (err) {
                        console.error('Failed to upload approved estimation file(s):', err);
                        window.alert(`Project approved, but PDF upload did not complete. ${String((err as Error)?.message || err)}`);
                      }
                    }
                  }
                }
                : undefined
            }
            onDone={() => {
              if (userRole === 'TECHNICIAN' && editingIndex !== null) {
                const raw = localStorage.getItem('aa2000_saved_projects');
                const parsed = raw ? JSON.parse(raw) : [];
                if (parsed[editingIndex]?.project) {
                  const completionTime = new Date().toISOString();
                  const nextProject = {
                    ...parsed[editingIndex].project,
                    status: 'Completed' as const,
                    completedAt: completionTime,
                    completedBy: user?.fullName || parsed[editingIndex].project?.technicianName || 'Technician',
                  };
                  parsed[editingIndex] = {
                    ...parsed[editingIndex],
                    project: nextProject,
                  };
                  safeSetSavedProjects(parsed);
                  const historyRaw = localStorage.getItem('aa2000_project_history');
                  const history = historyRaw ? JSON.parse(historyRaw) : [];
                  const currentRecord = parsed[editingIndex];
                  const historyIndex = history.findIndex((row: any) => row?.timestamp === currentRecord?.timestamp);
                  if (historyIndex >= 0) {
                    history[historyIndex] = { ...currentRecord, archivedAt: completionTime };
                  } else {
                    history.push({ ...currentRecord, archivedAt: completionTime });
                  }
                  localStorage.setItem('aa2000_project_history', JSON.stringify(history));
                  notifyAdminsTechnicianCompleted(nextProject, nextProject.completedBy || nextProject.technicianName || 'Technician');
                  notifyAdminsProjectReadyForFinalization(nextProject);
                }
              }
              setScreen(userRole === 'ADMIN' ? 'CURRENT_PROJECTS' : 'DASHBOARD');
              setActiveProject(null); setCctvData(null); setFaData(null); setFpData(null);
              setAcData(null); setBaData(null); setOtherData(null); setEstimations({});
              setSelectedHistoricalProject(null); setEditingIndex(null);
            }}
            onProceedOtherAudits={() => {
              setOpenSurveyPickerOnProjectDetails(false);
              setWorkspaceSection('ONGOING');
              setDashboardSystemModalTarget({
                projectId: dP.id,
                timestamp: selectedHistoricalProject?.timestamp,
                nonce: Date.now(),
              });
              setScreen('DASHBOARD');
            }}
            onDeleteSurvey={handleDeleteSurvey}
            onEditAudit={handleEditAudit}
          />
        );

      default:
        return <div className="h-full flex items-center justify-center">Screen not implemented</div>;
    }
  };

  return (
    <div
      className={`w-full min-h-[100dvh] h-[100dvh] relative overflow-hidden font-sans flex flex-col transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900'
        }`}
    >
      {renderScreen()}
    </div>
  );
};

export default App;
