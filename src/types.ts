/**
 * CORE DATA TYPES FOR AA2000 SITE SURVEY APP
 */

export enum SurveyType {
  CCTV = 'CCTV',
  FIRE_ALARM = 'Fire Alarm',
  ACCESS_CONTROL = 'Access Control',
  BURGLAR_ALARM = 'Burglar Alarm',
  FIRE_PROTECTION = 'Fire Protection',
  OTHER = 'Other'
}

export const PROJECT_STATUS_DISPLAY: Record<string, string> = {
  'In Progress': 'In Progress',
  'Pending Review': 'Pending Review',
  'Rejected': 'Rejected',
  'Finalized': 'Approved',
  'Completed': 'Completed',
  'Finalized - Approved': 'Approved',
  'Finalized - Rejected': 'Rejected',
};

export type FinalizationOutcome = 'APPROVED' | 'REJECTED';

export interface FinalizationActionLog {
  id: string;
  outcome: FinalizationOutcome;
  reason?: string;
  actedAt: string;
  actedByRole: 'Admin' | 'Sales';
  actedByName?: string;
}

export interface ProjectFinalizationInfo {
  outcome: FinalizationOutcome;
  reason?: string;
  actedAt: string;
  actedByRole: 'Admin' | 'Sales';
  actedByName?: string;
}

/** Stored client directory entry (Sales/Admin); technicians never see full records in UI. */
export interface StoredClient {
  id: string;
  companyName: string;
  contactName?: string;
  contactEmail: string;
  contactPhone: string;
  /** Optional site or billing notes; admin-only in UI. */
  notes?: string;
  location?: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  /** Company / organization name (links to client directory when `clientRecordId` is set). */
  clientName: string;
  /** Individual contact person at the client (full name). */
  clientContactName?: string;
  clientEmail: string;
  clientContact: string;
  location: string;
  /** When set, project metadata was loaded from a stored client record. */
  clientRecordId?: string;
  /** Surveys in scope for this project (chosen by Admin/Sales). */
  projectSurveyTypes?: SurveyType[];
  /** Boolean flags aligned with canonical survey order for backend/storage compatibility. */
  projectSurveySelections?: boolean[];
  /**
   * Per-technician survey tasks (email key, lowercased). Subset of projectSurveyTypes.
   * When missing, legacy projects treat full scope as available to every assignee.
   */
  technicianSurveyAssignments?: Record<string, SurveyType[]>;
  /** User-defined name for the project location (e.g. "Main Office", "Site A"). */
  locationName?: string;
  /** Shared building profile used across all survey systems in the project. */
  buildingInfo?: {
    type: string;
    otherType?: string;
    floors: number;
    isNew: boolean;
  };
  /** Project schedule start date (YYYY-MM-DD). */
  startDate?: string;
  /** Project schedule end date (YYYY-MM-DD). */
  endDate?: string;
  /** Assigned technicians for this project. */
  assignedTechnicians?: Array<{ fullName: string; email: string; role?: string }>;
  /** Response per assigned technician email: ACCEPTED or DECLINED. */
  technicianResponses?: Record<string, 'ACCEPTED' | 'DECLINED'>;
  /** Required manpower count assigned during project setup. */
  requiredTechnicians?: number;
  /** Completion audit trail when technician marks a project as done. */
  completedAt?: string;
  /** Technician display name who completed the project. */
  completedBy?: string;
  status:
    | 'In Progress'
    | 'Pending Review'
    | 'Rejected'
    | 'Finalized'
    | 'Completed'
    | 'Finalized - Approved'
    | 'Finalized - Rejected';
  /** Latest finalization decision details from Sales/Admin. */
  finalization?: ProjectFinalizationInfo;
  /** Immutable-style audit log of finalization actions. */
  finalizationAuditTrail?: FinalizationActionLog[];
  technicianName: string;
  date: string;
}

/** Single manpower entry for estimation phase effort (role, count, hours). */
export interface EstimationManpowerEntry {
  id: string;
  role: string;
  count: number;
  hours: number;
}

