import { create } from 'zustand';
import { SimulationEngine } from '../sim/engine';
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
} from '../sim/types';
import { WorkerCommand, WorkerResponse } from '../sim/worker';

interface SimStore extends SimStateSnapshot {
  initWorker: () => void;
  resetWithSeed: (seed: number) => void;
  play: () => void;
  pause: () => void;
  step: (dtSec?: number) => void;
  setSystemMode: (mode: SystemMode) => void;
  setSpeed: (speed: 1 | 60 | 600 | 3600) => void;
  setNetworkMode: (mode: NetworkMode) => void;
  setRegion: (region: RegionCode) => void;
  setWeather: (weather: WeatherCondition) => void;
  setScheduleMode: (mode: ScheduleMode) => void;
  setEnergyParams: (params: Partial<EnergyParams>) => void;
  setZoneCrowd: (zoneId: string, multiplier: number) => void;
  setGatewayOnline: (gatewayId: string, online: boolean) => void;
  setBinFault: (binId: string, fault: SensorFaultType) => void;
  setPipelineFaults: (faults: Partial<PipelineFaultConfig>) => void;
  acknowledgeAlert: (alertId: string) => void;
  dispatchTruck: (truckId: string, binIds: string[]) => void;
  setTruckBreakdown: (truckId: string, broken: boolean) => void;
  injectDemoFill: (binId: string, fillPct: number) => void;
  ingestLiveHardware: (record: {
    bin_id: string;
    fill_level: number;
    status?: BinStatus;
    battery_pct: number;
    sequence: number; rssi_dbm: number; snr_db: number; provenance?: any;
    isInitialSync?: boolean;
  }) => void;
  triggerScenarioEvent: (eventId: string) => void;
  toggleScenarioEvent: (eventId: string, enabled: boolean) => void;
  scrubToTime: (simTimeSec: number) => void;
}

const initialEngine = new SimulationEngine(42026);
const initialSnapshot = initialEngine.getSnapshot();

let simWorker: Worker | null = null;

function sendWorkerCmd(cmd: WorkerCommand): void {
  if (simWorker) {
    simWorker.postMessage(cmd);
  }
}

export const useSimStore = create<SimStore>((set) => ({
  ...initialSnapshot,

  initWorker: () => {
    if (simWorker) return;
    try {
      simWorker = new Worker(new URL('../sim/worker.ts', import.meta.url), {
        type: 'module',
      });
      simWorker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'STATE_SNAPSHOT') {
          set({ ...e.data.snapshot });
        }
      };
      sendWorkerCmd({ type: 'INIT', seed: 42026 });
    } catch (err) {
      console.error('Failed to initialize simulation Web Worker:', err);
    }
  },

  resetWithSeed: (seed) => sendWorkerCmd({ type: 'INIT', seed }),
  play: () => sendWorkerCmd({ type: 'PLAY' }),
  pause: () => sendWorkerCmd({ type: 'PAUSE' }),
  step: (dtSec = 60) => sendWorkerCmd({ type: 'STEP', dtSec }),
  setSystemMode: (mode) => sendWorkerCmd({ type: 'SET_SYSTEM_MODE', mode }),
  setSpeed: (speed) => sendWorkerCmd({ type: 'SET_SPEED', speed }),
  setNetworkMode: (mode) => sendWorkerCmd({ type: 'SET_NETWORK_MODE', mode }),
  setRegion: (region) => sendWorkerCmd({ type: 'SET_REGION', region }),
  setWeather: (weather) => sendWorkerCmd({ type: 'SET_WEATHER', weather }),
  setScheduleMode: (mode) => sendWorkerCmd({ type: 'SET_SCHEDULE_MODE', mode }),
  setEnergyParams: (params) => sendWorkerCmd({ type: 'SET_ENERGY_PARAMS', params }),
  setZoneCrowd: (zoneId, multiplier) =>
    sendWorkerCmd({ type: 'SET_ZONE_CROWD', zoneId, multiplier }),
  setGatewayOnline: (gatewayId, online) =>
    sendWorkerCmd({ type: 'SET_GATEWAY_ONLINE', gatewayId, online }),
  setBinFault: (binId, fault) => sendWorkerCmd({ type: 'SET_BIN_FAULT', binId, fault }),
  setPipelineFaults: (faults) => sendWorkerCmd({ type: 'SET_PIPELINE_FAULTS', faults }),
  acknowledgeAlert: (alertId) => sendWorkerCmd({ type: 'ACKNOWLEDGE_ALERT', alertId }),
  dispatchTruck: (truckId, binIds) =>
    sendWorkerCmd({ type: 'DISPATCH_TRUCK', truckId, binIds }),
  setTruckBreakdown: (truckId, broken) =>
    sendWorkerCmd({ type: 'SET_TRUCK_BREAKDOWN', truckId, broken }),
  injectDemoFill: (binId, fillPct) =>
    sendWorkerCmd({ type: 'INJECT_DEMO_FILL', binId, fillPct }),
  ingestLiveHardware: (record) =>
    sendWorkerCmd({ type: 'INGEST_LIVE_HARDWARE', record }),
  triggerScenarioEvent: (eventId) =>
    sendWorkerCmd({ type: 'TRIGGER_SCENARIO_EVENT', eventId }),
  toggleScenarioEvent: (eventId, enabled) =>
    sendWorkerCmd({ type: 'TOGGLE_SCENARIO_EVENT', eventId, enabled }),
  scrubToTime: (simTimeSec) => sendWorkerCmd({ type: 'SCRUB_TO_TIME', simTimeSec }),
}));


