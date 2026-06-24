import React, { useState, useEffect } from 'react';
import { Project, CCTVSurveyData, FireAlarmSurveyData, AccessControlSurveyData, BurglarAlarmSurveyData, FireProtectionSurveyData, OtherSurveyData, SurveyType, EstimationDetail, PROJECT_STATUS_DISPLAY } from '../types';
import { processTitleCase } from '../utils/voiceProcessing';
import { computeAccessControlMeanCosts } from '../utils/accessControlMeanPricing';
import { computeCctvMeanCosts, CCTV_MEAN } from '../utils/cctvMeanPricing';
import { computeFireAlarmMeanCosts, FIRE_ALARM_MEAN } from '../utils/fireAlarmMeanPricing';
import { computeFireProtectionMeanCosts, FIRE_PROTECTION_MEAN } from '../utils/fireProtectionMeanPricing';
import { computeBurglarAlarmMeanCosts } from '../utils/burglarAlarmMeanPricing';
import { CONSUMABLE_DEFAULT_PRICES } from '../utils/consumableDefaultPrices';
import { projectSurveyScope } from '../utils/projectSurveyVisibility';

interface Remark {
  id: string;
  sender: 'Sales' | 'Admin' | 'Technician';
  text: string;
  timestamp: string;
  replyToId?: string;
  replyToText?: string;
}

interface Props {
  user?: any;
  userRole: 'TECHNICIAN' | 'ADMIN' | null;
  project: Project;
  cctvData: CCTVSurveyData | null;
  faData: FireAlarmSurveyData | null;
  fpData?: FireProtectionSurveyData | null;
  acData: AccessControlSurveyData | null;
  baData?: BurglarAlarmSurveyData | null;
  otherData?: OtherSurveyData | null;
  estimations?: Record<string, EstimationDetail> | null;
  estimationData?: { days: number; techs: number } | null; // Support legacy single object
  onDone: () => void;
  onProceedOtherAudits?: () => void;
  hideDoneButton?: boolean;
  onAdminSetReportStatus?: (payload: {
    status: Extract<Project['status'], 'Finalized - Approved' | 'Finalized - Rejected'>;
    reason?: string;
    actedByRole: 'Admin' | 'Sales';
  }) => void;
  onDeleteSurvey?: (surveyType: SurveyType) => void;
  /** When provided, shows Edit Audit button in detail modal; called with survey type to open that survey for editing. */
  onEditAudit?: (surveyType: SurveyType) => void;
}

const PRICES = {
  CCTV: { DOME_BULLET: CCTV_MEAN.DOME_BULLET, CAMERA_8MP: CCTV_MEAN.CAMERA_8MP, AI_FACE_REC: CCTV_MEAN.AI_FACE_REC, NVR_BASE: CCTV_MEAN.NVR_BASE, CAT6_PER_METER: CCTV_MEAN.CAT6_PER_METER },
  FIRE_PROTECTION: {
    EXTINGUISHER_ABC: FIRE_PROTECTION_MEAN.EXTINGUISHER_ABC,
    EXTINGUISHER_CO2: FIRE_PROTECTION_MEAN.EXTINGUISHER_CO2,
    EXTINGUISHER_WATER: FIRE_PROTECTION_MEAN.EXTINGUISHER_WATER,
    EXTINGUISHER_FOAM: FIRE_PROTECTION_MEAN.EXTINGUISHER_FOAM,
    EXTINGUISHER_K_CLASS: FIRE_PROTECTION_MEAN.EXTINGUISHER_K_CLASS,
    HOSE_REEL_SET_30M: FIRE_PROTECTION_MEAN.HOSE_REEL_SET_30M,
    FIRE_BLANKET: FIRE_PROTECTION_MEAN.FIRE_BLANKET,
    EMERGENCY_LIGHT: FIRE_PROTECTION_MEAN.EMERGENCY_LIGHT,
    EXIT_SIGN: FIRE_PROTECTION_MEAN.EXIT_SIGN,
    SPRINKLER_HEAD: FIRE_PROTECTION_MEAN.SPRINKLER_HEAD,
    PIPE_GI_PER_M: FIRE_PROTECTION_MEAN.PIPE_GI_PER_M,
    PIPE_BLACK_STEEL_PER_M: FIRE_PROTECTION_MEAN.PIPE_BLACK_STEEL_PER_M,
    PIPE_CPVC_PER_M: FIRE_PROTECTION_MEAN.PIPE_CPVC_PER_M,
    PIPE_OTHER_PER_M: FIRE_PROTECTION_MEAN.PIPE_OTHER_PER_M,
    SUPPRESSION_BASE_TOTAL_FLOODING: FIRE_PROTECTION_MEAN.SUPPRESSION_BASE_TOTAL_FLOODING,
    SUPPRESSION_BASE_LOCAL_APPLICATION: FIRE_PROTECTION_MEAN.SUPPRESSION_BASE_LOCAL_APPLICATION,
    SUPPRESSION_PER_NOZZLE: FIRE_PROTECTION_MEAN.SUPPRESSION_PER_NOZZLE,
    FIRE_CABLE_METER: FIRE_PROTECTION_MEAN.FIRE_CABLE_METER
  },
  FIRE_ALARM: {
    SMOKE_CONVENTIONAL: FIRE_ALARM_MEAN.SMOKE_CONVENTIONAL,
    SMOKE_ADDRESSABLE: FIRE_ALARM_MEAN.SMOKE_ADDRESSABLE,
    HEAT_CONVENTIONAL: FIRE_ALARM_MEAN.HEAT_CONVENTIONAL,
    HEAT_ADDRESSABLE: FIRE_ALARM_MEAN.HEAT_ADDRESSABLE,
    MULTI_SENSOR: FIRE_ALARM_MEAN.MULTI_SENSOR,
    FLAME: FIRE_ALARM_MEAN.FLAME,
    GAS: FIRE_ALARM_MEAN.GAS,
    DETECTOR_OTHER: FIRE_ALARM_MEAN.DETECTOR_OTHER,
    FACP_CONVENTIONAL: FIRE_ALARM_MEAN.FACP_CONVENTIONAL,
    FACP_ADDRESSABLE: FIRE_ALARM_MEAN.FACP_ADDRESSABLE,
    FACP_WIRELESS: FIRE_ALARM_MEAN.FACP_WIRELESS,
    BELL: FIRE_ALARM_MEAN.BELL,
    HORN: FIRE_ALARM_MEAN.HORN,
    STROBE: FIRE_ALARM_MEAN.STROBE,
    HORN_STROBE: FIRE_ALARM_MEAN.HORN_STROBE,
    MCP: FIRE_ALARM_MEAN.MCP,
    NOTIFICATION_AVG: FIRE_ALARM_MEAN.NOTIFICATION_AVG,
    BATTERY_7AH: FIRE_ALARM_MEAN.BATTERY_7AH,
    FIRE_CABLE_METER: FIRE_ALARM_MEAN.FIRE_CABLE_METER,
    DETECTOR: FIRE_ALARM_MEAN.DETECTOR,
    FACP_BASE: FIRE_ALARM_MEAN.FACP_BASE
  },
  LABOR_TECH_RATE_DAY: 1200,
  VAT: 0.12
};

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(val);

type ProjectRoleSummary = {
  role: string;
  count: number;
  hours: number;
  manDays: number;
};