/** Single consumable entry for estimation materials. */
export interface EstimationConsumableEntry {
  id: string;
  name: string;
  category: string;
  qty: number;
  unitPrice?: number;
}

/** Single additional fee line item for estimation (e.g. Travel Fee). */
export interface EstimationAdditionalFeeEntry {
  id: string;
  type: string;
  amount: number;
}

/** Stored per survey type when finalizing; includes optional breakdown for edit reload. */
export interface EstimationDetail {
  days: number;
  techs: number;
  manpowerBreakdown?: EstimationManpowerEntry[];
  consumablesList?: EstimationConsumableEntry[];
  additionalFees?: EstimationAdditionalFeeEntry[];
  /** Summary strings from Site Constraints (Physical, Electrical, Installation) for detailed audit. */
  siteConstraintPhysical?: string;
  siteConstraintElectrical?: string;
  siteConstraintInstallation?: string;
}

export interface CameraEntry {
  id: string;
  locationName: string;
  purposes: string[];
  type: 'Dome' | 'Bullet' | 'PTZ' | 'Fisheye';
  resolution: string;
  lightingCondition: 'Good Lighting' | 'Low Light' | 'No Light';
  environment: 'Indoor' | 'Outdoor';
  mountingHeight: number;
  /** Viewing/coverage distance in meters (how far the camera needs to cover). */
  coverageDistanceMeters?: number;
  /** Scope status: same options as Fire Protection survey. */
  scopeStatus: 'New Installation' | 'Expansion' | 'Replacement' | '';
  cableType: 'Cat5e' | 'Cat6' | 'Cat6a' | 'Fiber' | 'Coaxial' | 'Other';
  otherCableType?: string;
  cableLength: number;
}

export interface RoomEntry {
  id: string;
  name: string;
  length: number;
  width: number;
  area: number;
}

export interface BuildingMeasurements {
  method: 'PLAN_UPLOAD' | 'MANUAL_ROOMS';
  planImage?: string;
  /** Multiple floor plan files (e.g. one per floor). AI analyzes all. */
  planImages?: string[];
  planScale?: {
    knownDimensionMeters: number;
    /** AI-detected reference length from the plan (meters). */
    detectedReferenceMeters?: number;
    /** User-entered drawing/reference length (centimeters). */
    referenceLengthCm?: number;
    /** User-confirmed real-world measurement (meters). */
    confirmedMeasurementMeters?: number;
    /** Computed scale from drawing centimeters to meters. */
    scaleMetersPerCm?: number;
    /** User confirmed the calibration values. */
    calibrationConfirmed?: boolean;
    /** Optional scaled layout lengths derived from existing elements. */
    appliedLayoutElements?: Array<{
      id: string;
      name: string;
      rawLengthCm: number;
      scaledLengthM: number;
    }>;
  };
  rooms: RoomEntry[];
  totalArea: number;
}

export interface CCTVSurveyData {
  buildingInfo: {
    type: string;
    otherType?: string;
    floors: number;
    isNew: boolean;
  };
  measurements?: BuildingMeasurements;
  cameras: CameraEntry[];
  infrastructure: {
    cablePath: 'Ceiling' | 'Trunking' | 'Open Cable' | 'Other' | '';
    otherCablePath?: string;
    wallType: 'Concrete' | 'Gypsum' | 'Glass' | 'Steel' | 'Brick' | 'Other' | '';
    otherWallType?: string;
    coreDrilling: boolean;
  };
  controlRoom: {
    nvrLocation: string;
    /** Estimated storage requirement in TB for NVR recording. */
    storageRequirementTB?: number;
    /** Recording retention in days (e.g. 7, 14, 30, 90). */
    retentionDays?: number;
    rackAvailable?: boolean;
    powerSocketAvailable?: boolean;
    upsRequired?: boolean;
    networkSwitchAvailable?: boolean;
    internetAvailable?: boolean;
  };
}

export interface DetectionDevice {
  type: 'Smoke' | 'Heat' | 'Flame' | 'Gas' | 'Multi-sensor' | 'Other';
  /** When type === 'Other', the user-specified detector type label. */
  otherType?: string;
  count: number;
}

