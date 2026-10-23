export type BinStatus = 'NORMAL' | 'FILLING' | 'HIGH' | 'FULL';
export type Provenance = 'SIMULATED' | 'LIVE_HARDWARE' | 'SIMULATED_DEMO';
export type NetworkMode = 'PROTOTYPE_P2P' | 'LORAWAN_SIM';
export type RegionCode = 'IN865' | 'EU868' | 'US915' | 'AS923';
export type WeatherCondition = 'CLEAR' | 'RAIN' | 'STORM';
export type SensorFaultType = 'NONE' | 'STUCK' | 'SPIKE' | 'BLOCKED' | 'DRIFT';
export type ScheduleMode = 'FIXED' | 'ADAPTIVE';
export type SystemMode = 'SIMULATION' | 'REALTIME';

export interface Bin {
  id: string;               // 'BIN-01'
  name: string;
  zoneId: string;
  position: { x: number; y: number };   // map coordinates (0..1000 x 0..700)
  emptyDistanceCm: number;
  trueFillPct: number;      // ground truth (hidden from UI except debug)
  latestFillPct: number;    // last reported
  latestStatus: BinStatus;
  batteryPct: number;
  lastSeenSimTime: number;
  suspectSensor: boolean;
  provenance: Provenance;
  // Extended simulation metrics for deep inspection & radio/sensor/energy tabs
  baseRate: number;         // % per hour
  sequence: number;
  expectedIntervalSec: number;
  nextTxSimTime: number;
  sf: 7 | 8 | 9 | 10 | 11 | 12;
  txPowerDbm: number;
  pathLossExponent: number;
  shadowingDb: Record<string, number>; // static shadowing per gatewayId
  sensorFault: SensorFaultType;
  consecutiveLowDistanceCount: number;
  lastSamplesCm: number[];
  lastMedianCm: number;
  lastEchoTimeUs: number;
  lastTempC: number;
  packetsSent: number;
  packetsDelivered: number;
  dutyCycleUsedSecInHour: number;
  energyMahFixedToday: number;
  energyMahAdaptiveToday: number;
  lorawanJoined: boolean;
  lorawanDevAddr: string;
  lorawanFCntUp: number;
  lorawanFCntDown: number;
  lastGatewayId?: string;
  lastRssiDbm?: number;
  lastSnrDb?: number;
}

export interface Gateway {
  id: string;
  name: string;
  position: { x: number; y: number };
  online: boolean;
  rxCount: number;
  airtimeUtilisation: number;   // 0..1
  meanRssiDbm: number;
  meanSnrDb: number;
}

export interface RadioPacket {
  id: string;
  binId: string;
  sequence: number;
  payload: string;              // 'V1,BIN-01,87,HIGH,91,1042'
  sf: 7 | 8 | 9 | 10 | 11 | 12;
  bwKhz: 125 | 250 | 500;
  cr: 5 | 6 | 7 | 8;
  freqMhz: number;
  txPowerDbm: number;
  airtimeMs: number;
  sentAt: number;
  receptions: Array<{ gatewayId: string; rssiDbm: number; snrDb: number; distanceM: number }>;
  outcome: 'DELIVERED' | 'LOST_RANGE' | 'LOST_COLLISION' | 'DEFERRED_DUTY_CYCLE';
  provenance: Provenance;
  // Pipeline hop details
  hopLatency: HopLatency;
  gatewayJsonLine: string;
  validationPassed: boolean;
  validationError?: string;
  duplicateRejected?: boolean;
  backendHttpStatus: number;
  dbInserted: boolean;
  lorawanDeduplicatedCount?: number;
  lorawanAdrCommand?: string;
  rx1WindowMs?: number;
  rx2WindowMs?: number;
}

export interface TelemetryRecord {
  bin_id: string;
  fill_level: number;
  status: BinStatus;
  battery_pct: number;
  sequence: number; rssi_dbm: number; snr_db: number;
  received_at: string;          // ISO timestamp
  provenance: Provenance;
  suspect?: boolean;
}

export interface Alert {
  id: string;
  binId: string;
  type: 'HIGH' | 'FULL' | 'OFFLINE' | 'SENSOR_SUSPECT' | 'GATEWAY_DOWN';
  message: string;
  createdAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  provenance: Provenance;
}

export interface HopLatency {
  sensingMs: number;
  airtimeMs: number;
  gatewayMs: number;
  serialMs: number;
  bridgeMs: number;
  httpMs: number;
  dbMs: number;
  pushMs: number;
}