function getSystemEstimate(
  surveyType: string,
  data: any,
  est?: EstimationDetail | null
): { equipment: number; cables: number; labor: number; consumables: number; additional: number; subtotal: number; total: number } {
  let equipment = 0;
  let cables = 0;
  const manDays = est ? est.days * est.techs : 0;
  const labor = manDays * PRICES.LABOR_TECH_RATE_DAY;
  const normalizeConsumableName = (raw: string) =>
    String(raw || '')
      .replace(/\s*\(suggested\)\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const consumables = est?.consumablesList?.length
    ? est.consumablesList.reduce((s, e) => {
        const name = normalizeConsumableName(e?.name);
        const unit =
          Number(e?.unitPrice) || (name && CONSUMABLE_DEFAULT_PRICES[name] ? CONSUMABLE_DEFAULT_PRICES[name] : 0);
        return s + (Number(e?.qty) || 0) * unit;
      }, 0)
    : 0;
  const additional = est?.additionalFees?.length
    ? est.additionalFees.reduce((s, f) => s + (f.amount || 0), 0)
    : 0;

  if (surveyType === 'CCTV' && data?.cameras && Array.isArray(data.cameras)) {
    const computed = computeCctvMeanCosts(data as CCTVSurveyData);
    equipment = computed.equipment;
    cables = computed.cablesCost;
  } else if (surveyType === 'Fire Alarm' && data?.detectionAreas && Array.isArray(data.detectionAreas)) {
    const computed = computeFireAlarmMeanCosts(data as FireAlarmSurveyData);
    equipment = computed.equipment;
    cables = computed.cablesCost;
  } else if (surveyType === 'Access Control' && data) {
    // Mean-average pricing for Access Control hardware components (PHP).
    // This keeps BOQ/estimate totals consistent with the Access Control estimation screen.
    const computed = computeAccessControlMeanCosts(data as AccessControlSurveyData);
    equipment = computed.equipment;
    cables = computed.cablesCost;
  } else if (surveyType === 'Other' && data) {
    equipment = Number(data.estimatedCost) || 0;
    cables = Number(data.cablesCost) || 0;
  } else if (surveyType === 'Fire Protection' && data) {
    const computed = computeFireProtectionMeanCosts(data as FireProtectionSurveyData);
    equipment = computed.equipment;
    cables = computed.cablesCost;
  } else if (surveyType === 'Burglar Alarm' && data?.sensors != null) {
    const computed = computeBurglarAlarmMeanCosts(data as BurglarAlarmSurveyData);
    equipment = computed.equipment;
    cables = computed.cablesCost;
  }

  const subtotal = equipment + cables + labor + consumables + additional;
  const total = subtotal * (1 + PRICES.VAT);
  // Return full breakdown so callers can render consistent cost components.
  return { equipment, cables, labor, consumables, additional, subtotal, total };
}

const SurveySummary: React.FC<Props> = ({ userRole, project, cctvData, faData, fpData, acData, baData, otherData, estimations, estimationData, onDone, onProceedOtherAudits, hideDoneButton = false, onAdminSetReportStatus, onDeleteSurvey, onEditAudit }) => {
  const canViewSensitive = userRole === 'ADMIN';
  const isTechnician = userRole === 'TECHNICIAN';
  const assignedSurveySet = new Set<SurveyType>(projectSurveyScope(project));
  const isAssignedCompletedSurvey = (surveyType: SurveyType, surveyData: unknown) =>
    assignedSurveySet.has(surveyType) && !!surveyData && !!estimations?.[surveyType];
  const completedAudits = [
    { type: SurveyType.CCTV, label: 'CCTV', completed: isAssignedCompletedSurvey(SurveyType.CCTV, cctvData) },
    { type: SurveyType.FIRE_ALARM, label: 'Fire Alarm', completed: isAssignedCompletedSurvey(SurveyType.FIRE_ALARM, faData) },
    { type: SurveyType.FIRE_PROTECTION, label: 'Fire Protection', completed: isAssignedCompletedSurvey(SurveyType.FIRE_PROTECTION, fpData) },
    { type: SurveyType.ACCESS_CONTROL, label: 'Access Control', completed: isAssignedCompletedSurvey(SurveyType.ACCESS_CONTROL, acData) },
    { type: SurveyType.BURGLAR_ALARM, label: 'Burglar Alarm', completed: isAssignedCompletedSurvey(SurveyType.BURGLAR_ALARM, baData) },
    { type: SurveyType.OTHER, label: 'Other', completed: isAssignedCompletedSurvey(SurveyType.OTHER, otherData) },
  ].filter((item) => item.completed);
  const completedAssignedAuditCount = completedAudits.length;
  const totalAssignedAuditCount = assignedSurveySet.size;
  const allAssignedAuditsCompleted =
    totalAssignedAuditCount > 0 && completedAssignedAuditCount >= totalAssignedAuditCount;
  const canProceedOtherAudits = assignedSurveySet.size > 1 && !allAssignedAuditsCompleted;
  const isApprovedFinalizedStatus =
    project.status === 'Finalized' ||
    project.status === 'Finalized - Approved';
  const isTechnicianFinalizedLock = isTechnician && isApprovedFinalizedStatus;
  const canModifyAudit = !isApprovedFinalizedStatus;
  const [currentRemark, setCurrentRemark] = useState('');
  const [sender, setSender] = useState<'Sales' | 'Admin' | 'Technician'>(userRole === 'ADMIN' ? 'Sales' : 'Technician');
  const [remarkHistory, setRemarkHistory] = useState<Remark[]>([]);
  const [techNotes, setTechNotes] = useState('');
  const [replyTo, setReplyTo] = useState<Remark | null>(null);
  const [activeVoiceField, setActiveVoiceField] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<{ type: string; data: any } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showManpowerModal, setShowManpowerModal] = useState(false);
  const [finalizationActor, setFinalizationActor] = useState<'Admin' | 'Sales'>('Sales');
  const [rejectionReason, setRejectionReason] = useState('');
  const [isDoneSubmitting, setIsDoneSubmitting] = useState(false);
  const getSurveyBadge = (surveyType: SurveyType) => {
    const hasEstimation = !!estimations?.[surveyType];
    return hasEstimation
      ? {
          label: 'COMPLETED',
          className: 'bg-blue-900 text-white',
        }
      : {
          label: 'SURVEY ONLY',
          className: 'bg-slate-200 text-slate-700',
        };
  };

  const closeDetail = () => {
    setActiveDetail(null);
    setShowDeleteConfirm(false);
  };

  const handleDoneClick = () => {
    if (isDoneSubmitting) return;
    setIsDoneSubmitting(true);
    onDone();
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

  const safeSetSavedProjects = (parsed: any[]) => {
    try {
      localStorage.setItem('aa2000_saved_projects', JSON.stringify(parsed));
      return parsed;
    } catch (err) {
      const isQuotaError =
        err instanceof DOMException &&
        (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
      if (!isQuotaError) throw err;
      const trimmed = parsed.map(stripHeavyPlanDataFromRecord);
      localStorage.setItem('aa2000_saved_projects', JSON.stringify(trimmed));
      return trimmed;
    }
  };

  // Load existing data from localStorage on mount
  useEffect(() => {
    const savedProjects = localStorage.getItem('aa2000_saved_projects');
    if (savedProjects) {
      const parsed = JSON.parse(savedProjects);
      const currentProjRecord = parsed.find((p: any) => p?.project?.id === project.id);
      if (currentProjRecord) {
        if (currentProjRecord.remarks) {
          setRemarkHistory(currentProjRecord.remarks);
        }
        if (currentProjRecord.techNotes) {
          setTechNotes(currentProjRecord.techNotes);
        }
      }
    }
  }, [project.id]);

  // Aggregate estimations: total manpower and total man-days for this project.
  const getAggregates = () => {
    let totalManpower = 0;
    let totalManDays = 0;
    const roleMap = new Map<string, { count: number; hours: number }>();
    let hasExplicitRoleBreakdown = false;

    if (estimations && Object.keys(estimations).length > 0) {
      Object.values(estimations).forEach((est: any) => {
        const techs = Number(est?.techs) || 0;
        const days = Number(est?.days) || 0;
        totalManpower += techs;
        totalManDays += days * techs;
        const breakdown = Array.isArray(est?.manpowerBreakdown) ? est.manpowerBreakdown : [];
        if (breakdown.length > 0) {
          hasExplicitRoleBreakdown = true;
          breakdown.forEach((m: any) => {
            const role = String(m?.role || '').trim();
            if (!role) return;
            const prev = roleMap.get(role) || { count: 0, hours: 0 };
            roleMap.set(role, {
              count: Math.max(prev.count, Number(m?.count) || 0),
              hours: prev.hours + (Number(m?.hours) || 0),
            });
          });
        }
      });
    } else if (estimationData) {
      totalManpower = estimationData.techs ?? 0;
      totalManDays = (estimationData.days ?? 0) * (estimationData.techs ?? 0);
    }

    let byRole: ProjectRoleSummary[] = [];
    if (hasExplicitRoleBreakdown) {
      byRole = Array.from(roleMap.entries())
        .map(([role, v]) => ({
          role,
          count: v.count,
          hours: v.hours,
          manDays: Number((v.hours / 8).toFixed(2)),
        }))
        .sort((a, b) => b.hours - a.hours);
    } else if (totalManpower > 0 || totalManDays > 0) {
      const totalHours = totalManDays * 8;
      byRole = [
        { role: 'Lead Technician', count: Math.min(1, totalManpower), hours: totalManDays > 0 ? totalManDays * 8 / Math.max(1, totalManpower) : 0, manDays: 0 },
        { role: 'General Helper', count: Math.max(0, totalManpower - 1), hours: Math.max(0, totalHours - (totalManDays > 0 ? totalManDays * 8 / Math.max(1, totalManpower) : 0)), manDays: 0 },
      ]
        .filter((r) => r.count > 0 || r.hours > 0)
        .map((r) => ({ ...r, manDays: Number((r.hours / 8).toFixed(2)) }));
    }

    return { totalManpower, totalManDays, byRole };
  };

  const { totalManpower, totalManDays, byRole } = getAggregates();

  const updateLocalStorage = (field: 'techNotes' | 'remarks', value: any) => {
    const savedProjects = localStorage.getItem('aa2000_saved_projects');
    if (savedProjects) {
      const parsed = JSON.parse(savedProjects);
      const projIdx = parsed.findIndex((p: any) => p?.project?.id === project.id);
      if (projIdx !== -1) {
        parsed[projIdx][field] = value;
        safeSetSavedProjects(parsed);
      }
    }
  };

  const handleTechNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setTechNotes(val);
    updateLocalStorage('techNotes', val);
  };

  const startVoiceInput = (field: string, setter: (val: string) => void) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onstart = () => setActiveVoiceField(field);
    recognition.onend = () => setActiveVoiceField(null);
    recognition.onresult = (event: any) => {
      const processed = processTitleCase(event.results[0][0].transcript);
      setter(processed);
      if (field === 'techNotes') {
        updateLocalStorage('techNotes', processed);
      }
    };
    recognition.start();
  };

  const handleSendRemark = () => {
    if (!currentRemark.trim()) return;

    const newRemark: Remark = {
      id: Math.random().toString(36).substr(2, 9),
      sender: userRole === 'ADMIN' ? sender : 'Technician',
      text: currentRemark,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      replyToId: replyTo?.id,
      replyToText: replyTo ? replyTo.text : undefined
    };

    const updatedHistory = [...remarkHistory, newRemark];
    setRemarkHistory(updatedHistory);
    setCurrentRemark('');
    setReplyTo(null);
    updateLocalStorage('remarks', updatedHistory);
  };

  const handleRemarkClick = (rem: Remark) => {
    setReplyTo(rem);
  };

  const renderRemarkNode = (remark: Remark, depth: number = 0) => {
    const replies = remarkHistory.filter(r => r.replyToId === remark.id);
    const isRoot = depth === 0;
    const containerClasses = isRoot ? 'mb-4' : (depth === 1 ? 'mt-2 ml-5 relative' : 'mt-2 ml-0 relative');

    return (
      <div key={remark.id} className={containerClasses}>
        {!isRoot && <div className="absolute -left-3 top-0 bottom-1/2 w-3 border-l-2 border-b-2 border-slate-100 rounded-bl-lg translate-y-[-2px]"></div>}
        <div onClick={() => handleRemarkClick(remark)} className={`p-2.5 rounded-xl border transition-all animate-fade-in shadow-sm ${isRoot ? 'bg-white border-slate-50' : (depth === 1 ? 'bg-slate-50 border-slate-100' : 'bg-slate-100 border-slate-200')} cursor-pointer active:scale-[0.98] hover:border-blue-200`}>
          <div className="flex justify-between items-center mb-1">
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${remark.sender === 'Sales' ? 'bg-blue-50 text-blue-600' : remark.sender === 'Admin' ? 'bg-amber-50 text-amber-600' : 'bg-[#0F172A] text-white'}`}>
              {remark.sender === 'Technician' ? `TECHNICIAN - ${project.technicianName}` : (remark.sender + ' DEPT')}
            </span>
            <span className="text-[9px] font-bold text-slate-300 tracking-tighter">{remark.timestamp}</span>
          </div>
          <p className="text-sm text-slate-700 font-medium leading-tight text-left">{remark.text}</p>
        </div>
        {replies.length > 0 && <div className="space-y-1">{replies.map(reply => renderRemarkNode(reply, depth + 1))}</div>}
      </div>
    );
  };

  const renderThreadedRemarks = () => {
    /* Removed italic style from fallback text */
    if (remarkHistory.length === 0) return <p className="text-xs text-slate-400 text-center py-2">No department remarks yet.</p>;
    const roots = remarkHistory.filter(rem => !rem.replyToId);
    return <div className="space-y-4">{roots.map(root => renderRemarkNode(root))}</div>;
  };

  const renderAuditDetails = () => {
    if (!activeDetail) return null;
    const { type, data } = activeDetail;

    return (
      <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in">
        <div className="relative bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
          <div className="p-5 bg-white text-blue-900 flex justify-between items-center shrink-0 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <i className={`fas ${
                type === 'CCTV' ? 'fa-camera' : 
                type === 'Fire Alarm' ? 'fa-fire-extinguisher' : 
                type === 'Fire Protection' ? 'fa-shield-heart' : 
                type === 'Access Control' ? 'fa-id-card-clip' : 
                type === 'Burglar Alarm' ? 'fa-shield-halved' : 'fa-ellipsis-h'
              } text-amber-400`}></i>
              {/* Removed italic font style */}
              <h3 className="font-black uppercase tracking-tighter text-sm">{type} Detailed Audit</h3>
            </div>
            <button onClick={closeDetail} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition text-slate-500 hover:text-blue-900">
              <i className="fas fa-times"></i>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 text-left space-y-6">
            {/* Common Building Info Section */}
            {data.buildingInfo && (
              <section className="space-y-2">
                <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Building Specifications</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-slate-50 p-2 rounded-lg">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Type</p>
                    <p className="text-sm font-bold text-slate-700">{data.buildingInfo.type}{data.buildingInfo.otherType ? ` (${data.buildingInfo.otherType})` : ''}</p>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-lg">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Floors</p>
                    <p className="text-sm font-bold text-slate-700">{data.buildingInfo.floors} Floors</p>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-lg">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Site Status</p>
                    <p className="text-sm font-bold text-slate-700">{data.buildingInfo.isNew ? 'New Build' : 'Existing / Retrofit'}</p>
                  </div>
                  {data.buildingInfo.area && (
                    <div className="bg-slate-50 p-2 rounded-lg">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Total Area</p>
                      <p className="text-sm font-bold text-slate-700">{data.buildingInfo.area} sqm</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* CCTV Specifics */}
            {type === 'CCTV' && (
              <>
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Camera Inventory ({data.cameras.length} Units)</h4>
                  <p className="text-xs font-bold text-slate-500">Total Cabling: {data.cameras?.reduce((s: number, c: any) => s + (c.cableLength || 0), 0) ?? 0}m</p>
                  <div className="space-y-2">
                    {data.cameras.map((cam: any) => (
                      <div key={cam.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50/50">
                        <div className="flex justify-between items-start mb-1">
                          <p className="text-sm font-black text-blue-900 uppercase">{cam.locationName}</p>
                          <span className="text-[9px] font-black bg-blue-900 text-white px-1.5 py-0.5 rounded uppercase">{cam.type}</span>
                        </div>
                        <p className="text-xs font-bold text-slate-500 uppercase mt-1">{cam.resolution} • {cam.environment} • {cam.lightingCondition || '—'} • Mount H: {cam.mountingHeight}m • {cam.cableType} {cam.cableLength}m{cam.coverageDistanceMeters != null ? ` • Coverage: ${cam.coverageDistanceMeters}m` : ''}</p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(cam.purposes || []).map((p: string) => (
                            <span key={p} className="text-[9px] font-black border border-slate-200 text-slate-400 px-1 py-0.5 rounded uppercase">{p}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Control & Infra</h4>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                      <p className="text-[10px] font-black text-blue-900 uppercase opacity-60">NVR Location</p>
                      <p className="text-sm font-bold text-blue-900 uppercase">{data.controlRoom.nvrLocation || 'Not Specified'}</p>
                    </div>
                    {(data.controlRoom.storageRequirementTB != null || data.controlRoom.retentionDays != null) && (
                      <div className="grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
                        {data.controlRoom.storageRequirementTB != null && <p>Storage: {data.controlRoom.storageRequirementTB} TB</p>}
                        {data.controlRoom.retentionDays != null && <p>Retention: {data.controlRoom.retentionDays} days</p>}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-xs font-black text-slate-500">
                      <div className="flex items-center gap-2"><i className={`fas ${data.infrastructure.coreDrilling ? 'fa-check-circle text-green-600' : 'fa-circle-xmark text-slate-200'}`}></i> CORE DRILLING</div>
                      <div className="flex items-center gap-2"><i className={`fas ${data.controlRoom.upsRequired ? 'fa-check-circle text-amber-500' : 'fa-circle-xmark text-slate-200'}`}></i> UPS BACKUP</div>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* Fire Alarm Specifics */}
            {type === 'Fire Alarm' && (
              <>
                <section className="space-y-2">
                   <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Detection Layout ({data.detectionAreas?.length ?? 0} Zones)</h4>
                   <p className="text-xs font-bold text-slate-500">Total Detectors: {data.detectionAreas?.reduce((acc: number, area: any) => acc + (area.devices?.reduce((dAcc: number, d: any) => dAcc + (d.count || 0), 0) ?? 0), 0) ?? 0}</p>
                   {(data.detectionAreas || []).map((area: any) => (
                     <div key={area.id} className="p-3 border border-slate-100 rounded-xl bg-red-50/30">
                        <p className="text-xs font-black text-red-900 uppercase">{area.name}</p>
                        {area.ceilingType && <p className="text-[10px] text-slate-500 mt-0.5">Ceiling: {area.ceilingType}{area.ceilingHeight != null ? ` • ${area.ceilingHeight}m` : ''}</p>}
                        <div className="flex flex-wrap gap-4 mt-1">
                          {(area.devices || []).map((d: any, j: number) => {
                            const label = d.type === 'Other' && d.otherType ? d.otherType : d.type;
                            const icon = d.type === 'Smoke' ? 'fa-wind' : d.type === 'Heat' ? 'fa-temperature-high' : d.type === 'Flame' ? 'fa-fire' : d.type === 'Gas' ? 'fa-smog' : d.type === 'Multi-sensor' ? 'fa-microchip' : 'fa-ellipsis-h';
                            return (
                              <div key={j} className="flex items-center gap-1">
                                <i className={`fas ${icon} text-red-400 text-[10px]`}></i>
                                <span className="text-xs font-black text-slate-700">{d.count}x {label}</span>
                              </div>
                            );
                          })}
                        </div>
                        {area.notificationAppliance && <p className="text-[10px] text-slate-500 mt-1">Notification: {area.notificationAppliance}{area.notificationQty != null ? ` ×${area.notificationQty}` : ''}</p>}
                     </div>
                   ))}
                </section>
                <section className="bg-slate-50 p-4 rounded-2xl space-y-2">
                  <div className="flex justify-between border-b border-slate-200 pb-1">
                    <span className="text-xs font-black text-slate-400 uppercase">System Type</span>
                    <span className="text-xs font-black text-blue-900">{data.systemType || '—'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-1">
                    <span className="text-xs font-black text-slate-400 uppercase">FACP Location</span>
                    <span className="text-xs font-black text-blue-900">{data.controlPanel?.location || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-1">
                    <span className="text-xs font-black text-slate-400 uppercase">Cable</span>
                    <span className="text-xs font-black text-blue-900">{data.infrastructure?.cableType || '—'} {data.infrastructure?.cableLength ?? 0}m ({data.infrastructure?.routing || '—'})</span>
                  </div>
                  {data.notification && (
                    <div className="flex justify-between">
                      <span className="text-xs font-black text-slate-400 uppercase">MCP</span>
                      <span className="text-xs font-black text-blue-900">{data.notification.mcpRequired ? `Yes ×${data.notification.mcpCount ?? 0}` : 'No'}</span>
                    </div>
                  )}
                </section>
              </>
            )}

            {/* Access Control Specifics */}
            {type === 'Access Control' && (
              <>
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Door Inventory ({(data.doors || []).length} Doors)</h4>
                  <div className="space-y-2">
                    {(data.doors || []).map((door: any) => (
                      <div key={door.id} className="p-3 border border-slate-100 rounded-xl bg-amber-50/20">
                        <div className="flex justify-between items-start">
                          <p className="text-xs font-black text-amber-900 uppercase">{door.name || door.location}</p>
                          <span className="text-[9px] font-black bg-amber-500 text-blue-900 px-1.5 py-0.5 rounded uppercase">{door.lockType || '—'}</span>
                        </div>
                        <p className="text-xs font-bold text-slate-500 uppercase mt-1">{door.location && door.name !== door.location ? door.location + ' • ' : ''}{door.doorType} {door.operation} • {door.doorMaterial || '—'} • {door.accessMethod?.join(', ') || '—'}</p>
                        {(door.rexType || door.environment || door.wallType) && (
                          <p className="text-[10px] text-slate-500 mt-0.5">REX: {door.rexType || '—'} • {door.environment || '—'} • Wall: {door.wallType === 'Other' ? door.otherWallType : door.wallType || '—'}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="bg-slate-50 p-4 rounded-2xl space-y-2">
                  <div className="flex justify-between border-b border-slate-200 pb-1">
                    <span className="text-xs font-black text-slate-400 uppercase">Controller Location</span>
                    <span className="text-xs font-black text-blue-900 uppercase">{data.controller?.location || 'N/A'}</span>
                  </div>
                  {data.infrastructure && (
                    <div className="flex justify-between">
                      <span className="text-xs font-black text-slate-400 uppercase">Cable / Power</span>
                      <span className="text-xs font-black text-blue-900">{data.infrastructure.cableType} • {data.infrastructure.cablePath} • {data.infrastructure.powerPath}</span>
                    </div>
                  )}
                </section>
              </>
            )}

            {/* Burglar Alarm Specifics */}
            {type === 'Burglar Alarm' && (
              <>
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Sensor Mapping ({(data.sensors || []).length} Entries)</h4>
                  <p className="text-xs font-bold text-slate-500">Total Devices: {(data.sensors || []).reduce((acc: number, s: any) => acc + (s.count || 0), 0)}</p>
                  <div className="space-y-2">
                    {(data.sensors || []).map((sensor: any) => (
                      <div key={sensor.id} className="p-3 border border-slate-100 rounded-xl bg-blue-50/20">
                        <div className="flex justify-between items-start">
                          <p className="text-xs font-black text-blue-900 uppercase">{sensor.location}</p>
                          <span className="text-[9px] font-black bg-blue-900 text-white px-1.5 py-0.5 rounded uppercase">{sensor.type || '—'}</span>
                        </div>
                        <p className="text-xs font-bold text-slate-500 uppercase mt-1">×{sensor.count} • {sensor.connection || '—'} • {sensor.riskLevel || '—'} Risk • {sensor.environment || '—'}</p>
                        <div className="grid grid-cols-2 gap-1 mt-1 border-t border-blue-900/5 pt-1">
                          {sensor.wallType && <p className="text-[10px] font-black text-blue-900 uppercase">Wall: {sensor.wallType === 'Other' ? sensor.otherWallType : sensor.wallType}</p>}
                          {sensor.intrusionConcern && sensor.intrusionConcern.length > 0 && <p className="text-[10px] font-black text-slate-400 uppercase">Concern: {Array.isArray(sensor.intrusionConcern) ? sensor.intrusionConcern.join(', ') : sensor.intrusionConcern}</p>}
                          {sensor.obstructions && sensor.obstructions.length > 0 && <p className="text-[10px] font-black text-amber-600 uppercase">Obstruction: {Array.isArray(sensor.obstructions) ? sensor.obstructions.join(', ') : sensor.obstructions}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="bg-slate-50 p-4 rounded-2xl space-y-2">
                  <div className="flex justify-between border-b border-slate-200 pb-1">
                    <span className="text-xs font-black text-slate-400 uppercase">System Type</span>
                    <span className="text-xs font-black text-blue-900 uppercase">{data.controlPanel?.systemType || '—'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-1">
                    <span className="text-xs font-black text-slate-400 uppercase">Control Panel</span>
                    <span className="text-xs font-black text-blue-900">{data.controlPanel?.location || 'N/A'}</span>
                  </div>
                  {data.notification && (
                    <div className="flex justify-between">
                      <span className="text-xs font-black text-slate-400 uppercase">Sirens</span>
                      <span className="text-xs font-black text-blue-900">Indoor: {data.notification.sirenIndoor ?? 0} • Outdoor: {data.notification.sirenOutdoor ?? 0}</span>
                    </div>
                  )}
                </section>
              </>
            )}

            {/* Fire Protection Specifics */}
            {type === 'Fire Protection' && (
              <>
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Protection Units ({(data.protectionUnits || []).length})</h4>
                  {(data.protectionUnits || []).length > 0 ? (
                    <div className="space-y-2">
                      {(data.protectionUnits || []).map((u: any, i: number) => (
                        <div key={u.id ?? i} className="p-3 border border-slate-100 rounded-xl bg-red-50/20">
                          <p className="text-xs font-black text-red-900 uppercase">{u.protectionArea || u.otherProtectionArea || 'Area'}</p>
                          <p className="text-xs font-bold text-slate-500 mt-0.5">Hazard: {u.hazardClassification || '—'} • Systems: {u.scope?.systems?.join(', ') || '—'}</p>
                          <p className="text-xs font-bold text-slate-600 mt-1">Detectors: Smoke×{u.alarmCore?.smokeCount ?? 0} Heat×{u.alarmCore?.heatCount ?? 0} MCP×{u.alarmCore?.mcpCount ?? 0} Notif×{u.alarmCore?.notifCount ?? 0}</p>
                          {(u.suppression?.type || u.suppression?.qty) ? <p className="text-xs font-bold text-slate-600 mt-0.5">Suppression: {u.suppression.type || '—'} ×{u.suppression.qty ?? 0}</p> : null}
                          {u.sprinkler && (u.sprinkler.coverageArea || u.sprinkler.waterSource) && <p className="text-[10px] text-slate-500 mt-0.5">Sprinkler: {u.sprinkler.coverageArea ?? 0} sqm • {u.sprinkler.waterSource || '—'}</p>}
                          {u.fireExtinguisher && (u.fireExtinguisher.type || u.fireExtinguisher.quantity > 0) && (
                            <p className="text-[10px] text-slate-500 mt-0.5">Fire Extinguisher: {u.fireExtinguisher.type || u.fireExtinguisher.otherType || '—'} ×{u.fireExtinguisher.quantity} {u.fireExtinguisher.capacity || u.fireExtinguisher.otherCapacity || ''} {u.fireExtinguisher.mountingType ? `(${u.fireExtinguisher.mountingType})` : ''}</p>
                          )}
                          {u.fireHoseReel && u.fireHoseReel.quantity > 0 && (
                            <p className="text-[10px] text-slate-500 mt-0.5">Fire Hose Reel: ×{u.fireHoseReel.quantity} • {u.fireHoseReel.hoseLengthM}m • {u.fireHoseReel.nozzleType || u.fireHoseReel.otherNozzleType || '—'}</p>
                          )}
                          {u.fireBlanket && u.fireBlanket.quantity > 0 && (
                            <p className="text-[10px] text-slate-500 mt-0.5">Fire Blanket: ×{u.fireBlanket.quantity}{u.fireBlanket.locations ? ` • ${u.fireBlanket.locations}` : ''}</p>
                          )}
                          {u.emergencyLighting?.present && (
                            <p className="text-[10px] text-slate-500 mt-0.5">Emergency Lighting: Yes{u.emergencyLighting.type ? ` (${u.emergencyLighting.type})` : ''}</p>
                          )}
                          {u.exitEvacuation && (u.exitEvacuation.exitSignsQuantity > 0 || u.exitEvacuation.evacuationLightingPresent) && (
                            <p className="text-[10px] text-slate-500 mt-0.5">Exit signs: {u.exitEvacuation.exitSignsQuantity} • Evac lighting: {u.exitEvacuation.evacuationLightingPresent ? 'Yes' : 'No'}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-bold text-slate-500">Scope: {data.scope?.systems?.join(', ') || '—'} • {data.scope?.status || '—'}</p>
                      <p className="text-xs font-bold text-slate-600">Alarm: Smoke×{data.alarmCore?.smokeCount ?? 0} Heat×{data.alarmCore?.heatCount ?? 0} MCP×{data.alarmCore?.mcpCount ?? 0} Notif×{data.alarmCore?.notifCount ?? 0}</p>
                      {data.suppression?.type && <p className="text-xs font-bold text-slate-600">Suppression: {data.suppression.type} ×{data.suppression.qty ?? 0}</p>}
                      {data.fireExtinguisher && (data.fireExtinguisher.type || data.fireExtinguisher.quantity > 0) && (
                        <p className="text-xs font-bold text-slate-600 mt-0.5">Fire Extinguisher: {data.fireExtinguisher.type || data.fireExtinguisher.otherType || '—'} ×{data.fireExtinguisher.quantity} {data.fireExtinguisher.capacity || data.fireExtinguisher.otherCapacity || ''}</p>
                      )}
                      {data.fireHoseReel && data.fireHoseReel.quantity > 0 && (
                        <p className="text-xs font-bold text-slate-600 mt-0.5">Fire Hose Reel: ×{data.fireHoseReel.quantity} • {data.fireHoseReel.hoseLengthM}m</p>
                      )}
                      {data.fireBlanket && data.fireBlanket.quantity > 0 && (
                        <p className="text-xs font-bold text-slate-600 mt-0.5">Fire Blanket: ×{data.fireBlanket.quantity}</p>
                      )}
                      {data.emergencyLighting?.present && (
                        <p className="text-xs font-bold text-slate-600 mt-0.5">Emergency Lighting: Yes{data.emergencyLighting.type ? ` (${data.emergencyLighting.type})` : ''}</p>
                      )}
                      {data.exitEvacuation && (data.exitEvacuation.exitSignsQuantity > 0 || data.exitEvacuation.evacuationLightingPresent) && (
                        <p className="text-xs font-bold text-slate-600 mt-0.5">Exit signs: {data.exitEvacuation.exitSignsQuantity} • Evac lighting: {data.exitEvacuation.evacuationLightingPresent ? 'Yes' : 'No'}</p>
                      )}
                    </>
                  )}
                </section>
                {data.zoning && (
                  <section className="bg-slate-50 p-4 rounded-2xl space-y-2">
                    <div className="flex justify-between border-b border-slate-200 pb-1">
<span className="text-xs font-black text-slate-400 uppercase">Zones</span>
                    <span className="text-xs font-black text-blue-900">{data.zoning.zones ?? '—'}</span>
                    </div>
                    {data.zoning.highRiskAreas?.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-xs font-black text-slate-400 uppercase">High-risk</span>
                        <span className="text-xs font-black text-blue-900">{data.zoning.highRiskAreas.join(', ')}</span>
                      </div>
                    )}
                  </section>
                )}
                {data.infrastructure && (
                  <section className="bg-slate-50 p-4 rounded-2xl space-y-2">
                    <div className="flex justify-between">
                      <span className="text-xs font-black text-slate-400 uppercase">Cable</span>
                      <span className="text-xs font-black text-blue-900">{data.infrastructure.cableType} {data.infrastructure.cableLength ?? 0}m</span>
                    </div>
                  </section>
                )}
              </>
            )}

            {/* Custom / Other */}
            {type === 'Other' && (
              <section className="space-y-3">
                 <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Other System</h4>
                 <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-700">
                   {(data.systemCategory || data.otherSystemCategory) && (
                     <div className="bg-slate-50 p-2 rounded-lg col-span-2">
                       <p className="text-[10px] font-black text-slate-400 uppercase">Category</p>
                       <p>{data.systemCategory || data.otherSystemCategory}</p>
                     </div>
                   )}
                   {(data.scopeOfWork || data.otherScopeOfWork) && (
                     <div className="bg-slate-50 p-2 rounded-lg col-span-2">
                       <p className="text-[10px] font-black text-slate-400 uppercase">Scope</p>
                       <p>{data.scopeOfWork || data.otherScopeOfWork}</p>
                     </div>
                   )}
                   {(data.coverageArea || data.otherCoverageArea) && (
                     <div className="bg-slate-50 p-2 rounded-lg col-span-2">
                       <p className="text-[10px] font-black text-slate-400 uppercase">Coverage</p>
                       <p>{data.coverageArea || data.otherCoverageArea}</p>
                     </div>
                   )}
                 </div>
                 <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1 pt-1">Service Description</h4>
                 <div className="p-4 bg-slate-900 rounded-2xl text-white text-[11px] leading-relaxed shadow-lg">
                    "{data.serviceDetails}"
                 </div>
                {canViewSensitive && (
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="bg-slate-50 p-3 rounded-xl">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Estimated Cost</p>
                      <p className="text-xs font-black text-blue-900">₱{data.estimatedCost?.toLocaleString() || '0'}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Cable Cost</p>
                      <p className="text-xs font-black text-blue-900">₱{data.cablesCost?.toLocaleString() || '0'}</p>
                    </div>
                  </div>
                )}
              </section>
            )}
            
            {/* Cost Summary (Sales/Admin only) */}
            {canViewSensitive && (() => {
              const typeToKey: Record<string, string> = { 'CCTV': SurveyType.CCTV, 'Fire Alarm': SurveyType.FIRE_ALARM, 'Access Control': SurveyType.ACCESS_CONTROL, 'Burglar Alarm': SurveyType.BURGLAR_ALARM, 'Fire Protection': SurveyType.FIRE_PROTECTION, 'Other': SurveyType.OTHER };
              const est = estimations?.[typeToKey[type]] as EstimationDetail | undefined;
              const cost = getSystemEstimate(type, data, est);
              return (
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Cost Summary</h4>
                  <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-2 shadow-sm">
                    <div className="flex justify-between items-center text-sm text-slate-700">
                      <span>Hardware</span>
                      <span className="font-mono">{formatCurrency(cost.equipment)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm text-slate-700">
                      <span>Cabling</span>
                      <span className="font-mono">{formatCurrency(cost.cables)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm text-slate-700">
                      <span>Labor</span>
                      <span className="font-mono">{formatCurrency(cost.labor)}</span>
                    </div>
                    {cost.consumables > 0 && (
                      <div className="flex justify-between items-center text-sm text-slate-700">
                        <span>Consumables</span>
                        <span className="font-mono">{formatCurrency(cost.consumables)}</span>
                      </div>
                    )}
                    {cost.additional > 0 && (
                      <div className="flex justify-between items-center text-sm text-slate-700">
                        <span>Additional Fees</span>
                        <span className="font-mono">{formatCurrency(cost.additional)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-xs text-slate-400 pt-2 border-t border-slate-200">
                      <span>Subtotal</span>
                      <span className="font-mono">{formatCurrency(cost.subtotal)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 mt-2 border-t-2 border-blue-900">
                      <span className="text-sm font-black text-blue-900 uppercase">Estimated ({type})</span>
                      <span className="text-base font-black font-mono text-blue-900">{formatCurrency(cost.total)}</span>
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* Manpower & Duration */}
            {(() => {
              const typeToKey: Record<string, string> = { 'CCTV': SurveyType.CCTV, 'Fire Alarm': SurveyType.FIRE_ALARM, 'Access Control': SurveyType.ACCESS_CONTROL, 'Burglar Alarm': SurveyType.BURGLAR_ALARM, 'Fire Protection': SurveyType.FIRE_PROTECTION, 'Other': SurveyType.OTHER };
              const est = estimations?.[typeToKey[type]] as EstimationDetail | undefined;
              if (!est) return null;
              return (
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Manpower &amp; Duration</h4>
                  <div className="bg-slate-50 rounded-xl border border-slate-100 p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase">Duration</p>
                        <p className="text-sm font-bold text-slate-800">{est.days} day{est.days !== 1 ? 's' : ''}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase">Technicians</p>
                        <p className="text-sm font-bold text-slate-800">{est.techs} tech{est.techs !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    {est.manpowerBreakdown && est.manpowerBreakdown.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Breakdown</p>
                        <div className="space-y-1">
                          {est.manpowerBreakdown.map((m: { id: string; role: string; count: number; hours: number }) => (
                            <div key={m.id} className="flex justify-between items-center text-xs font-bold text-slate-700 border-b border-slate-200/50 pb-1">
                              <span>{m.role} × {m.count}</span>
                              <span className="text-blue-900">{m.hours} hrs</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              );
            })()}

            {/* Consumables (Sales/Admin only) */}
            {canViewSensitive && (() => {
              const typeToKey: Record<string, string> = { 'CCTV': SurveyType.CCTV, 'Fire Alarm': SurveyType.FIRE_ALARM, 'Access Control': SurveyType.ACCESS_CONTROL, 'Burglar Alarm': SurveyType.BURGLAR_ALARM, 'Fire Protection': SurveyType.FIRE_PROTECTION, 'Other': SurveyType.OTHER };
              const est = estimations?.[typeToKey[type]] as EstimationDetail | undefined;
              const list = est?.consumablesList;
              if (!list || list.length === 0) return null;
              return (
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Consumables</h4>
                  <div className="bg-slate-50 rounded-xl border border-slate-100 p-4 space-y-2">
                    {list.map((c: { id: string; name: string; category: string; qty: number; unitPrice?: number }) => {
                      const normalizedName = String(c?.name || '')
                        .replace(/\s*\(suggested\)\s*/gi, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                      const unit =
                        Number(c?.unitPrice) ||
                        (normalizedName && CONSUMABLE_DEFAULT_PRICES[normalizedName]
                          ? CONSUMABLE_DEFAULT_PRICES[normalizedName]
                          : 0);
                      const lineTotal = unit * (Number(c?.qty) || 0);
                      return (
                        <div key={c.id} className="flex justify-between items-center text-xs font-bold text-slate-700 border-b border-slate-200/50 pb-1.5">
                          <span>{c.name} ({c.category}) × {c.qty}</span>
                          <span className="font-mono text-blue-900">{formatCurrency(lineTotal)}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })()}

            {/* Additional Fees */}
            {canViewSensitive && (() => {
              const typeToKey: Record<string, string> = { 'CCTV': SurveyType.CCTV, 'Fire Alarm': SurveyType.FIRE_ALARM, 'Access Control': SurveyType.ACCESS_CONTROL, 'Burglar Alarm': SurveyType.BURGLAR_ALARM, 'Fire Protection': SurveyType.FIRE_PROTECTION, 'Other': SurveyType.OTHER };
              const est = estimations?.[typeToKey[type]] as EstimationDetail | undefined;
              const fees = est?.additionalFees;
              if (!fees || fees.length === 0) return null;
              return (
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Additional Fees</h4>
                  <div className="bg-slate-50 rounded-xl border border-slate-100 p-4 space-y-1.5">
                    {fees.map((f: { id: string; type: string; amount: number }) => (
                      <div key={f.id} className="flex justify-between items-center text-xs font-bold text-slate-700 border-b border-slate-200/50 pb-1">
                        <span>{f.type}</span>
                        <span className="font-mono text-blue-900">{formatCurrency(f.amount)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })()}

            {/* Site Constraints */}
            {(() => {
              const typeToKey: Record<string, string> = { 'CCTV': SurveyType.CCTV, 'Fire Alarm': SurveyType.FIRE_ALARM, 'Access Control': SurveyType.ACCESS_CONTROL, 'Burglar Alarm': SurveyType.BURGLAR_ALARM, 'Fire Protection': SurveyType.FIRE_PROTECTION, 'Other': SurveyType.OTHER };
              const est = estimations?.[typeToKey[type]] as EstimationDetail | undefined;
              const physical = est?.siteConstraintPhysical;
              const electrical = est?.siteConstraintElectrical;
              const installation = est?.siteConstraintInstallation;
              if (!physical && !electrical && !installation) return null;
              return (
                <section className="space-y-2">
                  <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Site Constraints</h4>
                  <div className="bg-slate-50 rounded-xl border border-slate-100 p-4 space-y-3">
                    {physical && (
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">Physical</p>
                        <p className="text-xs font-bold text-slate-700">{physical}</p>
                      </div>
                    )}
                    {electrical && (
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">Electrical</p>
                        <p className="text-xs font-bold text-slate-700">{electrical}</p>
                      </div>
                    )}
                    {installation && (
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">Installation</p>
                        <p className="text-xs font-bold text-slate-700">{installation}</p>
                      </div>
                    )}
                  </div>
                </section>
              );
            })()}

            {/* Floor Plan & Measurements Section */}
            {data.measurements && (
              <section className="space-y-2">
                <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-slate-100 pb-1">Floor Plan & Measurements</h4>
                <div className="bg-slate-50 p-3 rounded-xl space-y-3 text-left">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-slate-400 uppercase">Input Method</span>
                    <span className="text-xs font-black text-blue-900 uppercase">{data.measurements.method === 'PLAN_UPLOAD' ? 'Plan Upload' : 'Manual Entry'}</span>
                  </div>
                  
                  {data.measurements.rooms && data.measurements.rooms.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Room Breakdown</p>
                      <div className="grid grid-cols-1 gap-1">
                        {data.measurements.rooms.map((room: any, idx: number) => (
                          <div key={idx} className="flex justify-between text-xs font-bold border-b border-slate-200/50 pb-0.5">
                            <span className="text-slate-600">{room.name}</span>
                            <span className="text-blue-900">{room.width}m x {room.length}m ({room.area} sqm)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                    <span className="text-xs font-black text-blue-900 uppercase">Total Calculated Area</span>
                    <span className="text-sm font-black text-blue-900">{data.measurements.totalArea} sqm</span>
                  </div>
                </div>
              </section>
            )}
            
            {/* Generic Footer Info */}
            <p className="text-[10px] text-center text-slate-400 uppercase font-black pt-4">Internal AA2000 Technical Documentation • Read-Only View</p>
          </div>

          <div className="p-4 bg-slate-50 border-t border-slate-100 shrink-0 space-y-2">
            {onDeleteSurvey && (
              <button
                type="button"
                disabled={!canModifyAudit}
                onClick={() => {
                  if (!canModifyAudit) return;
                  setShowDeleteConfirm(true);
                }}
                className={`w-full py-3 font-black rounded-xl shadow-lg active:scale-95 transition tracking-widest uppercase text-[10px] ${
                  canModifyAudit
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                }`}
              >
                Delete Audit
              </button>
            )}
            {onEditAudit && (
              <button
                type="button"
                disabled={!canModifyAudit}
                onClick={() => {
                  if (!canModifyAudit) return;
                  const detailTypeToSurveyType: Record<string, SurveyType> = {
                    'CCTV': SurveyType.CCTV,
                    'Fire Alarm': SurveyType.FIRE_ALARM,
                    'Fire Protection': SurveyType.FIRE_PROTECTION,
                    'Access Control': SurveyType.ACCESS_CONTROL,
                    'Burglar Alarm': SurveyType.BURGLAR_ALARM,
                    'Other': SurveyType.OTHER,
                  };
                  const surveyType = detailTypeToSurveyType[type] ?? SurveyType.OTHER;
                  onEditAudit(surveyType);
                  closeDetail();
                }}
                className={`w-full py-3 font-black rounded-xl shadow-lg active:scale-95 transition tracking-widest uppercase text-[10px] ${
                  canModifyAudit
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                }`}
              >
                Edit Audit
              </button>
            )}
             <button 
              onClick={closeDetail}
              className="w-full py-3 bg-blue-900 text-white font-black rounded-xl shadow-lg active:scale-95 transition tracking-widest uppercase text-[10px]"
             >
               Close Details
             </button>
          </div>
        </div>

        {/* Delete confirmation popup */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 z-[120] bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4 rounded-[2rem] animate-fade-in" onClick={() => setShowDeleteConfirm(false)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-xs w-full space-y-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-bold text-slate-800 text-center">Are you sure you want to delete this audit?</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const detailTypeToSurveyType: Record<string, SurveyType> = {
                      'CCTV': SurveyType.CCTV,
                      'Fire Alarm': SurveyType.FIRE_ALARM,
                      'Fire Protection': SurveyType.FIRE_PROTECTION,
                      'Access Control': SurveyType.ACCESS_CONTROL,
                      'Burglar Alarm': SurveyType.BURGLAR_ALARM,
                      'Other': SurveyType.OTHER,
                    };
                    const surveyType = detailTypeToSurveyType[type];
                    if (surveyType && onDeleteSurvey) {
                      onDeleteSurvey(surveyType);
                      closeDetail();
                    }
                    setShowDeleteConfirm(false);
                  }}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl text-[10px] uppercase tracking-wider"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black rounded-xl text-[10px] uppercase tracking-wider"
                >
                  No
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full bg-white animate-fade-in ${hideDoneButton ? '' : 'overflow-hidden'}`}>
      {renderAuditDetails()}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-center scrollbar-hide">
        {!hideDoneButton && (
          <div className="w-14 h-14 bg-[#003399] rounded-full flex items-center justify-center text-white shadow-lg animate-bounce mb-1 mx-auto">
            <i className="fas fa-check text-xl"></i>
          </div>
        )}

        <div className="space-y-0.5">
          {/* Removed italic font style */}
          <h2 className="text-2xl font-black text-[#003399] uppercase leading-tight tracking-tighter">
            {hideDoneButton ? 'PROJECT REPORT' : 'SURVEY COMPLETED'}
          </h2>
          <p className="text-slate-500 font-black uppercase tracking-widest text-sm">{project.name}</p>
          <div className="flex items-center justify-center gap-3 mt-1">
            <div className="flex items-center gap-1">
              <span className="text-slate-400 text-[14px] font-bold uppercase">REF:</span>
              <span className="text-slate-900 text-[14px] font-normal">{project.id}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-400 text-[14px] font-bold uppercase">DATE:</span>
              <span className="text-slate-900 text-[14px] font-normal">{project.date}</span>
            </div>
          </div>
        </div>

        <div className="w-full space-y-2.5">
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-left space-y-1.5 shadow-sm">
            <div className="flex justify-between items-center border-b border-slate-200 pb-1">
              <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Client</span>
              <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">{project.clientName}</span>
            </div>
            <div className="flex justify-between items-center border-b border-slate-200 pb-1">
              <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Contact person</span>
              <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">
                {project.clientContactName?.trim() || '—'}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-slate-200 pb-1">
              <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Site</span>
              <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">{project.locationName || project.location || '—'}</span>
            </div>
            <div className={`flex justify-between items-center ${canViewSensitive ? 'border-b border-slate-200 pb-1' : ''}`}>
              <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Status</span>
              <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">
                {PROJECT_STATUS_DISPLAY[project.status] || project.status || 'In Progress'}
              </span>
            </div>
            {project.finalization?.outcome && (
              <>
                <div className={`flex justify-between items-center ${canViewSensitive ? 'border-b border-slate-200 pb-1' : ''}`}>
                  <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Finalization</span>
                  <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">
                    {project.finalization.outcome === 'APPROVED' ? 'Approved' : 'Rejected'}
                  </span>
                </div>
                <div className={`flex justify-between items-center ${canViewSensitive ? 'border-b border-slate-200 pb-1' : ''}`}>
                  <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Finalized At</span>
                  <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">
                    {new Date(project.finalization.actedAt).toLocaleString()}
                  </span>
                </div>
                {project.finalization.reason && (
                  <div className={`flex justify-between items-center ${canViewSensitive ? 'border-b border-slate-200 pb-1' : ''}`}>
                    <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Reason</span>
                    <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">{project.finalization.reason}</span>
                  </div>
                )}
              </>
            )}
            {project.completedAt && (
              <div className={`flex justify-between items-center ${canViewSensitive ? 'border-b border-slate-200 pb-1' : ''}`}>
                <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Completed At</span>
                <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">{new Date(project.completedAt).toLocaleString()}</span>
              </div>
            )}
            {project.completedBy && (
              <div className={`flex justify-between items-center ${canViewSensitive ? 'border-b border-slate-200 pb-1' : ''}`}>
                <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Completed By</span>
                <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">{project.completedBy}</span>
              </div>
            )}
            {canViewSensitive && (
              <>
                <div className="flex justify-between items-center border-b border-slate-200 pb-1">
                  <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Contact</span>
                  <span className="font-normal text-slate-900 text-sm">{project.clientContact}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Email</span>
                  <span className="font-normal text-slate-900 text-sm ml-2 text-right truncate">{project.clientEmail || '—'}</span>
                </div>
              </>
            )}
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-left space-y-2 shadow-sm">
            <div className="flex justify-between items-center border-b border-slate-200 pb-1">
              <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Completed Audits</span>
              <span className="font-black text-blue-900 text-sm">{completedAudits.length}</span>
            </div>
            {completedAudits.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {completedAudits.map((audit) => (
                  <span
                    key={audit.type}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-900 text-white px-2 py-1 text-[10px] font-black uppercase tracking-wide"
                  >
                    <i className="fas fa-check text-[9px]"></i>
                    {audit.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 font-bold">No completed assigned audits yet.</p>
            )}
          </div>

          <div className="bg-white border border-slate-100 rounded-xl p-3 text-left space-y-4 shadow-sm">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1 text-center">Technical Breakdown</h4>
            
            {isAssignedCompletedSurvey(SurveyType.CCTV, cctvData) && cctvData && (
               <div role="button" tabIndex={0} onClick={() => setActiveDetail({type: 'CCTV', data: cctvData})} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDetail({type: 'CCTV', data: cctvData}); } }} className="w-full flex flex-col gap-0.5 p-2 bg-slate-50 rounded-lg border border-slate-100 hover:border-blue-300 transition-all active:scale-95 group text-left cursor-pointer">
                 <div className="flex justify-between items-center">
                   <div className="flex items-center gap-1.5">
                     <i className="fas fa-camera text-blue-900 text-[11px]"></i>
                     {/* Removed italic font style */}
                     <span className="text-xs font-black text-blue-900 uppercase">CCTV Audit</span>
                   </div>
                   <span className={`px-1 py-0.5 rounded-[3px] text-[10px] font-black ${getSurveyBadge(SurveyType.CCTV).className}`}>{getSurveyBadge(SurveyType.CCTV).label}</span>
                 </div>
                 <div className="flex justify-between text-xs font-bold mt-1">
                   <span className="text-slate-500">Units:</span>
                   <span className="text-slate-900">{cctvData.cameras.length} camera{cctvData.cameras.length !== 1 ? 's' : ''}</span>
                 </div>
                 <div className="flex justify-between text-xs font-bold text-slate-600 mt-0.5">
                   <span className="text-slate-500">Total Cabling:</span>
                   <span className="text-slate-900">{cctvData.cameras.reduce((s: number, c: any) => s + (c.cableLength || 0), 0)}m</span>
                 </div>
                 {estimations && estimations[SurveyType.CCTV] && (
                   <div className="text-xs font-bold text-blue-800/70 mt-1 pt-1 border-t border-slate-200/60">
                     <span className="text-slate-500 block">Phase Effort:</span>
                     <span>{estimations[SurveyType.CCTV].days} day{estimations[SurveyType.CCTV].days !== 1 ? 's' : ''}, {estimations[SurveyType.CCTV].techs} technician{estimations[SurveyType.CCTV].techs !== 1 ? 's' : ''}</span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-blue-900 mt-1 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity text-center">Tap to view full details</p>
               </div>
            )}

            {isAssignedCompletedSurvey(SurveyType.FIRE_ALARM, faData) && faData && (
               <div role="button" tabIndex={0} onClick={() => setActiveDetail({type: 'Fire Alarm', data: faData})} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDetail({type: 'Fire Alarm', data: faData}); } }} className="w-full flex flex-col gap-0.5 p-2 bg-red-50 rounded-lg border border-red-100 hover:border-red-300 transition-all active:scale-95 group text-left cursor-pointer">
                 <div className="flex justify-between items-center">
                   <div className="flex items-center gap-1.5">
                     <i className="fas fa-fire-alt text-red-600 text-[11px]"></i>
                     {/* Removed italic font style */}
                     <span className="text-xs font-black text-red-600 uppercase">Fire Audit</span>
                   </div>
                   <span className={`px-1 py-0.5 rounded-[3px] text-[10px] font-black ${getSurveyBadge(SurveyType.FIRE_ALARM).className}`}>{getSurveyBadge(SurveyType.FIRE_ALARM).label}</span>
                 </div>
                 <div className="flex justify-between text-xs font-bold mt-1">
                   <span className="text-slate-500">Zones:</span>
                   <span className="text-slate-900">{faData.detectionAreas.length} area{faData.detectionAreas.length !== 1 ? 's' : ''}</span>
                 </div>
                 <div className="flex justify-between text-xs font-bold text-slate-600 mt-0.5">
                   <span className="text-slate-500">Detectors:</span>
                   <span className="text-slate-900">{faData.detectionAreas.reduce((acc: number, a: any) => acc + (a.devices?.reduce((dAcc: number, d: any) => dAcc + (d.count || 0), 0) ?? 0), 0)} total</span>
                 </div>
                 {estimations && estimations[SurveyType.FIRE_ALARM] && (
                   <div className="text-xs font-bold text-red-800/70 mt-1 pt-1 border-t border-red-200/60">
                     <span className="text-slate-500 block">Phase Effort:</span>
                     <span>{estimations[SurveyType.FIRE_ALARM].days} day{estimations[SurveyType.FIRE_ALARM].days !== 1 ? 's' : ''}, {estimations[SurveyType.FIRE_ALARM].techs} technician{estimations[SurveyType.FIRE_ALARM].techs !== 1 ? 's' : ''}</span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-red-600 mt-1 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity text-center">Tap to view full details</p>
               </div>
            )}

            {isAssignedCompletedSurvey(SurveyType.FIRE_PROTECTION, fpData) && fpData && (
               <div role="button" tabIndex={0} onClick={() => setActiveDetail({type: 'Fire Protection', data: fpData})} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDetail({type: 'Fire Protection', data: fpData}); } }} className="w-full flex flex-col gap-0.5 p-2 bg-red-900 rounded-lg border border-red-100 hover:bg-red-800 transition-all active:scale-95 group text-left cursor-pointer">
                 <div className="flex justify-between items-center">
                   <div className="flex items-center gap-1.5">
                     <i className="fas fa-shield-heart text-white text-[11px]"></i>
                     {/* Removed italic font style */}
                     <span className="text-xs font-black text-white uppercase">Fire Protection Audit</span>
                   </div>
                   <span className={`px-1 py-0.5 rounded-[3px] text-[10px] font-black ${getSurveyBadge(SurveyType.FIRE_PROTECTION).className}`}>{getSurveyBadge(SurveyType.FIRE_PROTECTION).label}</span>
                 </div>
                 <div className="flex justify-between text-xs font-bold mt-1 text-white/80">
                   <span>Systems:</span>
                   <span className="text-white">{fpData.scope?.systems?.join(', ') ?? '—'}</span>
                 </div>
                 {(fpData.protectionUnits?.length ?? 0) > 0 && (
                   <div className="flex justify-between text-xs font-bold text-white/80 mt-0.5">
                     <span>Protection units:</span>
                     <span className="text-white">{fpData.protectionUnits.length}</span>
                   </div>
                 )}
                 {estimations && estimations[SurveyType.FIRE_PROTECTION] && (
                   <div className="text-xs font-bold text-white/80 mt-1 pt-1 border-t border-white/20">
                     <span className="text-white/70 block">Phase Effort:</span>
                     <span>{estimations[SurveyType.FIRE_PROTECTION].days} day{estimations[SurveyType.FIRE_PROTECTION].days !== 1 ? 's' : ''}, {estimations[SurveyType.FIRE_PROTECTION].techs} technician{estimations[SurveyType.FIRE_PROTECTION].techs !== 1 ? 's' : ''}</span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-white mt-1 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity text-center">Tap to view full details</p>
               </div>
            )}

            {isAssignedCompletedSurvey(SurveyType.ACCESS_CONTROL, acData) && acData && (
               <div role="button" tabIndex={0} onClick={() => setActiveDetail({type: 'Access Control', data: acData})} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDetail({type: 'Access Control', data: acData}); } }} className="w-full flex flex-col gap-0.5 p-2 bg-amber-50 rounded-lg border border-amber-200 hover:border-amber-400 transition-all active:scale-95 group text-left cursor-pointer">
                 <div className="flex justify-between items-center">
                   <div className="flex items-center gap-1.5">
                     <i className="fas fa-id-card-clip text-amber-600 text-[11px]"></i>
                     {/* Removed italic font style */}
                     <span className="text-xs font-black text-amber-600 uppercase">Access Audit</span>
                   </div>
                   <span className={`px-1 py-0.5 rounded-[3px] text-[10px] font-black ${getSurveyBadge(SurveyType.ACCESS_CONTROL).className}`}>{getSurveyBadge(SurveyType.ACCESS_CONTROL).label}</span>
                 </div>
                 <div className="flex justify-between text-xs font-bold mt-1">
                   <span className="text-slate-500">Doors:</span>
                   <span className="text-slate-900">{acData.doors.length} door{acData.doors.length !== 1 ? 's' : ''}</span>
                 </div>
                 {estimations && estimations[SurveyType.ACCESS_CONTROL] && (
                   <div className="text-xs font-bold text-amber-800/70 mt-1 pt-1 border-t border-amber-200/60">
                     <span className="text-slate-500 block">Phase Effort:</span>
                     <span>{estimations[SurveyType.ACCESS_CONTROL].days} day{estimations[SurveyType.ACCESS_CONTROL].days !== 1 ? 's' : ''}, {estimations[SurveyType.ACCESS_CONTROL].techs} technician{estimations[SurveyType.ACCESS_CONTROL].techs !== 1 ? 's' : ''}</span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-amber-600 mt-1 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity text-center">Tap to view full details</p>
               </div>
            )}

            {isAssignedCompletedSurvey(SurveyType.BURGLAR_ALARM, baData) && baData && (
               <div role="button" tabIndex={0} onClick={() => setActiveDetail({type: 'Burglar Alarm', data: baData})} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDetail({type: 'Burglar Alarm', data: baData}); } }} className="w-full flex flex-col gap-0.5 p-2 bg-blue-50 rounded-lg border border-blue-200 hover:border-blue-400 transition-all active:scale-95 group text-left cursor-pointer">
                 <div className="flex justify-between items-center">
                   <div className="flex items-center gap-1.5">
                     <i className="fas fa-shield-halved text-blue-700 text-[11px]"></i>
                     {/* Removed italic font style */}
                     <span className="text-xs font-black text-blue-700 uppercase">Burglar Audit</span>
                   </div>
                   <span className={`px-1 py-0.5 rounded-[3px] text-[10px] font-black ${getSurveyBadge(SurveyType.BURGLAR_ALARM).className}`}>{getSurveyBadge(SurveyType.BURGLAR_ALARM).label}</span>
                 </div>
                 <div className="flex justify-between text-xs font-bold mt-1">
                   <span className="text-slate-500">Sensors:</span>
                   <span className="text-slate-900">{baData.sensors.length} location{baData.sensors.length !== 1 ? 's' : ''}</span>
                 </div>
                 <div className="flex justify-between text-xs font-bold text-slate-600 mt-0.5">
                   <span className="text-slate-500">Devices:</span>
                   <span className="text-slate-900">{baData.sensors.reduce((acc, s) => acc + s.count, 0)} total</span>
                 </div>
                 {estimations && estimations[SurveyType.BURGLAR_ALARM] && (
                   <div className="text-xs font-bold text-blue-800/70 mt-1 pt-1 border-t border-blue-200/60">
                     <span className="text-slate-500 block">Phase Effort:</span>
                     <span>{estimations[SurveyType.BURGLAR_ALARM].days} day{estimations[SurveyType.BURGLAR_ALARM].days !== 1 ? 's' : ''}, {estimations[SurveyType.BURGLAR_ALARM].techs} technician{estimations[SurveyType.BURGLAR_ALARM].techs !== 1 ? 's' : ''}</span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-blue-700 mt-1 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity text-center">Tap to view full details</p>
               </div>
            )}

            {isAssignedCompletedSurvey(SurveyType.OTHER, otherData) && otherData && (
               <div role="button" tabIndex={0} onClick={() => setActiveDetail({type: 'Other', data: otherData})} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDetail({type: 'Other', data: otherData}); } }} className="w-full flex flex-col gap-0.5 p-2 bg-slate-900 rounded-lg border border-slate-700 hover:bg-slate-800 transition-all active:scale-95 group text-left cursor-pointer">
                 <div className="flex justify-between items-center">
                   <div className="flex items-center gap-1.5">
                     <i className="fas fa-ellipsis-h text-white text-[11px]"></i>
                     {/* Removed italic font style */}
                     <span className="text-xs font-black text-white uppercase">Custom Audit</span>
                   </div>
                   <span className={`px-1 py-0.5 rounded-[3px] text-[10px] font-black ${getSurveyBadge(SurveyType.OTHER).className}`}>{getSurveyBadge(SurveyType.OTHER).label}</span>
                 </div>
                 <div className="flex flex-col text-xs font-bold mt-1 text-white/70">
                   <span>Details:</span>
                   <span className="text-white line-clamp-2">"{otherData.serviceDetails}"</span>
                 </div>
                 {estimations && estimations[SurveyType.OTHER] && (
                   <div className="text-xs font-bold text-white/80 mt-1 pt-1 border-t border-white/20">
                     <span className="text-white/70 block">Phase Effort:</span>
                     <span>{estimations[SurveyType.OTHER].days} day{estimations[SurveyType.OTHER].days !== 1 ? 's' : ''}, {estimations[SurveyType.OTHER].techs} technician{estimations[SurveyType.OTHER].techs !== 1 ? 's' : ''}</span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-white mt-1 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity text-center">Tap to view full details</p>
               </div>
            )}
          </div>

          <div className="flex items-center justify-center py-2">
            <div className="w-full space-y-2">
              <button
                type="button"
                onClick={() => setShowManpowerModal(true)}
                className="w-full flex items-center justify-center p-3 bg-white border-[3px] border-slate-200 rounded-[1.5rem] shadow-md animate-fade-in hover:border-slate-300 hover:bg-slate-50 transition active:scale-[0.99] text-left"
              >
                <span className="font-normal text-sm uppercase tracking-tight text-slate-900">
                  {totalManpower} TECHNICIAN{totalManpower !== 1 ? 'S' : ''} NEEDED – {totalManDays} MAN-DAY{totalManDays !== 1 ? 'S' : ''} NEEDED
                </span>
              </button>
              {byRole.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Technician Breakdown</p>
                  {byRole.map((r) => (
                    <div key={r.role} className="flex justify-between items-center text-xs font-bold text-slate-700">
                      <span>{r.role} x {r.count}</span>
                      <span className="text-blue-900">{r.manDays} man-days</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {showManpowerModal && (
            <div className="fixed inset-0 z-[105] bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in" aria-modal="true" role="dialog" aria-labelledby="manpower-modal-title" onClick={() => setShowManpowerModal(false)}>
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h3 id="manpower-modal-title" className="text-base font-black text-slate-800 uppercase tracking-widest">Manpower &amp; Working Hours</h3>
                  <button type="button" onClick={() => setShowManpowerModal(false)} className="text-slate-400 hover:text-slate-600 p-1 transition" aria-label="Close">
                    <i className="fas fa-times text-lg"></i>
                  </button>
                </div>
                <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-6">
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">By audit type</h4>
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="pb-2 pr-2 font-bold uppercase tracking-widest text-[10px]">Type</th>
                          <th className="pb-2 pr-2 font-bold uppercase tracking-widest text-[10px]">Technicians</th>
                          <th className="pb-2 pr-2 font-bold uppercase tracking-widest text-[10px]">Days</th>
                          <th className="pb-2 pr-2 font-bold uppercase tracking-widest text-[10px]">Man-days</th>
                          <th className="pb-2 font-bold uppercase tracking-widest text-[10px]">Working hours</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimations && Object.entries(estimations).map(([typeKey, est]: [string, any]) => {
                          const hrs = (est.days ?? 0) * (est.techs ?? 0) * 8;
                          const manDays = (est.days ?? 0) * (est.techs ?? 0);
                          return (
                            <tr key={typeKey} className="border-b border-slate-100">
                              <td className="py-2 pr-2 font-medium text-slate-900">{typeKey}</td>
                              <td className="py-2 pr-2 text-slate-700">{est.techs ?? 0}</td>
                              <td className="py-2 pr-2 text-slate-700">{est.days ?? 0}</td>
                              <td className="py-2 pr-2 text-slate-700">{manDays}</td>
                              <td className="py-2 text-slate-700">{hrs} hrs</td>
                            </tr>
                          );
                        })}
                        {(!estimations || Object.keys(estimations).length === 0) && estimationData && (
                          <tr className="border-b border-slate-100">
                            <td className="py-2 pr-2 font-medium text-slate-900">Project</td>
                            <td className="py-2 pr-2 text-slate-700">{estimationData.techs ?? 0}</td>
                            <td className="py-2 pr-2 text-slate-700">{estimationData.days ?? 0}</td>
                            <td className="py-2 pr-2 text-slate-700">{(estimationData.days ?? 0) * (estimationData.techs ?? 0)}</td>
                            <td className="py-2 text-slate-700">{(estimationData.days ?? 0) * (estimationData.techs ?? 0) * 8} hrs</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">By role</h4>
                    {byRole.length === 0 ? (
                      <p className="text-sm text-slate-500">No role breakdown for this project.</p>
                    ) : (
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="pb-2 pr-2 font-bold uppercase tracking-widest text-[10px]">Role</th>
                            <th className="pb-2 pr-2 font-bold uppercase tracking-widest text-[10px]">Count</th>
                            <th className="pb-2 pr-2 font-bold uppercase tracking-widest text-[10px]">Man-days</th>
                            <th className="pb-2 font-bold uppercase tracking-widest text-[10px]">Working hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byRole.map(({ role, count, hours, manDays }) => (
                            <tr key={role} className="border-b border-slate-100">
                              <td className="py-2 pr-2 font-medium text-slate-900">{role}</td>
                              <td className="py-2 pr-2 text-slate-700">{count}</td>
                              <td className="py-2 pr-2 text-slate-700">{manDays}</td>
                              <td className="py-2 text-slate-700">{hours} hrs</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-200 flex justify-between text-sm font-semibold text-slate-800">
                    <span>Total</span>
                    <span>{totalManpower} technicians – {totalManDays} man-days – {totalManDays * 8} hrs</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left shadow-sm space-y-2">
            <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest flex items-center gap-2">
              <i className="fas fa-user-hard-hat text-[10px]"></i>
              Technician Remarks
            </h4>

            {!hideDoneButton && userRole === 'TECHNICIAN' ? (
              <div className="relative">
                <textarea 
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 pr-10 text-sm font-medium text-slate-700 min-h-[80px] focus:outline-none focus:border-blue-900 transition-colors shadow-inner resize-none"
                  value={techNotes}
                  onChange={handleTechNotesChange}
                />
                <button type="button" onClick={() => startVoiceInput('techNotes', setTechNotes)} className={`absolute right-3 bottom-3 transition ${activeVoiceField === 'techNotes' ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-blue-900'}`}>
                  <i className="fas fa-microphone"></i>
                </button>
              </div>
            ) : (
              <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                {/* Removed italic font style */}
                <p className="text-sm text-slate-700 font-medium leading-tight">{techNotes || "No notes recorded by technician."}</p>
              </div>
            )}

            {hideDoneButton && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <h4 className="text-xs font-black text-[#003399] uppercase tracking-widest flex items-center gap-2 mb-3">
                  <i className="fas fa-comments text-[10px]"></i>
                  Department Remarks
                </h4>
                <div className="max-h-[300px] overflow-y-auto scrollbar-hide px-1 pb-4">{renderThreadedRemarks()}</div>
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  {userRole === 'ADMIN' && (
                    <div className="flex gap-1.5">
                      <button onClick={() => { setSender('Sales'); setReplyTo(null); }} className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${sender === 'Sales' ? 'bg-[#003399] text-white shadow-md' : 'bg-white border border-slate-200 text-slate-400'}`}>Sales Dept</button>
                      <button onClick={() => { setSender('Admin'); setReplyTo(null); }} className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${sender === 'Admin' ? 'bg-amber-50 text-blue-900 shadow-md' : 'bg-white border border-slate-200 text-slate-400'}`}>Admin</button>
                    </div>
                  )}
                  {replyTo && (
                    <div className="flex items-center justify-between bg-blue-50 p-2 rounded-lg border border-blue-100 animate-fade-in mb-1">
                       <div className="flex flex-col">
                          <span className="text-[9px] font-black text-blue-900 uppercase">Replying to {replyTo.sender}</span>
                          {/* Removed italic font style */}
                          <span className="text-xs text-blue-700 truncate max-w-[180px]">"{replyTo.text}"</span>
                       </div>
                       <button onClick={() => setReplyTo(null)} className="text-blue-900/40 p-1"><i className="fas fa-times-circle text-xs"></i></button>
                    </div>
                  )}
                  <div className="relative">
                    <textarea 
                      className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm font-medium text-slate-700 min-h-[60px] focus:outline-none focus:border-blue-900 transition-colors shadow-inner resize-none pr-16"
                      value={currentRemark}
                      onChange={(e) => setCurrentRemark(e.target.value)}
                    />
                    <div className="absolute right-2 bottom-2 flex items-center gap-1">
                      <button type="button" onClick={() => startVoiceInput('currentRemark', setCurrentRemark)} className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all ${activeVoiceField === 'currentRemark' ? 'text-red-500 animate-pulse bg-red-50' : 'text-slate-400 hover:text-blue-900 bg-slate-50'}`}><i className="fas fa-microphone text-[10px]"></i></button>
                      <button onClick={handleSendRemark} disabled={!currentRemark.trim()} className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all shadow-md active:scale-90 ${currentRemark.trim() ? 'bg-[#003399] text-white' : 'bg-slate-100 text-slate-300'}`}><i className="fas fa-paper-plane text-[10px]"></i></button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Removed italic font style */}
          <p className="text-xs text-slate-300 font-bold pt-1 pb-2 uppercase tracking-tight">Sync complete. Secure report generated for {project.technicianName}.</p>
          {canViewSensitive && project.status === 'Completed' && onAdminSetReportStatus && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left shadow-sm space-y-3">
              <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest">Finalize Project</h4>
              <p className="text-[10px] font-bold uppercase text-slate-500">Review complete audit, costing, and client info before decision.</p>
              <div className="flex gap-1.5">
                <button onClick={() => setFinalizationActor('Sales')} className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${finalizationActor === 'Sales' ? 'bg-[#003399] text-white shadow-md' : 'bg-white border border-slate-200 text-slate-400'}`}>Sales</button>
                <button onClick={() => setFinalizationActor('Admin')} className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${finalizationActor === 'Admin' ? 'bg-amber-50 text-blue-900 shadow-md' : 'bg-white border border-slate-200 text-slate-400'}`}>Admin</button>
              </div>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Rejection reason (required for Reject)"
                className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs font-medium text-slate-700 min-h-[70px] focus:outline-none focus:border-blue-900 transition-colors shadow-inner resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onAdminSetReportStatus({ status: 'Finalized - Approved', actedByRole: finalizationActor })}
                  className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition bg-green-600 text-white hover:bg-green-500"
                >
                  Approve Project
                </button>
                <button
                  onClick={() => {
                    if (!rejectionReason.trim()) return;
                    onAdminSetReportStatus({
                      status: 'Finalized - Rejected',
                      reason: rejectionReason.trim(),
                      actedByRole: finalizationActor,
                    });
                  }}
                  className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition ${rejectionReason.trim() ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
                >
                  Reject Project
                </button>
              </div>
            </div>
          )}
          {project.finalizationAuditTrail && project.finalizationAuditTrail.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left shadow-sm space-y-2">
              <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest">Finalization Audit Trail</h4>
              {project.finalizationAuditTrail.slice().reverse().map((entry) => (
                <div key={entry.id} className="bg-white border border-slate-100 rounded-lg p-2">
                  <p className="text-[10px] font-black uppercase text-slate-700">
                    {entry.outcome === 'APPROVED' ? 'Approved' : 'Rejected'} by {entry.actedByRole}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500">{new Date(entry.actedAt).toLocaleString()}</p>
                  {entry.reason && <p className="text-xs text-slate-700 mt-0.5">{entry.reason}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {!hideDoneButton && (
        <div className="p-3 shrink-0 bg-white border-t border-slate-100">
          {userRole === 'TECHNICIAN' && onProceedOtherAudits && (
            <button
              onClick={onProceedOtherAudits}
              disabled={!canProceedOtherAudits}
              className={`w-full mb-2 py-4 border-2 font-black rounded-xl shadow-sm transition tracking-widest uppercase text-xs ${
                canProceedOtherAudits
                  ? 'bg-white text-[#003399] border-[#003399] active:scale-95'
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
            >
              Proceed The Others Audits
            </button>
          )}
          {/* Removed italic font style */}
          <button
            onClick={handleDoneClick}
            disabled={isDoneSubmitting}
            className={`w-full py-4 text-white font-black rounded-xl shadow-lg transition tracking-widest uppercase text-xs ${
              userRole === 'TECHNICIAN'
                ? 'bg-green-600 hover:bg-green-500 disabled:bg-green-400'
                : 'bg-[#003399] hover:bg-[#002b80] disabled:bg-[#003399]/70'
            } ${isDoneSubmitting ? 'cursor-not-allowed opacity-90' : 'active:scale-95'}`}
          >
            {isDoneSubmitting && userRole === 'TECHNICIAN' ? 'PROCESSING...' : userRole === 'TECHNICIAN' ? 'MARK AS DONE' : 'DASHBOARD RETURN'}
          </button>
        </div>
      )}
    </div>
  );
};

export default SurveySummary;