export interface DetectionArea {
  id: string;
  name: string;
  devices: DetectionDevice[];
  image?: string;
  ceilingType?: string;
  ceilingHeight?: number;
  notificationAppliance?: string;
  audibilityRequirement?: string;
  notificationQty?: number;
  existingSystemStatus?: string;
}

export interface FireAlarmSurveyData {
  buildingInfo: {
    type: string;
    otherType?: string;
    floors: number;
    isNew: boolean;
  };
  measurements?: BuildingMeasurements;
  systemType: 'Conventional' | 'Addressable' | 'Wireless' | '';
  integrations: string[];
  detectionAreas: DetectionArea[];
  notification: {
    mcpRequired: boolean;
    mcpCount: number;
    devices: string[];
    deviceCount: number;
  };
  infrastructure: {
    cableType: string;
    otherCableType?: string;
    cableLength: number;
    routing: string;
    otherRouting?: string;
    wallType: 'Concrete' | 'Gypsum' | 'Brick' | 'Steel' | '';
    coreDrilling: boolean;
  };
  controlPanel: {
    location: string;
    rackAvailable?: boolean;
    powerAvailable?: boolean;
    upsRequired?: boolean;
    networkRequired?: boolean;
  };
}

/** One saved "Fire Protection" entry (protection area + scope + suppression/sprinkler details). */
export interface FireProtectionUnit {
  id: string;
  protectionArea?: string;
  otherProtectionArea?: string;
  hazardClassification?: string;
  scope: FireProtectionSurveyData['scope'];
  alarmCore: FireProtectionSurveyData['alarmCore'];
  suppression: FireProtectionSurveyData['suppression'];
  sprinkler: FireProtectionSurveyData['sprinkler'];
  siteImage?: string;
  siteConstraints: FireProtectionSurveyData['siteConstraints'];
  buildingInfoArea: number;
  fireExtinguisher?: FireProtectionSurveyData['fireExtinguisher'];
  fireHoseReel?: FireProtectionSurveyData['fireHoseReel'];
  fireBlanket?: FireProtectionSurveyData['fireBlanket'];
  emergencyLighting?: FireProtectionSurveyData['emergencyLighting'];
  exitEvacuation?: FireProtectionSurveyData['exitEvacuation'];
}

