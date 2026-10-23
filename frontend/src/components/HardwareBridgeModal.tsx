import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Radio, Terminal, Usb, Wifi, X } from 'lucide-react';
import { ProvenanceBadge } from './Primitives';
import { useSimStore } from '../store/simStore';
import { useUiStore } from '../store/uiStore';

export const HardwareBridgeModal: React.FC = () => {
  const open = useUiStore((s) => s.hardwareDialogOpen);
  const setOpen = useUiStore((s) => s.setHardwareDialogOpen);
  const connectionState = useUiStore((s) => s.hardwareConnectionState);
  const method = useUiStore((s) => s.hardwareMethod);
  const errorText = useUiStore((s) => s.hardwareErrorText);
  const setConnection = useUiStore((s) => s.setHardwareConnection);
  const ingestLiveHardware = useSimStore((s) => s.ingestLiveHardware);

  const [wsUrl, setWsUrl] = useState('ws://localhost:8765/live');
  const [manualJsonLine, setManualJsonLine] = useState(
    '{"type":"telemetry","bin_id":"BIN-01","fill_level":84,"status":"HIGH","battery_pct":94,"sequence":2041,"rssi_dbm":-76,"snr_db":9.2}'
  );

  const wsRef = useRef<WebSocket | null>(null);

  if (!open) return null;

  const parseAndIngestJsonLine = (line: string) => {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed && parsed.type === 'telemetry' && parsed.bin_id) {
        ingestLiveHardware({
          bin_id: String(parsed.bin_id),
          fill_level: Number(parsed.fill_level ?? 50),
          status: parsed.status,
          battery_pct: Number(parsed.battery_pct ?? 95),
          sequence: Number(parsed.sequence ?? 1),
          rssi_dbm: Number(parsed.rssi_dbm ?? -80),
          snr_db: Number(parsed.snr_db ?? 8.0),
        });
        return true;
      }
    } catch {
      // ignore non-JSON or malformed lines
    }
    return false;
  };

  const connectWebSocket = () => {
    setConnection('CONNECTING', 'WEBSOCKET', null);
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnection('CONNECTED', 'WEBSOCKET', null);
      };

      ws.onmessage = (evt) => {
        if (typeof evt.data === 'string') {
          parseAndIngestJsonLine(evt.data);
        }
      };

      ws.onerror = () => {
        setConnection(
          'ERROR',
          'WEBSOCKET',
          `Could not connect to Python bridge WebSocket at ${wsUrl}. Ensure serial_bridge.py is running with --ws-port, or use Web Serial API.`
        );
      };

      ws.onclose = () => {
        if (useUiStore.getState().hardwareConnectionState === 'CONNECTED') {
          setConnection('DISCONNECTED', null, 'WebSocket stream closed.');
        }
      };
    } catch {
      setConnection('ERROR', 'WEBSOCKET', `Invalid WebSocket URL: ${wsUrl}`);
    }
  };

  const connectWebSerial = async () => {
    setConnection('CONNECTING', 'WEBSERIAL', null);
    const nav = navigator as unknown as {
      serial?: {
        requestPort: () => Promise<{
          open: (opts: { baudRate: number }) => Promise<void>;
          readable?: ReadableStream<Uint8Array>;
        }>;
      };
    };

    if (!nav.serial) {
      setConnection(
        'ERROR',
        'WEBSERIAL',
        'Web Serial API requires a Chromium-based browser (Chrome / Edge).'
      );
      return;
    }

    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 115200 });
      setConnection('CONNECTED', 'WEBSERIAL', null);

      if (port.readable) {
        const reader = port.readable.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const l of lines) {
              parseAndIngestJsonLine(l);
            }
          }
        }
      }
    } catch {
      setConnection(
        'ERROR',
        'WEBSERIAL',
        'Serial port in use. Close the Arduino Serial Monitor and the Python bridge, then retry.'
      );
    }
  };

  const disconnectHardware = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnection('DISCONNECTED', null, null);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hw-dialog-title"
    >
      <div className="w-full max-w-xl card-surface p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2">
            <Usb className="w-4 h-4 text-[var(--live)]" />
            <h2 id="hw-dialog-title" className="text-base font-semibold text-[var(--text)]">
              Connect Physical Prototype Hardware Bridge
            </h2>
            <ProvenanceBadge provenance="LIVE_HARDWARE" />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1 rounded bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Display your physical <strong>Arduino Nano + HC-SR04 + SX1278/RFM95</strong> prototype
          alongside the simulated district bins. Records arriving over WebSocket or Web Serial are
          marked with a solid green pulsing <code>LIVE HARDWARE</code> badge and solid chart lines,
          never mixed indistinguishably with simulated data.
        </p>

        {errorText && (
          <div className="p-3 rounded-lg bg-[var(--status-full)]/15 border border-[var(--status-full)] text-[var(--status-full)] text-xs flex items-start gap-2 font-mono">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorText}</span>
          </div>
        )}

        {connectionState === 'CONNECTED' && (
          <div className="p-3 rounded-lg bg-[var(--live)]/12 border border-[var(--live)] text-[var(--live)] text-xs flex items-center justify-between font-mono">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Connected via {method} — listening for gateway JSON lines
            </span>
            <button
              type="button"
              onClick={disconnectHardware}
              className="px-2 py-1 rounded bg-[var(--surface-1)] text-[var(--text)] border border-[var(--border)] cursor-pointer"
            >
              Disconnect
            </button>
          </div>
        )}

        {/* Option 1: WebSocket to Python Bridge */}
        <div className="p-3.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-[var(--accent)]" />
              Method 1: Python Serial Bridge WebSocket (Recommended)
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded bg-[var(--bg)] border border-[var(--border)] font-mono text-xs text-[var(--text)]"
            />
            <button
              type="button"
              onClick={connectWebSocket}
              className="px-3 py-1.5 rounded bg-[var(--accent)] text-[#041014] font-semibold text-xs hover:opacity-90 cursor-pointer"
            >
              Connect WS
            </button>
          </div>
        </div>

        {/* Option 2: Web Serial API */}
        <div className="p-3.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <Usb className="w-3.5 h-3.5 text-[var(--live)]" />
              Method 2: Direct Web Serial API (115200 baud)
            </div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Reads gateway Arduino Nano JSON lines directly from USB COM/tty port in Chromium.
            </div>
          </div>
          <button
            type="button"
            onClick={connectWebSerial}
            className="px-3 py-1.5 rounded bg-[var(--surface-3)] hover:bg-[var(--border)] border border-[var(--border-strong)] font-semibold text-xs text-[var(--text)] shrink-0 cursor-pointer"
          >
            Select USB Port
          </button>
        </div>

        {/* Gateway JSON Line Loopback Verifier */}
        <div className="p-3.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-2">
          <div className="text-xs font-semibold flex items-center gap-1.5 text-[var(--text-muted)]">
            <Terminal className="w-3.5 h-3.5 text-[var(--live)]" />
            Test Live Gateway JSON Frame Ingestion (Hardware Frame Format)
          </div>
          <textarea
            rows={2}
            value={manualJsonLine}
            onChange={(e) => setManualJsonLine(e.target.value)}
            className="w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] font-mono text-[11px] text-[var(--text)]"
          />
          <button
            type="button"
            onClick={() => {
              const ok = parseAndIngestJsonLine(manualJsonLine);
              if (ok) {
                setConnection('CONNECTED', 'WEBSERIAL', null);
                setOpen(false);
              }
            }}
            className="w-full py-1.5 rounded bg-[var(--live)]/20 border border-[var(--live)] text-[var(--live)] font-mono text-xs font-semibold hover:bg-[var(--live)]/30 cursor-pointer"
          >
            Inject Live Hardware Frame &amp; Display on Map
          </button>
        </div>
      </div>
    </div>
  );
};