export interface CollisionEvent {
  id: string;
  simTime: number;
  channelMhz: number;
  sf: 7 | 8 | 9 | 10 | 11 | 12;
  packetAId: string;
  binAId: string;
  rssiADbm: number;
  packetBId: string;
  binBId: string;
  rssiBDbm: number;
  winnerBinId: string | null; // null if both lost, or binId if >=6 dB capture
  gatewayId: string;
}

export interface Truck {
  id: string;
  name: string;
  position: { x: number; y: number };
  status: 'IDLE' | 'EN_ROUTE' | 'COLLECTING' | 'BROKEN_DOWN';
  assignedBinIds: string[];
  routePoints: Array<{ x: number; y: number }>;
  etaSimTime?: number;
  loadPct: number;
  collectedToday: number;
}

export interface ScriptedScenarioEvent {
  id: string;
  simTimeSec: number; // Seconds from 06:00 (0 .. 86400)
  timeLabel: string;  // '06:00', '08:00', etc.
  title: string;
  description: string;
  demonstrates: string;
  enabled: boolean;
  triggered: boolean;
  actionType:
    | 'QUIET_START'
    | 'COMMUTER_RUSH'
    | 'MARKET_SPIKE'
    | 'SENSOR_FAULT_BIN07'
    | 'STADIUM_OVERFLOW'
    | 'GATEWAY2_POWER_LOSS'
    | 'HEAVY_RAIN'
    | 'TRUCK1_STADIUM_COLLECT'
    | 'NIGHT_LOW_USE';
}

export interface PipelineCounters {
  binTx: number;
  loraDelivered: number;
  loraLost: number;
  gatewayRx: number;
  nsDeduplicated: number;
  nsAdrCount: number;
  serialLines: number;
  serialErrors: number;
  bridgeValidated: number;
  bridgeRejected: number;
  apiRequests: number;
  apiErrors: number;
  dbInserts: number;
  uiUpdates: number;
}

export interface PipelineFaultConfig {
  corruptNextPacket: boolean;
  dropNextPacket: boolean;
  duplicateNextSequence: boolean;
  serialLinkDead: boolean;
  backendReturn500: boolean;
}

export interface LoRaWANLogEntry {
  id: string;
  simTime: number;
  binId: string;
  type: 'JOIN_REQ' | 'JOIN_ACCEPT' | 'UPLINK_DEDUPE' | 'ADR_CMD' | 'REPLAY_REJECT';
  details: string;
  gatewaysHeard: string[];
  bestGatewayId: string;
  bestSnrDb: number;
}

export interface MinuteSnapshot {
  minuteIndex: number; // 0..1440
  simTimeSec: number;
  activeAlertsCount: number;
  airtimeUtilPct: number;
  meanFillPct: number;
  sfCounts: Record<7 | 8 | 9 | 10 | 11 | 12, number>;
}

export interface EnergyParams {
  sleepCurrentMa: number;
  wakeCurrentMa: number;
  measureCurrentMa: number;
  txCurrentMa: number;
  rxCurrentMa: number;
  wakeTimeMs: number;
  measureTimeMs: number;
  fixedIntervalMin: number;
  batteryCapacityMah: number;
}

export interface SimStateSnapshot {
  simTimeSec: number; // 0 = 06:00, 86400 = next day 06:00
  running: boolean;
  speed: 1 | 60 | 600 | 3600;
  seed: number;
  networkMode: NetworkMode;
  region: RegionCode;
  weather: WeatherCondition;
  ambientTempC: number;
  scheduleMode: ScheduleMode;
  zoneCrowdMultipliers: Record<string, number>;
  bins: Bin[];
  gateways: Gateway[];
  trucks: Truck[];
  packets: RadioPacket[];
  telemetryLog: TelemetryRecord[];
  alerts: Alert[];
  collisions: CollisionEvent[];
  lorawanLog: LoRaWANLogEntry[];
  scriptedEvents: ScriptedScenarioEvent[];
  pipelineCounters: PipelineCounters;
  pipelineFaults: PipelineFaultConfig;
  bridgeLogs: Array<{ id: string; simTime: number; level: 'INFO' | 'WARN' | 'ERROR'; text: string }>;
  timelineHistory: MinuteSnapshot[];
  energyParams: EnergyParams;
  systemMode: SystemMode;
}