export interface FireProtectionSurveyData {
  /** List of saved protection units (Details step). */
  protectionUnits?: FireProtectionUnit[];
  buildingInfo: {
    type: string;
    otherType?: string;
    floors: number;
    area: number;
    isNew: boolean;
  };
  measurements?: BuildingMeasurements;
  siteImage?: string;
  protectionArea?: string;
  otherProtectionArea?: string;
  hazardClassification?: string;
  scope: {
    systems: ('Fire Alarm' | 'Suppression' | 'Sprinkler' | 'Portable')[];
    status: 'New Installation' | 'Expansion' | 'Replacement' | '';
  };
  alarmCore: {
    type: 'Addressable' | 'Conventional' | '';
    panelLocation: string;
    powerAvailable?: boolean;
    batteryRequired?: boolean;
    smokeCount: number;
    heatCount: number;
    mcpCount: number;
    notifCount: number;
  };
  zoning: {
    zones: number;
    highRiskAreas: ('Electrical' | 'Server' | 'Kitchen' | 'Warehouse')[];
  };
  infrastructure: {
    cableType: 'Fire-rated' | 'Standard' | '';
    cableLength: number;
    conduitsExist?: boolean;
  };
  suppression: {
    type: 'ABC' | 'CO2' | 'K-Type' | '';
    qty: number;
    locationIdentified?: boolean;
    coverageType?: string;
    cylinderLocAvailable?: boolean;
    nozzleCount: number;
    sealingCondition?: string;
  };
  sprinkler: {
    coverageArea: number;
    waterSource: string;
    otherWaterSource?: string;
    pumpRoomAvailable?: boolean;
    existingStatus?: string;
    headType?: string;
    tempRating?: string;
    pipeMaterial?: string;
    otherPipeMaterial?: string;
    pipeRouting?: string;
    pipeLength?: number;
  };
  integration: {
    systems: ('CCTV' | 'Access Control')[];
    bfpCompliance?: boolean;
  };
  siteConstraints: {
    ceilingHeight: number;
    ceilingType: 'Concrete' | 'Gypsum' | 'Glass' | 'Steel' | 'Brick' | 'Other' | '';
    otherCeilingType?: string;
    isOccupied?: boolean;
  };
  controlRoom?: {
    name: string;
    floorLevel: string;
    distanceToArea: number;
    panelInstalled?: 'Yes' | 'No' | 'Existing';
    panelType?: 'Dedicated suppression panel' | 'Integrated with FACP';
    releaseMethod?: 'Automatic' | 'Manual' | 'Combined';
    powerSupplyAvailable?: boolean;
    upsBackupProvided?: boolean;
  };
  /** Portable fire extinguishers */
  fireExtinguisher?: {
    type: 'ABC' | 'CO2' | 'Water' | 'Foam' | 'K-Class' | 'Other' | '';
    otherType?: string;
    quantity: number;
    capacity: '2.5 kg' | '5 kg' | '6 kg' | '9 L' | '20 L' | 'Other' | '';
    otherCapacity?: string;
    mountingType: 'Wall-mounted' | 'Cabinet' | 'Stand' | '';
    lastServiceDate?: string;
    bfpCompliant?: boolean;
  };
  /** Fire hose / hose reels */
  fireHoseReel?: {
    quantity: number;
    hoseLengthM: number;
    nozzleType: 'Jet' | 'Spray' | 'Jet/Spray' | 'Fog' | 'Straight stream' | 'Other' | '';
    otherNozzleType?: string;
  };
  /** Fire blankets */
  fireBlanket?: {
    quantity: number;
    locations?: string;
  };
  /** Emergency lighting */
  emergencyLighting?: {
    present: boolean;
    type?: 'Maintained' | 'Non-maintained' | '';
  };
  /** Exit / evacuation */
  exitEvacuation?: {
    exitSignsQuantity: number;
    evacuationLightingPresent: boolean;
  };
}

