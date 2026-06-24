import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { Project, SurveyType, User, StoredClient } from '../types';

const CLIENTS_STORAGE_KEY = 'aa2000_clients';

function loadStoredClients(): StoredClient[] {
  try {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistStoredClients(clients: StoredClient[]) {
  localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(clients));
}

function normalizeAssignmentMap(m: Record<string, SurveyType[]>): Record<string, SurveyType[]> {
  const out: Record<string, SurveyType[]> = {};
  for (const [k, v] of Object.entries(m)) {
    const key = k.trim().toLowerCase();
    if (!key) continue;
    out[key] = v;
  }
  return out;
}

function isValidEmailFormat(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

const defaultMarkerIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
import { reverseGeocode, searchPlaces, type PlaceResult } from '../services/geoService';
import {
  ALL_SURVEY_TYPES_ORDERED,
  SURVEY_DISPLAY,
  SURVEY_MODAL_ITEMS,
  technicianSurveyTasks,
} from '../utils/projectSurveyVisibility';
import { processDigitsOnly, processEmail, processPersonName, processTitleCase } from '../utils/voiceProcessing';

type LatLon = { lat: number; lon: number };
const DEFAULT_LOCATION: LatLon = { lat: 14.5995, lon: 120.9842 };
type TechnicianOption = { fullName: string; email: string; role?: string };
type ProjectTechnicianRole = 'Team Lead' | 'Field Technician' | 'Assistant Technician' | 'QA Technician';
const PROJECT_TECHNICIAN_ROLES: ProjectTechnicianRole[] = [
  'Team Lead',
  'Field Technician',
  'Assistant Technician',
  'QA Technician',
];

function LocationPicker({ location, onChange }: { location: LatLon; onChange: (loc: LatLon) => void }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const mapTickTimersRef = useRef<number[]>([]);
  const mapTickFrameRef = useRef<number | null>(null);

  const clearScheduledMapTicks = () => {
    mapTickTimersRef.current.forEach((id) => window.clearTimeout(id));
    mapTickTimersRef.current = [];
    if (mapTickFrameRef.current !== null) {
      window.cancelAnimationFrame(mapTickFrameRef.current);
      mapTickFrameRef.current = null;
    }
  };

  const fitMapToLocation = (map: L.Map, marker: L.Marker, latLng: L.LatLngExpression) => {
    clearScheduledMapTicks();
    marker.setLatLng(latLng);
    const run = () => {
      if (mapInstanceRef.current !== map || markerRef.current !== marker) return;
      try {
        map.invalidateSize();
        map.setView(latLng, 16, { animate: true });
      } catch {
        // Ignore race conditions when map is being torn down.
      }
    };
    run();
    mapTickFrameRef.current = requestAnimationFrame(run);
    mapTickTimersRef.current.push(window.setTimeout(run, 50));
    mapTickTimersRef.current.push(window.setTimeout(run, 250));
  };

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    const map = L.map(mapRef.current).setView([location.lat, location.lon], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const marker = L.marker([location.lat, location.lon], { draggable: true, icon: defaultMarkerIcon }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      onChange({ lat: pos.lat, lon: pos.lng });
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onChange({ lat: e.latlng.lat, lon: e.latlng.lng });
    });
    const onMapResize = () => {
      try {
        if (mapInstanceRef.current !== map) return;
        map.invalidateSize();
      } catch {
        // Ignore resize events during teardown.
      }
    };
    map.whenReady(() => {
      requestAnimationFrame(() => {
        try {
          if (mapInstanceRef.current !== map) return;
          map.invalidateSize();
        } catch {
          // Ignore late frame callbacks after unmount.
        }
      });
    });
    map.on('zoomend', onMapResize);
    mapInstanceRef.current = map;
    markerRef.current = marker;

    let resizeObs: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && mapRef.current) {
      resizeObs = new ResizeObserver(() => map.invalidateSize());
      resizeObs.observe(mapRef.current);
    }

    return () => {
      clearScheduledMapTicks();
      resizeObs?.disconnect();
      map.off('zoomend', onMapResize);
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const latLng = L.latLng(location.lat, location.lon);
    fitMapToLocation(map, marker, latLng);
  }, [location.lat, location.lon]);

  return (
    <div className="w-full h-56 rounded-xl overflow-hidden border-2 border-slate-100 bg-slate-50">
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
}

interface Props {
  /** The current authenticated technician profile */
  user: User;
  /** Role drives visibility (Admin/Sales configure clients & surveys; technicians see a restricted view). */
  userRole: 'TECHNICIAN' | 'ADMIN' | null;
  /** Callback to return to the previous dashboard/list screen */
  onBack: () => void;
  /** Callback to initialize the project context in global state */
  onStart: (p: Project) => void;
  /** Callback to transition the user to a specific technical audit workflow */
  onSelectSurvey: (type: SurveyType) => void;
  /** If true, this screen only creates/assigns project and does not open survey selection. */
  creationOnly?: boolean;
  /** Callback used in creation-only mode to persist a setup-only project. */
  onCreateProject?: (p: Project) => void;
  /** Optional project data if we are editing an existing record */
  initialData?: Project;
  /** Survey systems already completed for this project session. */
  completedSurveyTypes?: SurveyType[];
  /** Auto-opens "Choose System to Audit" modal when entering this screen. */
  openSurveyModalOnMount?: boolean;
  /** Fired after the auto-open request is consumed. */
  onSurveyModalAutoOpened?: () => void;
}

/**
 * PROJECT DETAILS COMPONENT
 * Purpose: This screen captures the foundational metadata for a site survey project.
 * It ensures all project-wide information (Client name, contact, location) is collected
 * before allowing the technician to proceed to a specific technical audit (CCTV, Fire, etc.).
 * 
 * Behavior: Validates input integrity (especially the 11-digit phone number) and 
 * provides voice-to-text dictation for efficient field entry.
 */
const ProjectDetails: React.FC<Props> = ({
  user,
  userRole,
  onBack,
  onStart,
  onSelectSurvey,
  creationOnly = false,
  onCreateProject,
  initialData,
  completedSurveyTypes = [],
  openSurveyModalOnMount = false,
  onSurveyModalAutoOpened,
}) => {
  const isAdmin = userRole === 'ADMIN';

  /**
   * STATE: details
   * Purpose: Stores the text values for the project identification fields.
   * Logic: Managed as a single object to simplify form updates and validation.
   */
  const [details, setDetails] = useState({
    name: '',           // Project title
    clientName: '',     // Company / organization name (directory / billing)
    clientContactName: '', // Individual contact person full name
    clientEmail: '',    // Client email address
    clientContact: '',   // Required 11-digit mobile/landline number
    location: '',       // Physical address or specific site location
    locationName: '',   // Name of the project location (e.g. "Main Office", "Site A")
    startDate: '',
    requiredTechnicians: 1,
    assignedTechnicians: [] as TechnicianOption[]
  });
  const [availableTechnicians, setAvailableTechnicians] = useState<TechnicianOption[]>([]);
  const [selectedTechnicianEmail, setSelectedTechnicianEmail] = useState('');
  const [selectedProjectTechnicianRole, setSelectedProjectTechnicianRole] = useState<ProjectTechnicianRole>('Field Technician');

  const [storedClients, setStoredClients] = useState<StoredClient[]>([]);
  const [selectedClientRecordId, setSelectedClientRecordId] = useState('');
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [newClientDraft, setNewClientDraft] = useState({
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    notes: '',
  });
  const [selectedProjectSurveys, setSelectedProjectSurveys] = useState<SurveyType[]>([]);
  const [technicianSurveyAssignments, setTechnicianSurveyAssignments] = useState<Record<string, SurveyType[]>>({});

  useEffect(() => {
    setStoredClients(loadStoredClients());
  }, []);

  /**
   * EFFECT: Sync form from initialData when returning to Project Details (e.g. back from survey).
   * Ensures Project Name, Client Name, Client Email, and Client Contact Number are retained.
   */
  useEffect(() => {
    if (initialData) {
      setDetails({
        name: initialData.name ?? '',
        clientName: initialData.clientName ?? '',
        clientContactName: initialData.clientContactName ?? '',
        clientEmail: initialData.clientEmail ?? '',
        clientContact: initialData.clientContact ?? '',
        location: initialData.location ?? '',
        locationName: initialData.locationName ?? '',
        startDate: initialData.startDate ?? '',
        requiredTechnicians: initialData.requiredTechnicians ?? 1,
        assignedTechnicians: initialData.assignedTechnicians ?? []
      });
      if (isAdmin) {
        setSelectedClientRecordId(initialData.clientRecordId ?? '');
        const scope = initialData.projectSurveyTypes?.length
          ? [...initialData.projectSurveyTypes]
          : initialData.projectSurveySelections?.length === ALL_SURVEY_TYPES_ORDERED.length
            ? ALL_SURVEY_TYPES_ORDERED.filter((_, idx) => !!initialData.projectSurveySelections?.[idx])
            : [...ALL_SURVEY_TYPES_ORDERED];
        setSelectedProjectSurveys(scope);
        const assignRaw = initialData.technicianSurveyAssignments;
        if (assignRaw && Object.keys(assignRaw).length) {
          setTechnicianSurveyAssignments(normalizeAssignmentMap(assignRaw));
        } else if (initialData.assignedTechnicians?.length) {
          const m: Record<string, SurveyType[]> = {};
          for (const t of initialData.assignedTechnicians) {
            m[t.email.toLowerCase()] = [...scope];
          }
          setTechnicianSurveyAssignments(m);
        } else {
          setTechnicianSurveyAssignments({});
        }
      }
    }
  }, [initialData, isAdmin]);

  /**
   * STATE: activeVoiceField
   * Purpose: Tracks which specific input field is currently receiving voice-to-text data.
   * Visual logic: Used to show a pulsing red microphone icon on the active field.
   */
  const [activeVoiceField, setActiveVoiceField] = useState<string | null>(null);

  /**
   * STATE: showSurveyModal
   * Purpose: Controls the visibility of the "Choose System" selection popup.
   * Logic: Opens only when "SELECT SURVEY SYSTEM" is clicked and form fields are complete.
   */
  const [showSurveyModal, setShowSurveyModal] = useState(false);

  useEffect(() => {
    if (!openSurveyModalOnMount || creationOnly) return;
    setShowSurveyModal(true);
    onSurveyModalAutoOpened?.();
  }, [openSurveyModalOnMount, creationOnly, onSurveyModalAutoOpened]);

  /**
   * STATE: showErrors
   * Purpose: Controls whether validation highlights (red borders) are visible.
   * Logic: Starts false and is triggered only when the user clicks the selection button.
   */
  const [showErrors, setShowErrors] = useState(false);

  /** Map / pin project location (optional). Updates details.location when place is chosen. */
  const [location, setLocation] = useState<LatLon | null>(null);
  const [showLocationScreen, setShowLocationScreen] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locQuery, setLocQuery] = useState('');
  const [locResults, setLocResults] = useState<PlaceResult[]>([]);
  const [activeSearchVoice, setActiveSearchVoice] = useState(false);
  const searchDebounceRef = useRef<number | null>(null);

  const technicianAllowedSurveys = useMemo((): SurveyType[] => {
    if (isAdmin) return [...ALL_SURVEY_TYPES_ORDERED];
    return technicianSurveyTasks(initialData, user.email);
  }, [isAdmin, initialData, user.email]);
  const surveyScopeFlags = ALL_SURVEY_TYPES_ORDERED.map((st) => selectedProjectSurveys.includes(st));
  const standardTextInputClass =
    'w-full bg-slate-50 border-2 px-4 py-3 pr-10 rounded-xl text-slate-900 focus:outline-none transition font-bold text-xs dark:bg-slate-900 dark:text-slate-100';

  /**
   * COMPUTED: isFormComplete
   * Admin/Sales: full client data, survey scope, and per-technician task assignments.
   * Technicians: execution-focused fields only (no contact/email required in UI).
   */
  const adminSetupComplete =
    details.name.trim() !== '' &&
    details.clientName.trim() !== '' &&
    details.clientContactName.trim() !== '' &&
    details.clientContact.trim() !== '' &&
    details.clientContact.length === 11 &&
    details.clientEmail.trim() !== '' &&
    isValidEmailFormat(details.clientEmail) &&
    details.locationName.trim() !== '' &&
    details.startDate.trim() !== '' &&
    details.requiredTechnicians > 0 &&
    details.assignedTechnicians.length >= details.requiredTechnicians &&
    selectedProjectSurveys.length > 0 &&
    details.assignedTechnicians.every((t) => {
      const key = t.email.toLowerCase();
      const surv = technicianSurveyAssignments[key];
      return (
        Array.isArray(surv) &&
        surv.length > 0 &&
        surv.every((s) => selectedProjectSurveys.includes(s))
      );
    });

  const technicianFormComplete =
    details.name.trim() !== '' &&
    details.clientName.trim() !== '' &&
    details.locationName.trim() !== '' &&
    details.startDate.trim() !== '' &&
    technicianAllowedSurveys.length > 0;

  const isFormComplete = isAdmin ? adminSetupComplete : technicianFormComplete;

  const computeStatus = (): 'In Progress' | 'Completed' => {
    if (!details.startDate) return initialData?.status || 'In Progress';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(details.startDate);
    start.setHours(0, 0, 0, 0);
    return start.getTime() > today.getTime() ? 'In Progress' : (initialData?.status || 'In Progress');
  };

  useEffect(() => {
    const techniciansRaw = localStorage.getItem('aa2000_technicians');
    const allTechs: TechnicianOption[] = techniciansRaw
      ? JSON.parse(techniciansRaw).map((t: any) => ({ fullName: t.fullName, email: t.email, role: t.role }))
      : [];
    if (!details.startDate) {
      setAvailableTechnicians(allTechs);
      return;
    }
    const savedRaw = localStorage.getItem('aa2000_saved_projects');
    const saved = savedRaw ? JSON.parse(savedRaw) : [];
    const countByEmail: Record<string, number> = {};
    saved.forEach((record: any) => {
      const p = record?.project;
      if (!p?.startDate || p.startDate !== details.startDate) return;
      const assigned = Array.isArray(p.assignedTechnicians) ? p.assignedTechnicians : [];
      assigned.forEach((tech: TechnicianOption) => {
        countByEmail[tech.email] = (countByEmail[tech.email] || 0) + 1;
      });
    });
    const currentAssignedEmails = new Set(details.assignedTechnicians.map((t) => t.email));
    setAvailableTechnicians(
      allTechs.filter((t) => (countByEmail[t.email] || 0) < 4 || currentAssignedEmails.has(t.email))
    );
  }, [details.startDate, details.assignedTechnicians]);

  /**
   * FUNCTION: handleSelect
   * Purpose: Finalizes project metadata and triggers navigation to the audit system.
   * Logic: 
   *  1. Creates a Project object, generating a new random ID if none exists.
   *  2. Updates parent state via onStart and onSelectSurvey.
   * Input: SurveyType (Enum identifying which technical audit tool to load).
   */
  const handleSelect = (type: SurveyType) => {
    if (!isAdmin && !technicianAllowedSurveys.includes(type)) {
      return;
    }
    const payload: Project = {
      id: initialData?.id || Math.random().toString(36).substr(2, 9),
      ...details,
      clientContactName: details.clientContactName.trim() || undefined,
      requiredTechnicians: details.requiredTechnicians,
      status: computeStatus(),
      technicianName: initialData?.technicianName || (details.assignedTechnicians[0]?.fullName || user.fullName),
      assignedTechnicians: details.assignedTechnicians,
      date: initialData?.date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      clientRecordId: isAdmin ? (selectedClientRecordId || undefined) : initialData?.clientRecordId,
      projectSurveyTypes: isAdmin
        ? [...selectedProjectSurveys]
        : initialData?.projectSurveyTypes?.length
          ? [...initialData.projectSurveyTypes]
          : undefined,
      projectSurveySelections: isAdmin
        ? [...surveyScopeFlags]
        : initialData?.projectSurveySelections
          ? [...initialData.projectSurveySelections]
          : undefined,
      technicianSurveyAssignments: isAdmin
        ? normalizeAssignmentMap(technicianSurveyAssignments)
        : initialData?.technicianSurveyAssignments
          ? normalizeAssignmentMap(initialData.technicianSurveyAssignments)
          : undefined,
      buildingInfo: initialData?.buildingInfo,
    };
    onStart(payload);
    if (creationOnly && onCreateProject) {
      onCreateProject(payload);
      setShowSurveyModal(false);
      return;
    }
    onSelectSurvey(type);
    setShowSurveyModal(false);
  };

  /**
   * FUNCTION: handleContactChange
   * Purpose: Sanitizes the phone number input field.
   * Logic: Removes all non-numeric characters and limits length to 11 digits (PH standard).
   * Input: Standard React input ChangeEvent.
   */
  const handleContactChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 11);
    setDetails(prev => ({...prev, clientContact: val}));
  };

  const handleStoredClientSelect = (clientId: string) => {
    setSelectedClientRecordId(clientId || '');
    if (!clientId) return;
    const c = storedClients.find((x) => x.id === clientId);
    if (!c) return;
    setDetails((prev) => ({
      ...prev,
      clientName: c.companyName,
      clientContactName: (c.contactName || '').trim(),
      clientEmail: c.contactEmail,
      clientContact: (c.contactPhone || '').replace(/\D/g, '').slice(0, 11),
    }));
  };

  const handleCompanyNameInputChange = (value: string) => {
    setDetails((prev) => ({ ...prev, clientName: value }));
    if (!selectedClientRecordId) return;
    const sel = storedClients.find((x) => x.id === selectedClientRecordId);
    if (!sel || value.trim() !== sel.companyName.trim()) {
      setSelectedClientRecordId('');
    }
  };

  const handleOpenNewClientModal = () => {
    setNewClientDraft((d) => ({
      ...d,
      companyName: details.clientName.trim() || d.companyName,
      contactName: details.clientContactName.trim() || d.contactName,
      contactEmail: details.clientEmail.trim() || d.contactEmail,
      contactPhone: details.clientContact || d.contactPhone,
    }));
    setShowNewClientModal(true);
  };

  const submitNewStoredClient = () => {
    const companyName = newClientDraft.companyName.trim();
    const contactEmail = newClientDraft.contactEmail.trim();
    const phoneDigits = newClientDraft.contactPhone.replace(/\D/g, '').slice(0, 11);
    if (!companyName || !isValidEmailFormat(contactEmail) || phoneDigits.length !== 11) {
      alert('Company name, a valid email address, and an 11-digit phone number are required.');
      return;
    }
    const id = `cl_${Math.random().toString(36).slice(2, 11)}`;
    const entry: StoredClient = {
      id,
      companyName,
      contactName: newClientDraft.contactName.trim() || undefined,
      contactEmail,
      contactPhone: phoneDigits,
      notes: newClientDraft.notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    const next = [...loadStoredClients(), entry];
    persistStoredClients(next);
    setStoredClients(next);
    setSelectedClientRecordId(id);
    setDetails((prev) => ({
      ...prev,
      clientName: entry.companyName,
      clientContactName: entry.contactName || prev.clientContactName,
      clientEmail: entry.contactEmail,
      clientContact: entry.contactPhone,
    }));
    setNewClientDraft({
      companyName: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      notes: '',
    });
    setShowNewClientModal(false);
  };

  const applyReverseGeocode = async (lat: number, lon: number): Promise<string> => {
    try {
      const addr = await reverseGeocode(lat, lon);
      const addressStr = addr.displayName.trim() || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      setDetails((prev) => ({ ...prev, location: addressStr }));
      return addressStr;
    } catch {
      /* ignore */
    }
    const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    setDetails((prev) => ({ ...prev, location: fallback }));
    return fallback;
  };

  const handleUseCurrentLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocError('Location not supported in this browser.');
      return;
    }
    setLocError(null);
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setLocation({ lat, lon });
        await applyReverseGeocode(lat, lon);
        setLocLoading(false);
      },
      (err) => {
        setLocError(err.message || 'Failed to get current location.');
        setLocLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleRecenter = () => {
    setLocation((prev) => (prev ? { ...prev } : DEFAULT_LOCATION));
  };

  /** Debounced address suggestions as user types (min 2 chars). */
  useEffect(() => {
    const q = locQuery.trim();
    if (q.length < 2) {
      setLocResults([]);
      return;
    }
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(async () => {
      searchDebounceRef.current = null;
      setLocError(null);
      setLocLoading(true);
      try {
        const mapped = await searchPlaces(q);
        setLocResults(mapped);
      } catch {
        setLocResults([]);
      } finally {
        setLocLoading(false);
      }
    }, 400);
    return () => {
      if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    };
  }, [locQuery]);

  const handleSearchPlace = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = locQuery.trim();
    if (!q) return;
    setLocError(null);
    setLocLoading(true);
    try {
      const mapped = await searchPlaces(q);
      setLocResults(mapped);
      if (!mapped.length) {
        setLocError('No places found. Try a more specific search.');
      } else {
        const first = mapped[0];
        setLocation({ lat: first.lat, lon: first.lon });
        setLocQuery(first.displayName);
        setLocResults([]);
        await applyReverseGeocode(first.lat, first.lon);
      }
    } catch (err) {
      setLocError(err instanceof Error ? err.message : 'Failed to search for that place.');
      setLocResults([]);
    } finally {
      setLocLoading(false);
    }
  };

  const startVoiceInputSearchLocation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setActiveSearchVoice(true);
    recognition.onend = () => setActiveSearchVoice(false);
    recognition.onerror = () => setActiveSearchVoice(false);
    recognition.onresult = (event: any) => {
      setLocQuery(event.results[0][0].transcript);
    };
    recognition.start();
  };

  /**
   * FUNCTION: startVoiceInput
   * Purpose: Enables hands-free text entry via the browser Speech Recognition API.
   * Logic: 
   *  1. Checks for browser compatibility.
   *  2. Starts recognition and tracks the active field.
   *  3. For 'clientContact', it performs word-to-digit conversion (e.g., "one" -> "1").
   *  4. Updates the local 'details' state with the processed transcript.
   * Input: The key of the field to be updated (name, clientName, etc.).
   */
  const startVoiceInput = (field: keyof typeof details) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setActiveVoiceField(field);
    recognition.onend = () => setActiveVoiceField(null);
    recognition.onerror = () => setActiveVoiceField(null);

    recognition.onresult = (event: any) => {
      const rawTranscript = event.results[0][0].transcript;
      const transcript = rawTranscript.toLowerCase();
      if (field === 'clientContact') {
        setDetails(prev => ({ ...prev, [field]: processDigitsOnly(transcript, 11) }));
      } else if (field === 'clientEmail') {
        setDetails(prev => ({ ...prev, [field]: processEmail(transcript) }));
      } else if (field === 'clientName') {
        setDetails(prev => ({ ...prev, [field]: processPersonName(rawTranscript) }));
      } else if (field === 'clientContactName') {
        setDetails(prev => ({ ...prev, [field]: processPersonName(rawTranscript) }));
      } else {
        setDetails(prev => ({ ...prev, [field]: processTitleCase(rawTranscript) }));
      }
    };

    recognition.start();
  };

  /**
   * FUNCTION: handleProceedAttempt
   * Purpose: Checks completion and toggles error visibility or survey selection modal.
   */
  const handleProceedAttempt = () => {
    if (!isFormComplete) {
      setShowErrors(true);
    } else if (creationOnly) {
      handleSelect(SurveyType.OTHER);
    } else {
      setShowSurveyModal(true);
    }
  };

  const openLocationScreen = () => {
    if (!location) setLocation(DEFAULT_LOCATION);
    setShowLocationScreen(true);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-y-auto bg-white p-6 dark:bg-slate-950">
      {/* Pin project location pop-up modal */}
      {showLocationScreen && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in" aria-modal="true" role="dialog" aria-labelledby="pin-location-title" onClick={() => setShowLocationScreen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowLocationScreen(false)}
                  className="text-blue-900 touch-target p-1"
                  aria-label="Close"
                >
                  <i className="fas fa-chevron-left text-xl"></i>
                </button>
                <h2 id="pin-location-title" className="text-xl font-black text-blue-900">PIN PROJECT LOCATION</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowLocationScreen(false)}
                className="text-slate-400 hover:text-slate-600 p-2 rounded-full transition"
                aria-label="Close"
              >
                <i className="fas fa-times text-lg"></i>
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={locLoading}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border-2 border-slate-200 text-[10px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition"
                >
                  <i className="fas fa-crosshairs"></i>
                  {locLoading ? 'Locating…' : 'Use current location'}
                </button>
                <button
                  type="button"
                  onClick={handleRecenter}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border-2 border-slate-200 text-[10px] font-bold text-slate-700 hover:bg-slate-50 transition"
                >
                  Recenter map
                </button>
              </div>
              <form onSubmit={handleSearchPlace} role="search" className="flex flex-wrap gap-2 items-stretch">
                <div className="flex-1 min-w-0 relative min-w-[200px] flex">
                  <input
                    type="text"
                    value={locQuery}
                    onChange={(e) => setLocQuery(e.target.value)}
                    onBlur={() => setTimeout(() => setLocResults([]), 200)}
                    placeholder="Search place, street, city..."
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-3 py-2 pr-10 text-[10px] font-normal text-slate-900 focus:outline-none focus:border-blue-900"
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-expanded={locResults.length > 0 || locLoading}
                  />
                  <button
                    type="button"
                    onClick={startVoiceInputSearchLocation}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 touch-target transition ${activeSearchVoice ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-blue-900'}`}
                    aria-label="Use voice for search location"
                  >
                    <i className="fas fa-microphone"></i>
                  </button>
                  {(locResults.length > 0 || locLoading) && (
                    <div className="absolute left-0 right-0 top-full mt-0.5 z-[500] max-h-48 overflow-y-auto rounded-b-xl border-2 border-t-0 border-slate-200 bg-white shadow-lg">
                      {locLoading && locResults.length === 0 ? (
                        <p className="px-3 py-2 text-[10px] text-slate-500 font-bold">Searching…</p>
                      ) : (
                        <ul className="py-1 text-[10px]" role="listbox">
                          {locResults.map((r, idx) => (
                            <li key={`${r.lat}-${r.lon}-${idx}`} role="option">
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={async () => {
                                  setLocation({ lat: r.lat, lon: r.lon });
                                  setLocQuery(r.displayName);
                                  setLocResults([]);
                                  await applyReverseGeocode(r.lat, r.lon);
                                }}
                                className="w-full text-left px-3 py-2.5 hover:bg-slate-100 font-bold text-slate-700 transition"
                              >
                                {r.displayName}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={locLoading}
                  className="px-3 rounded-xl bg-blue-900 text-white text-[10px] font-black uppercase disabled:opacity-60 transition inline-flex items-center justify-center self-stretch min-h-[2.125rem]"
                >
                  {locLoading ? 'Searching…' : 'Search'}
                </button>
              </form>
              {location && (
                <div className="space-y-2 min-h-[280px]">
                  <LocationPicker
                    location={location}
                    onChange={async (loc) => {
                      setLocation(loc);
                      const addressStr = await applyReverseGeocode(loc.lat, loc.lon);
                      setLocQuery(addressStr);
                    }}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (location) {
                        const addressStr = await applyReverseGeocode(location.lat, location.lon);
                        setLocQuery(addressStr);
                        setDetails((prev) => ({
                          ...prev,
                          locationName: addressStr.trim() || prev.locationName
                        }));
                      }
                      setShowLocationScreen(false);
                    }}
                    className="w-full mt-3 py-3 rounded-xl bg-blue-900 text-white text-[10px] font-black uppercase tracking-widest transition hover:bg-blue-800 active:scale-[0.98]"
                  >
                    SAVE PIN LOCATION
                  </button>
                </div>
              )}
              {locError && <p className="text-[10px] text-red-600 font-bold">{locError}</p>}
            </div>
          </div>
        </div>
      )}

      {showNewClientModal && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px] animate-fade-in dark:bg-black/70"
          aria-modal="true"
          role="dialog"
          aria-labelledby="new-client-title"
          onClick={() => setShowNewClientModal(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl dark:bg-slate-900 dark:border dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-700">
              <h2 id="new-client-title" className="text-lg font-black text-blue-900 dark:text-blue-400">
                New company record
              </h2>
              <button
                type="button"
                onClick={() => setShowNewClientModal(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">Company name</label>
                <input
                  value={newClientDraft.companyName}
                  onChange={(e) => setNewClientDraft((d) => ({ ...d, companyName: e.target.value }))}
                  className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">Client name (contact person)</label>
                <input
                  value={newClientDraft.contactName}
                  onChange={(e) => setNewClientDraft((d) => ({ ...d, contactName: e.target.value }))}
                  placeholder="Full name of primary contact"
                  className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">Email</label>
                <input
                  type="email"
                  value={newClientDraft.contactEmail}
                  onChange={(e) => setNewClientDraft((d) => ({ ...d, contactEmail: e.target.value }))}
                  className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">Phone (11 digits)</label>
                <input
                  type="tel"
                  value={newClientDraft.contactPhone}
                  onChange={(e) =>
                    setNewClientDraft((d) => ({
                      ...d,
                      contactPhone: e.target.value.replace(/\D/g, '').slice(0, 11),
                    }))
                  }
                  maxLength={11}
                  className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">Notes (optional)</label>
                <textarea
                  value={newClientDraft.notes}
                  onChange={(e) => setNewClientDraft((d) => ({ ...d, notes: e.target.value }))}
                  rows={2}
                  className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewClientModal(false)}
                  className="flex-1 rounded-xl border-2 border-slate-200 py-3 text-[10px] font-black uppercase text-slate-600 dark:border-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitNewStoredClient}
                  className="flex-1 rounded-xl bg-blue-900 py-3 text-[10px] font-black uppercase text-white dark:bg-blue-700"
                >
                  Save client
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 
          FORM HEADER
          Purpose: Logical title and exit action for the technician.
      */}
      <div className="mb-6 flex shrink-0 items-center gap-4">
        {!(isAdmin && creationOnly) && (
          <button
            onClick={onBack}
            className="touch-target text-blue-900 dark:text-blue-400"
            aria-label="Go back to Dashboard"
          >
            <i className="fas fa-chevron-left text-xl"></i>
          </button>
        )}
        <h2 className="text-2xl font-black text-blue-900 dark:text-blue-400">Project Details</h2>
      </div>

      {isAdmin ? (
        <>
          <div className="mb-5 rounded-2xl border-2 border-blue-900/35 bg-gradient-to-br from-blue-50/90 via-white to-white p-4 shadow-sm ring-1 ring-blue-900/10 dark:border-blue-800/55 dark:from-blue-950/50 dark:via-slate-900 dark:to-slate-950 dark:ring-blue-900/25">
            <p className="mb-3 text-[10px] font-black uppercase tracking-wide text-blue-900 dark:text-blue-300">
              Select or add a client
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                id="company-select"
                value={selectedClientRecordId}
                onChange={(e) => handleStoredClientSelect(e.target.value)}
                className="h-[3.125rem] rounded-xl border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase text-slate-700 focus:outline-none focus:border-blue-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 sm:w-1/2"
              >
                <option value="">Pick a saved client</option>
                {storedClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleOpenNewClientModal}
                className="h-[3.125rem] rounded-xl border-2 border-blue-900 bg-blue-900/[0.06] px-4 text-[10px] font-black uppercase tracking-wide text-blue-900 transition hover:bg-blue-900/10 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/35 sm:w-1/2"
              >
                Add New Client
              </button>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="company-name-input" className="mb-1 ml-1 block text-[10px] font-bold uppercase text-slate-400">
                Company Name
              </label>
              <div className="relative">
                <input
                  id="company-name-input"
                  autoComplete="organization"
                  className={`${standardTextInputClass} ${showErrors && details.clientName.trim() === '' ? 'border-red-500' : 'border-slate-100 focus:border-blue-900'}`}
                  value={details.clientName}
                  onChange={(e) => handleCompanyNameInputChange(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => startVoiceInput('clientName')}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 touch-target transition ${activeVoiceField === 'clientName' ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-blue-900'}`}
                  aria-label="Use voice for company name"
                >
                  <i className="fas fa-microphone"></i>
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="proj-name" className="mb-1 ml-1 block text-[10px] font-bold uppercase text-slate-400">Project Name</label>
              <div className="relative">
                <input
                  id="proj-name"
                  autoComplete="off"
                  className={`${standardTextInputClass} ${showErrors && details.name.trim() === '' ? 'border-red-500' : 'border-slate-100 focus:border-blue-900'}`}
                  value={details.name}
                  onChange={(e) => setDetails((prev) => ({ ...prev, name: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => startVoiceInput('name')}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 touch-target transition ${activeVoiceField === 'name' ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-blue-900'}`}
                  aria-label="Use voice for project name"
                >
                  <i className="fas fa-microphone"></i>
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="client-email" className="mb-1 ml-1 block text-[10px] font-bold uppercase text-slate-400">
                Client Email
              </label>
              <div className="relative">
                <input
                  id="client-email"
                  type="email"
                  autoComplete="email"
                  className={`${standardTextInputClass} ${showErrors && (!details.clientEmail.trim() || !isValidEmailFormat(details.clientEmail)) ? 'border-red-500' : 'border-slate-100 focus:border-blue-900'}`}
                  value={details.clientEmail}
                  onChange={(e) => setDetails((prev) => ({ ...prev, clientEmail: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => startVoiceInput('clientEmail')}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 touch-target transition ${activeVoiceField === 'clientEmail' ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-blue-900'}`}
                  aria-label="Use voice for client email"
                >
                  <i className="fas fa-microphone"></i>
                </button>
              </div>
            </div>
            <div>
              <div className="mb-1 ml-1 flex items-center justify-between">
                <label htmlFor="client-contact" className="block text-[10px] font-bold uppercase text-slate-400">
                  Client Contact Number
                </label>
                <span
                  className={`text-[9px] font-black ${details.clientContact.length === 11 ? 'text-green-600' : 'text-red-600'}`}
                  aria-live="polite"
                >
                  {details.clientContact.length}/11
                </span>
              </div>
              <div className="relative">
                <input
                  id="client-contact"
                  type="tel"
                  autoComplete="off"
                  maxLength={11}
                  className={`${standardTextInputClass} ${showErrors && (details.clientContact.trim() === '' || details.clientContact.length !== 11) ? 'border-red-500' : 'border-slate-100 focus:border-blue-900'}`}
                  value={details.clientContact}
                  onChange={handleContactChange}
                />
                <button
                  type="button"
                  onClick={() => startVoiceInput('clientContact')}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 touch-target transition ${activeVoiceField === 'clientContact' ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-blue-900'}`}
                  aria-label="Use voice for contact number"
                >
                  <i className="fas fa-microphone"></i>
                </button>
              </div>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="client-contact-person" className="mb-1 ml-1 block text-[10px] font-bold uppercase text-slate-400">
                Contact Person
              </label>
              <div className="relative">
                <input
                  id="client-contact-person"
                  autoComplete="name"
                  className={`${standardTextInputClass} ${showErrors && details.clientContactName.trim() === '' ? 'border-red-500' : 'border-slate-100 focus:border-blue-900'}`}
                  value={details.clientContactName}
                  onChange={(e) => setDetails((prev) => ({ ...prev, clientContactName: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => startVoiceInput('clientContactName')}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 touch-target transition ${activeVoiceField === 'clientContactName' ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-blue-900'}`}
                  aria-label="Use voice for client name"
                >
                  <i className="fas fa-microphone"></i>
                </button>
              </div>
            </div>
            <div className="md:col-span-2 rounded-2xl border-2 border-slate-100 p-4 dark:border-slate-700">
              <p className={`mb-2 text-[10px] font-black uppercase tracking-wide ${showErrors && selectedProjectSurveys.length === 0 ? 'text-red-600' : 'text-slate-400'}`}>
                Systems to Survey
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ALL_SURVEY_TYPES_ORDERED.map((st) => (
                  <label
                    key={st}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={selectedProjectSurveys.includes(st)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedProjectSurveys((prev) => {
                          if (checked) return prev.includes(st) ? prev : [...prev, st];
                          return prev.filter((x) => x !== st);
                        });
                        setTechnicianSurveyAssignments((assignPrev) => {
                          const next: Record<string, SurveyType[]> = { ...assignPrev };
                          for (const key of Object.keys(next)) {
                            next[key] = checked
                              ? next[key] ?? []
                              : (next[key] || []).filter((x) => x !== st);
                          }
                          return next;
                        });
                      }}
                    />
                    {SURVEY_DISPLAY[st].label}
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 rounded-2xl border-2 border-slate-100 p-4 dark:border-slate-700">
              <p className="text-[10px] font-medium text-slate-400">
                Building details will be filled by the technician on site.
              </p>
            </div>
            <div className="md:col-span-2">
              <div className="flex items-end gap-3">
                <div className="w-3/4 min-w-0">
                  <label className="mb-1 ml-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Location Name</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={details.locationName}
                      onChange={(e) => setDetails((prev) => ({ ...prev, locationName: e.target.value }))}
                      className={`${standardTextInputClass} ${showErrors && details.locationName.trim() === '' ? 'border-red-500' : 'border-slate-100 focus:border-blue-900'}`}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => startVoiceInput('locationName')}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 touch-target transition ${activeVoiceField === 'locationName' ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-blue-900'}`}
                      aria-label="Use voice for project location name"
                    >
                      <i className="fas fa-microphone"></i>
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openLocationScreen}
                  className="w-1/4 shrink-0 h-[3.125rem] inline-flex items-center justify-center gap-1.5 px-2 rounded-xl border-2 border-slate-200 text-[10px] font-bold text-slate-700 hover:bg-slate-50 transition"
                >
                  <i className="fas fa-map-marker-alt text-blue-900 shrink-0"></i>
                  <span className="truncate">PIN LOCATION</span>
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 ml-1 block text-[10px] font-bold uppercase text-slate-400">Project Start Date</label>
              <input
                type="date"
                value={details.startDate}
                onChange={(e) => setDetails((prev) => ({ ...prev, startDate: e.target.value }))}
                className={`w-full bg-slate-50 border-2 px-4 py-3 rounded-xl text-slate-900 focus:outline-none transition font-bold text-xs ${showErrors && details.startDate.trim() === '' ? 'border-red-500' : 'border-slate-100 focus:border-blue-900'}`}
              />
            </div>
            <div>
              <label className="mb-1 ml-1 block text-[10px] font-bold uppercase text-slate-400">Number of Technicians</label>
              <input
                type="number"
                min={1}
                value={details.requiredTechnicians}
                onChange={(e) => setDetails((prev) => ({ ...prev, requiredTechnicians: Math.max(1, Number(e.target.value) || 1) }))}
                className={`w-full bg-slate-50 border-2 px-4 py-3 rounded-xl text-slate-900 focus:outline-none transition font-bold text-xs dark:bg-slate-900 dark:text-slate-100 ${showErrors && details.requiredTechnicians < 1 ? 'border-red-500' : 'border-slate-100 focus:border-blue-900'}`}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 ml-1 block text-[10px] font-bold uppercase text-slate-400">Manpower Assignment</label>
              <div className="flex gap-2">
                <select
                  value={selectedTechnicianEmail}
                  onChange={(e) => setSelectedTechnicianEmail(e.target.value)}
                  className="flex-1 bg-slate-50 border-2 border-slate-100 px-3 py-3 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-900 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Select technician</option>
                  {availableTechnicians.map((tech) => (
                    <option key={tech.email} value={tech.email}>
                      {tech.fullName} ({tech.email}){tech.role ? ` - ${tech.role}` : ''}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedProjectTechnicianRole}
                  onChange={(e) => setSelectedProjectTechnicianRole(e.target.value as ProjectTechnicianRole)}
                  className="w-[11.5rem] bg-slate-50 border-2 border-slate-100 px-3 py-3 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-900 dark:bg-slate-900 dark:text-slate-100"
                  aria-label="Project role for selected technician"
                >
                  {PROJECT_TECHNICIAN_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const pick = availableTechnicians.find((t) => t.email === selectedTechnicianEmail);
                    if (!pick) return;
                    if (details.assignedTechnicians.some((t) => t.email === pick.email)) return;
                    if (details.assignedTechnicians.length >= details.requiredTechnicians) return;
                    const roleFromTech = (pick.role || '').trim();
                    const assignedRole = roleFromTech || selectedProjectTechnicianRole;
                    const key = pick.email.toLowerCase();
                    setDetails((prev) => ({
                      ...prev,
                      assignedTechnicians: [...prev.assignedTechnicians, { ...pick, role: assignedRole }],
                    }));
                    setTechnicianSurveyAssignments((prev) => ({
                      ...prev,
                      [key]: selectedProjectSurveys.length ? [...selectedProjectSurveys] : [],
                    }));
                    setSelectedTechnicianEmail('');
                  }}
                  className="px-4 rounded-xl bg-blue-900 text-white text-[10px] font-black uppercase"
                >
                  Add
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {details.assignedTechnicians.map((tech) => {
                  const key = tech.email.toLowerCase();
                  const surveysForTech = technicianSurveyAssignments[key] ?? [];
                  return (
                    <div
                      key={tech.email}
                      className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-[10px] font-black uppercase text-blue-900 dark:text-blue-300">{tech.fullName}</span>
                          <p className="truncate text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                            {tech.role || 'Field Technician'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setDetails((prev) => ({
                              ...prev,
                              assignedTechnicians: prev.assignedTechnicians.filter((t) => t.email !== tech.email),
                            }));
                            setTechnicianSurveyAssignments((prev) => {
                              const next = { ...prev };
                              delete next[key];
                              return next;
                            });
                          }}
                          className="text-blue-700 dark:text-blue-400"
                          aria-label={`Remove ${tech.fullName}`}
                        >
                          <i className="fas fa-times" aria-hidden="true"></i>
                        </button>
                      </div>
                      <p className="mt-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">Surveys for this technician</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {selectedProjectSurveys.length === 0 ? (
                          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
                            Select project survey scope first.
                          </span>
                        ) : (
                          selectedProjectSurveys.map((st) => (
                            <label
                              key={`${tech.email}-${st}`}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                            >
                              <input
                                type="checkbox"
                                className="h-3 w-3 rounded border-slate-300"
                                checked={surveysForTech.includes(st)}
                                onChange={(e) => {
                                  setTechnicianSurveyAssignments((prev) => {
                                    const cur = new Set(prev[key] ?? []);
                                    if (e.target.checked) cur.add(st);
                                    else cur.delete(st);
                                    return { ...prev, [key]: Array.from(cur) };
                                  });
                                }}
                              />
                              {SURVEY_DISPLAY[st].label}
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {showErrors && details.assignedTechnicians.length < details.requiredTechnicians && (
                <p className="text-[9px] text-red-500 font-black mt-2 uppercase tracking-widest">
                  Assign technicians equal to required manpower
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="mb-5 rounded-2xl border-2 border-blue-900/25 bg-blue-50/40 p-4 shadow-sm ring-1 ring-blue-900/10 dark:border-blue-800/40 dark:bg-blue-950/25 dark:ring-blue-900/20">
          <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-blue-900 dark:text-blue-300">
            Project &amp; client (view only)
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-400">Company Name</p>
              <div className={`${standardTextInputClass} border-slate-100`}>{details.clientName || '—'}</div>
            </div>
            <div>
              <p className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-400">Project Name</p>
              <div className={`${standardTextInputClass} border-slate-100`}>{details.name || '—'}</div>
            </div>
            <div>
              <p className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-400">Client Email</p>
              <div className={`${standardTextInputClass} border-slate-100`}>{details.clientEmail || '—'}</div>
            </div>
            <div>
              <p className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-400">Client Contact Number</p>
              <div className={`${standardTextInputClass} border-slate-100`}>{details.clientContact || '—'}</div>
            </div>
            <div className="md:col-span-2">
              <p className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-400">Client Name (Contact Person)</p>
              <div className={`${standardTextInputClass} border-slate-100`}>{details.clientContactName || '—'}</div>
            </div>
            <div className="md:col-span-2 rounded-2xl border-2 border-slate-100 p-4 dark:border-slate-700">
              <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">
                Project Survey Scope
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ALL_SURVEY_TYPES_ORDERED.map((st) => (
                  <label
                    key={st}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={technicianAllowedSurveys.includes(st)}
                      disabled
                      readOnly
                    />
                    {SURVEY_DISPLAY[st].label}
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 rounded-2xl border-2 border-slate-100 p-4 dark:border-slate-700">
              <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">
                Shared Building Information
              </p>
              <div className="grid grid-cols-2 gap-3 text-[10px] font-bold text-slate-700">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                  <p className="text-[9px] uppercase text-slate-400">Type</p>
                  <p>{initialData?.buildingInfo?.type || '—'}{initialData?.buildingInfo?.otherType ? ` (${initialData.buildingInfo.otherType})` : ''}</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                  <p className="text-[9px] uppercase text-slate-400">Floors</p>
                  <p>{initialData?.buildingInfo?.floors ?? '—'}</p>
                </div>
                <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                  <p className="text-[9px] uppercase text-slate-400">Site Status</p>
                  <p>
                    {initialData?.buildingInfo
                      ? initialData.buildingInfo.isNew
                        ? 'New Build'
                        : 'Existing / Retrofit'
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
            <div className="md:col-span-2">
              <p className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-400">Date</p>
              <div className={`${standardTextInputClass} border-slate-100`}>{details.startDate || '—'}</div>
            </div>
            <div className="md:col-span-2">
              <p className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-400">Project Location</p>
              <div className={`${standardTextInputClass} border-slate-100`}>
                {details.locationName || details.location || '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 
          PRIMARY CTA: Select Survey System
          Purpose: Validates the form and reveals the domain selection modal.
          Usage: The gateway from "Administrative data" to "Technical audit data".
          Behavior: Visually disabled if 'isFormComplete' is false, but functionally triggers validation error display.
      */}
      <div className="pt-4 shrink-0">
        <button 
          onClick={handleProceedAttempt}
          className={`w-full p-10 rounded-[2rem] flex flex-col items-center justify-center gap-2 transition-all shadow-xl active:scale-95 ${isFormComplete ? 'bg-blue-900 text-white border-2 border-blue-900 shadow-blue-900/20' : 'bg-slate-200 text-slate-400 border-2 border-slate-200 shadow-none'}`}
          aria-haspopup="dialog"
        >
          <i className={`${creationOnly ? 'fas fa-plus-circle' : isAdmin ? 'fas fa-plus-circle' : 'fas fa-clipboard-check'} text-2xl`} aria-hidden="true"></i>
          <span className="font-black text-lg uppercase tracking-tight">
            {creationOnly ? 'SAVE & ASSIGN PROJECT' : isAdmin ? 'SELECT SURVEY SYSTEM' : 'BEGIN SITE AUDIT'}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
            {creationOnly ? 'Setup for technician execution' : isAdmin ? 'Choose a system to open' : 'Open only your assigned surveys'}
          </span>
        </button>
        {showErrors && !isFormComplete && (
          <p className="text-[9px] text-red-500 font-black text-center mt-3 uppercase tracking-widest animate-pulse">
            Complete highlighted fields to proceed
          </p>
        )}
      </div>

      {/* 
          MODAL: SYSTEM CHOICE
          Purpose: Forces the technician to explicitly choose which technology system they are auditing first.
      */}
      {!creationOnly && showSurveyModal && (
        <div className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4 md:p-8 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="bg-white w-full max-w-sm md:max-w-4xl md:max-h-[90vh] rounded-[2.5rem] shadow-2xl overflow-hidden animate-fade-in flex flex-col">
            <div className="p-6 md:p-8 bg-white text-blue-900 flex justify-between items-center shrink-0 border-b border-slate-100">
              <h3 id="modal-title" className="font-black uppercase tracking-widest text-xs md:text-sm">Choose System to Audit</h3>
              <button onClick={() => setShowSurveyModal(false)} className="text-slate-400 hover:text-blue-900 transition touch-target" aria-label="Close modal">
                <i className="fas fa-times text-lg"></i>
              </button>
            </div>
            
            {/* 
                SCROLLABLE LIST: System Options
                Logic: Maps over predefined system categories. Clicking a button triggers the handleSelect logic.
            */}
            <div className="p-6 md:p-8 grid grid-cols-2 gap-3 md:gap-4 overflow-y-auto max-h-[70vh] md:max-h-[65vh]">
              {SURVEY_MODAL_ITEMS.filter((item) => technicianAllowedSurveys.includes(item.type)).length ===
              0 ? (
                <div className="col-span-2 rounded-2xl border-2 border-amber-100 bg-amber-50/80 p-6 text-center dark:border-amber-900/40 dark:bg-amber-950/30">
                  <p className="text-sm font-black uppercase text-amber-900 dark:text-amber-200">
                    No surveys available
                  </p>
                  <p className="mt-2 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                    You do not have any survey tasks assigned on this project. Contact Sales or Admin.
                  </p>
                </div>
              ) : (
                SURVEY_MODAL_ITEMS.filter((item) => technicianAllowedSurveys.includes(item.type)).map((item) => {
                  const isCompleted = completedSurveyTypes.includes(item.type);
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => handleSelect(item.type)}
                      className={`w-full p-5 md:p-6 rounded-2xl flex items-center justify-between border-2 transition-all active:scale-95 group shadow-sm dark:bg-slate-900 ${
                        isCompleted
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-800 hover:border-emerald-500 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/40'
                          : 'border-blue-900/10 bg-white text-blue-900 hover:border-blue-900 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="text-left">
                        <p className="font-black text-lg md:text-xl uppercase leading-none">{item.label}</p>
                        <p className={`text-[10px] md:text-xs font-bold mt-1 ${isCompleted ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                          {isCompleted ? 'Completed audit' : item.desc}
                        </p>
                      </div>
                      <i
                        className={`fas ${isCompleted ? 'fa-check-circle' : item.icon} text-2xl md:text-3xl transition-opacity ${
                          isCompleted ? 'opacity-70' : 'opacity-10 group-hover:opacity-30'
                        }`}
                        aria-hidden="true"
                      ></i>
                    </button>
                  );
                })
              )}
            </div>
            
            {/* DISMISS ACTION: Close modal and return to metadata form */}
            <div className="p-4 md:p-6 bg-slate-50 border-t border-slate-100 text-center shrink-0">
               <button 
                onClick={() => setShowSurveyModal(false)}
                className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.2em] hover:text-blue-900 transition py-2 px-4"
               >
                 Cancel Selection
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDetails;