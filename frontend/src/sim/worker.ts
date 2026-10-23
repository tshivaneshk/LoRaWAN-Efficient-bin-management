import { SimulationEngine } from './engine';
import {
  BinStatus,
  EnergyParams,
  NetworkMode,
  PipelineFaultConfig,
  RegionCode,
  ScheduleMode,
  SensorFaultType,
  SimStateSnapshot,
  SystemMode,
  WeatherCondition,
} from './types';

export type WorkerCommand =
  | { type: 'INIT'; seed?: number }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'STEP'; dtSec?: number }
  | { type: 'SET_SYSTEM_MODE'; mode: SystemMode }
  | { type: 'SET_SPEED'; speed: 1 | 60 | 600 | 3600 }
  | { type: 'SET_NETWORK_MODE'; mode: NetworkMode }
  | { type: 'SET_REGION'; region: RegionCode }
  | { type: 'SET_WEATHER'; weather: WeatherCondition }
  | { type: 'SET_SCHEDULE_MODE'; mode: ScheduleMode }
  | { type: 'SET_ENERGY_PARAMS'; params: Partial<EnergyParams> }
  | { type: 'SET_ZONE_CROWD'; zoneId: string; multiplier: number }
  | { type: 'SET_GATEWAY_ONLINE'; gatewayId: string; online: boolean }
  | { type: 'SET_BIN_FAULT'; binId: string; fault: SensorFaultType }
  | { type: 'SET_PIPELINE_FAULTS'; faults: Partial<PipelineFaultConfig> }
  | { type: 'ACKNOWLEDGE_ALERT'; alertId: string }
  | { type: 'DISPATCH_TRUCK'; truckId: string; binIds: string[] }
  | { type: 'SET_TRUCK_BREAKDOWN'; truckId: string; broken: boolean }
  | { type: 'INJECT_DEMO_FILL'; binId: string; fillPct: number }
  | {
      type: 'INGEST_LIVE_HARDWARE';
      record: {
        bin_id: string;
        fill_level: number;
        status?: BinStatus;
        battery_pct: number;
        sequence: number; rssi_dbm: number; snr_db: number; provenance?: any;
        isInitialSync?: boolean;
      };
    }
  | { type: 'TRIGGER_SCENARIO_EVENT'; eventId: string }
  | { type: 'TOGGLE_SCENARIO_EVENT'; eventId: string; enabled: boolean }
  | { type: 'SCRUB_TO_TIME'; simTimeSec: number };

export type WorkerResponse = {
  type: 'STATE_SNAPSHOT';
  snapshot: SimStateSnapshot;
};

const engine = new SimulationEngine(42026);
let intervalId: ReturnType<typeof setInterval> | null = null;
let lastRealTickMs = performance.now();

function broadcastSnapshot(): void {
  const response: WorkerResponse = {
    type: 'STATE_SNAPSHOT',
    snapshot: engine.getSnapshot(),
  };
  self.postMessage(response);
}

function startLoop(): void {
  if (intervalId !== null) return;
  lastRealTickMs = performance.now();
  // Emit at ~20 Hz (every 50 ms)
  intervalId = setInterval(() => {
    const snap = engine.getSnapshot();
    if (!snap.running) return;
    const now = performance.now();
    const realDtSec = Math.min(0.2, (now - lastRealTickMs) / 1000);
    lastRealTickMs = now;

    const simDtSec = realDtSec * snap.speed;
    engine.stepBySeconds(simDtSec);

    const after = engine.getSnapshot();
    if (after.simTimeSec >= 86400) {
      engine.setRunning(false);
    }
    broadcastSnapshot();
  }, 50);
}

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;
  switch (cmd.type) {
    case 'INIT':
      engine.reset(cmd.seed);
      startLoop();
      broadcastSnapshot();
      break;
    case 'PLAY':
      lastRealTickMs = performance.now();
      engine.setRunning(true);
      startLoop();
      broadcastSnapshot();
      break;
    case 'PAUSE':
      engine.setRunning(false);
      broadcastSnapshot();
      break;
    case 'SET_SYSTEM_MODE':
      engine.setSystemMode(cmd.mode);
      broadcastSnapshot();
      break;
    case 'STEP':
      engine.setRunning(false);
      engine.stepBySeconds(cmd.dtSec ?? 60);
      broadcastSnapshot();
      break;
    case 'SET_SPEED':
      engine.setSpeed(cmd.speed);
      broadcastSnapshot();
      break;
    case 'SET_NETWORK_MODE':
      engine.setNetworkMode(cmd.mode);
      broadcastSnapshot();
      break;
    case 'SET_REGION':
      engine.setRegion(cmd.region);
      broadcastSnapshot();
      break;
    case 'SET_WEATHER':
      engine.setWeather(cmd.weather);
      broadcastSnapshot();
      break;
    case 'SET_SCHEDULE_MODE':
      engine.setScheduleMode(cmd.mode);
      broadcastSnapshot();
      break;
    case 'SET_ENERGY_PARAMS':
      engine.setEnergyParams(cmd.params);
      broadcastSnapshot();
      break;
    case 'SET_ZONE_CROWD':
      engine.setZoneCrowdMultiplier(cmd.zoneId, cmd.multiplier);
      broadcastSnapshot();
      break;
    case 'SET_GATEWAY_ONLINE':
      engine.setGatewayOnline(cmd.gatewayId, cmd.online);
      broadcastSnapshot();
      break;
    case 'SET_BIN_FAULT':
      engine.setBinSensorFault(cmd.binId, cmd.fault);
      broadcastSnapshot();
      break;
    case 'SET_PIPELINE_FAULTS':
      engine.setPipelineFaults(cmd.faults);
      broadcastSnapshot();
      break;
    case 'ACKNOWLEDGE_ALERT':
      engine.acknowledgeAlert(cmd.alertId);
      broadcastSnapshot();
      break;
    case 'DISPATCH_TRUCK':
      engine.dispatchTruck(cmd.truckId, cmd.binIds);
      broadcastSnapshot();
      break;
    case 'SET_TRUCK_BREAKDOWN':
      engine.setTruckBreakdown(cmd.truckId, cmd.broken);
      broadcastSnapshot();
      break;
    case 'INJECT_DEMO_FILL':
      engine.injectDemoFill(cmd.binId, cmd.fillPct);
      broadcastSnapshot();
      break;
    case 'INGEST_LIVE_HARDWARE':
      engine.ingestLiveHardwareRecord(cmd.record);
      broadcastSnapshot();
      break;
    case 'TRIGGER_SCENARIO_EVENT':
      engine.triggerScriptedEventNow(cmd.eventId);
      broadcastSnapshot();
      break;
    case 'TOGGLE_SCENARIO_EVENT':
      engine.toggleScriptedEvent(cmd.eventId, cmd.enabled);
      broadcastSnapshot();
      break;
    case 'SCRUB_TO_TIME':
      engine.setRunning(false);
      engine.scrubToSimTime(cmd.simTimeSec);
      broadcastSnapshot();
      break;
  }
};