export interface OtherSurveyData {
  buildingInfo: {
    type: string;
    otherType?: string;
    floors: number;
    isNew: boolean;
  };
  measurements?: BuildingMeasurements;
  siteImage?: string;
  systemCategory?: string;
  otherSystemCategory?: string;
  scopeOfWork?: string;
  otherScopeOfWork?: string;
  coverageArea?: string;
  otherCoverageArea?: string;
  /** Per-system answers captured from dynamic system-specific question prompts. */
  systemSpecificAnswers?: Record<string, string>;
  serviceDetails: string;
  /** Optional mapping to company price-list line for custom systems. */
  selectedProductLine?: string;
  selectedProductModel?: string;
  /** Set when the animated intercom estimation modal was saved into this survey. */
  intercomEstimationSurveyApplied?: boolean;
  technicalSpecs?: {
    intercom?: {
      typeOfIntercom: 'Audio' | 'Video' | 'IP-based' | '';
      numberOfMasterStations: number;
      numberOfSubstations: number;
      communicationRangeM: number;
      connectivityType: 'Wired' | 'Wireless' | 'IP' | '';
      powerRequirement: '220V AC' | 'Low Voltage' | 'PoE' | 'Other' | '';
      stableInternetAvailable?: boolean;
      installationAreas: Array<'Guardhouse' | 'Office' | 'Units' | 'Others'>;
      /** Free-form labels from the intercom service estimation survey modal. */
      installationAreaLabels?: string[];
      distanceBetweenDevicesM: number;
      cablePathAvailability: 'Existing' | 'Needs Installation' | '';
      mountingType: 'Wall' | 'Desk' | 'Post' | '';
      obstructionsPresent?: boolean;
      obstructionDescription: string;
      /** Materials named in the modal (Walls / Metal / Glass). */
      obstructionMaterialTypes?: string[];
      environmentalCondition: 'Indoor' | 'Outdoor' | 'Mixed' | 'Dust' | 'Heat' | '';
      autoCalculateMaterials?: boolean;
      materialMasterUnitQty: number;
      materialSubstationsQty: number;
      materialCableLengthM: number;
      materialPvcConduitsM: number;
      materialJunctionBoxesQty: number;
      materialAccessories: string;
      installationDuration: '1 day' | '2 days' | '3+ days' | '';
      numberOfTechnicians: number;
      laborScopeOfWork: Array<'Installation' | 'Cabling' | 'Testing' | 'Configuration'>;
      materialCost: number;
      laborCost: number;
      observations: string;
      recommendations: string;
      intercomProductBrand?: string;
      intercomProductCode?: string;
      intercomPriceTier?: string;
      intercomScopeSelections?: string[];
      intercomOtherScope?: string;
      buildingSiteName?: string;
      floorsCovered?: string;
      zonesDepartments?: string;
      coverageNotesIntercom?: string;
    };
    /** Turnstile site survey — stored for estimation / submission */
    turnstile?: {
      turnstileType: 'Tripod' | 'Half-Height' | 'Full-Height' | 'Speed Gate/Flap Barrier' | '';
      numberOfUnits: number;
      installation: 'Indoor' | 'Outdoor' | '';
      integrateWithAccessControl?: boolean;
      accessControlTypes: Array<'RFID Card' | 'Biometric (Fingerprint/Face)' | 'QR Code/Barcode'>;
      requiredDirection: 'One-way' | 'Two-way' | '';
      installationArea: 'Entrance/Exit' | 'Lobby' | 'Perimeter/Outdoor' | '';
      floorCondition: 'Concrete' | 'Tiles' | 'Raised Flooring' | '';
      widthM: number;
      lengthM: number;
      powerSupply: '220V AC' | 'Others (specify)' | '';
      powerOtherSpecify?: string;
      distanceFromPowerM: number;
      networkRequirement: 'LAN' | 'WiFi' | 'None' | '';
      emergencyMode?: boolean;
      fireAlarmIntegration?: boolean;
      antiTailgating?: boolean;
      ledIndicatorsAlarm?: boolean;
      exposure: 'Indoor' | 'Outdoor' | '';
      weatherConditions: Array<'Rain' | 'Heat' | 'Dust Exposure'>;
      footTraffic: 'Low' | 'Medium' | 'High' | '';
      specialInstructions: string;
      preferredBrandSpecs: string;
    };
    /** Boom barrier site survey — stored for estimation / submission */
    boomBarrier?: {
      barrierType: 'Automatic Boom Barrier' | 'Manual Boom Barrier' | '';
      numberOfUnits: number;
      installationType: 'Entry' | 'Exit' | 'Both' | '';
      armLengthM: number;
      armType: 'Straight Arm' | 'Folding Arm' | 'Fence Arm' | '';
      openingDirection: 'Left' | 'Right' | '';
      speedRequirement: 'Standard' | 'Fast' | '';
      integrateWithAccessControl?: boolean;
      accessControlTypes: Array<'RFID Card' | 'License Plate Recognition (LPR)' | 'Remote Control' | 'Push Button'>;
      loopDetectorRequired?: boolean;
      installationArea: 'Parking Entrance' | 'Roadway' | 'Private Property' | '';
      roadWidthM: number;
      surfaceCondition: 'Concrete' | 'Asphalt' | 'Uneven Surface' | '';
      mountingSurfaceAvailability: 'With Concrete Foundation' | 'Needs Civil Works' | '';
      powerSupply: '220V AC' | 'Others (specify)' | '';
      powerOtherSpecify?: string;
      distanceFromPowerM: number;
      networkRequirement: 'LAN' | 'WiFi' | 'None' | '';
      safetySensorsRequired: 'Photoelectric Sensor' | 'Loop Detector' | 'None' | '';
      emergencyManualRelease?: boolean;
      reflectiveOrLed?: boolean;
      alarmBuzzer?: boolean;
      installationExposure: 'Indoor' | 'Outdoor' | '';
      outdoorExposure: Array<'Rain' | 'Direct Sunlight' | 'Dust/Heavy Traffic'>;
      windCondition: 'Low' | 'Moderate' | 'Strong' | '';
      specialInstructions: string;
      preferredBrandSpecs: string;
    };
  };
  estimatedCost?: number;
  ceilingType?: string;
  otherCeilingType?: string;
  materialsCost?: number;
  cablesCost?: number;
}

