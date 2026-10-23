import { useSimStore } from '../store/simStore';
import { useUiStore } from '../store/uiStore';

const DEFAULT_WS_URL = 'ws://localhost:8765/live';
const DEFAULT_HTTP_BASE = 'http://localhost:8765';

let liveWs: WebSocket | null = null;
let reconnectTimer: any = null;
let currentBackoffMs = 1000;
const MAX_BACKOFF_MS = 10000;
let isStarted = false;

export function getBackendWsUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_BACKEND_WS;
  return envUrl || DEFAULT_WS_URL;
}

export function getBackendHttpBase(): string {
  const wsUrl = getBackendWsUrl();
  try {
    const url = new URL(wsUrl);
    const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    return `${protocol}//${url.host}`;
  } catch {
    return DEFAULT_HTTP_BASE;
  }
}

export async function fetchBackendMode(): Promise<void> {
  const httpBase = getBackendHttpBase();
  try {
    const res = await fetch(`${httpBase}/api/mode`);
    if (res.ok) {
      const data = await res.json();
      if (data && (data.mode === 'SIMULATION' || data.mode === 'REALTIME')) {
        useSimStore.getState().setSystemMode(data.mode);
      }
    }
  } catch (err: any) {
    // Backend unreachable: fall back to SIMULATION so simulator works standalone
    useSimStore.getState().setSystemMode('SIMULATION');
  }
}

export async function reconcileBinsWithBackend(): Promise<{ success: boolean; count: number; error?: string }> {
  await fetchBackendMode();
  return { success: true, count: 0 };
}

export function handleLiveBackendMessage(data: any): void {
  if (!data || typeof data !== 'object') return;

  const ingestLiveHardware = useSimStore.getState().ingestLiveHardware;

  if (data.type === 'mode' && (data.mode === 'SIMULATION' || data.mode === 'REALTIME')) {
    useSimStore.getState().setSystemMode(data.mode);
    return;
  }

  if (data.type === 'hello' && data.mode && (data.mode === 'SIMULATION' || data.mode === 'REALTIME')) {
    useSimStore.getState().setSystemMode(data.mode);
  }

  if (data.type === 'telemetry' || data.type === 'simulated_telemetry') {
    if (data.bin_id && data.fill_level !== undefined) {
      ingestLiveHardware({
        bin_id: String(data.bin_id),
        fill_level: Number(data.fill_level),
        status: data.status,
        battery_pct: Number(data.battery_pct ?? 95),
        sequence: Number(data.sequence ?? (Date.now() % 100000)), provenance: data.provenance,
        rssi_dbm: Number(data.rssi_dbm ?? -80),
        snr_db: Number(data.snr_db ?? 8.0),
      });
    }
  } else if (data.type === 'alert') {
    if (data.bin_id && data.fill_level !== undefined) {
      ingestLiveHardware({
        bin_id: String(data.bin_id),
        fill_level: Number(data.fill_level),
        status: data.alert_type === 'FULL' ? 'FULL' : data.alert_type === 'HIGH' ? 'HIGH' : undefined,
        battery_pct: Number(data.battery_pct ?? 95),
        sequence: Number(data.sequence ?? (Date.now() % 100000)), provenance: data.provenance,
        rssi_dbm: Number(data.rssi_dbm ?? -80),
        snr_db: Number(data.snr_db ?? 8.0),
      });
    }
  }
}

function connectWs(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const wsUrl = getBackendWsUrl();
  const setHardwareConnection = useUiStore.getState().setHardwareConnection;

  if (useUiStore.getState().hardwareConnectionState !== 'CONNECTED') {
    setHardwareConnection('CONNECTING', 'WEBSOCKET', null);
  }

  try {
    liveWs = new WebSocket(wsUrl);

    liveWs.onopen = () => {
      currentBackoffMs = 1000;
      setHardwareConnection('CONNECTED', 'WEBSOCKET', null);
      reconcileBinsWithBackend();
    };

    liveWs.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        handleLiveBackendMessage(parsed);
      } catch {
        // ping or raw non-JSON
      }
    };

    liveWs.onerror = () => {
      console.warn(`[liveBridge] WebSocket connection to ${wsUrl} failed. Simulator continuing in pure-simulation mode.`);
    };

    liveWs.onclose = () => {
      liveWs = null;
      setHardwareConnection('DISCONNECTED', null, 'Backend connection offline. Retrying in background...');
      scheduleReconnect();
    };
  } catch (err: any) {
    console.warn(`[liveBridge] Invalid WebSocket setup for ${wsUrl}:`, err);
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    currentBackoffMs = Math.min(currentBackoffMs * 1.5, MAX_BACKOFF_MS);
    connectWs();
  }, currentBackoffMs);
}

export function startLiveBridge(): () => void {
  if (isStarted) {
    return () => {};
  }
  isStarted = true;
  connectWs();
  reconcileBinsWithBackend();

  return () => {
    isStarted = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (liveWs) {
      liveWs.close();
      liveWs = null;
    }
  };
}