export interface AccessControlDoor {
  id: string;
  name: string;
  location: string;
  doorType?: 'Single' | 'Double';
  operation?: 'Swinging' | 'Sliding' | 'Revolving' | 'Rolling';
  doorAutomation?: 'Manual' | 'Automated';
  accessMethod: string[];
  accessMethodCapacity: string;
  lockType?: 'Electric strike' | 'Magnetic lock' | 'Mechanical lock' | 'Dropbolt';
  lockPowerType?: '12V' | '24V' | 'PoE' | '';
  wireType: string;
  doorMaterial?: 'Wood' | 'Metal' | 'Glass';
  rexType?: 'Push Button' | 'No-Touch Sensor' | 'Emergency Breakglass';
  environment?: 'Indoor' | 'Outdoor';
  wallType?: 'Concrete' | 'Gypsum' | 'Glass' | 'Steel' | 'Brick' | 'Other';
  otherWallType?: string;
  mountingSurface?: string;
  otherMountingSurface?: string;
  image?: string;
}

export interface AccessControlSurveyData {
  buildingInfo: {
    type: string;
    otherType?: string;
    floors: number;
    isNew: boolean;
  };
  measurements?: BuildingMeasurements;
  doors: AccessControlDoor[];
  infrastructure: {
    cableType: 'Cat6' | 'Multi-core' | 'Shielded' | '';
    cablePath: 'Ceiling' | 'Trunking' | 'Underground' | '';
    powerPath: 'Separate' | 'Shared' | '';
  };
  controller: {
    location: string;
    estimatedCableLength?: number;
    poeAvailable?: boolean;
    redundantControllers?: boolean;
    additionalHardware: string;
    wiringNotes: string;
    powerAvailable?: boolean;
    upsRequired?: boolean;
    networkRequired?: boolean;
    fireRatedDoor?: boolean;
  };
}

export interface BurglarAlarmSensor {
  id: string;
  location: string;
  riskLevel?: 'Low' | 'Medium' | 'High';
  intrusionConcern?: string[];
  environment?: 'Indoor' | 'Outdoor';
  type?: string;
  obstructions?: string[];
  count: number;
  connection?: 'Wired' | 'Wireless';
  wallType?: string;
  otherWallType?: string;
  image?: string;
}

export interface BurglarAlarmSurveyData {
  buildingInfo: {
    type: string;
    otherType?: string;
    floors: number;
    isNew: boolean;
  };
  measurements?: BuildingMeasurements;
  sensors: BurglarAlarmSensor[];
  notification: {
    sirenIndoor: number;
    sirenOutdoor: number;
    strobeLight?: boolean;
  };
  controlPanel: {
    location: string;
    systemType: 'Hybrid' | 'Fully Wireless' | 'Fully Wired' | '';
    keypads: number;
    simCardRequired?: boolean;
    internetRequired?: boolean;
    sirenLocation?: string;
    sirenTypeRequired?: 'Internal' | 'External' | '';
    monitoringType?: 'Self-Monitoring' | 'Central Monitoring' | '';
    notificationMethod?: string[];
    petsPresent?: boolean;
    powerSourceAvailable?: boolean;
    cableRoutingPath?: string;
    otherCableRoutingPath?: string;
    estimatedCableLength?: number;
  };
}

export interface User {
  fullName: string;
  email: string;
  password?: string;
  /** Profile fields (persisted with account). */
  phone?: string;
  role?: string;
  department?: string;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'model' | 'assistant';
  text: string;
  timestamp?: Date;
}
