import React from 'react';
import {
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Database,
  FileCode2,
  HardDrive,
  LayoutDashboard,
  Radio,
  RefreshCw,
  Server,
  ShieldAlert,
  Terminal,
  Usb,
  XCircle,
  Zap,
} from 'lucide-react';
import { EmptyState, LoRaWanTag, ProvenanceBadge } from '../../components/Primitives';
import { formatSimClock, stringToHexBytes } from '../../lib/format';
import { HopLatency, RadioPacket } from '../../sim/types';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';

const LatencyBar: React.FC<{ latency: HopLatency }> = ({ latency }) => {
  const segments = [
    { key: 'sensingMs', label: 'HC-SR04 Sensing', val: latency.sensingMs, color: '#38BDF8' },
    { key: 'airtimeMs', label: 'LoRa Airtime (ToA)', val: latency.airtimeMs, color: '#22D3EE' },
    { key: 'gatewayMs', label: 'Gateway RX', val: latency.gatewayMs, color: '#A78BFA' },
    { key: 'serialMs', label: 'USB Serial', val: latency.serialMs, color: '#FBBF24' },
    { key: 'bridgeMs', label: 'Python Bridge', val: latency.bridgeMs, color: '#34D399' },
    { key: 'httpMs', label: 'Backend HTTP POST', val: latency.httpMs, color: '#FB923C' },
    { key: 'dbMs', label: 'Database Write', val: latency.dbMs, color: '#F472B6' },
    { key: 'pushMs', label: 'UI WebSocket Push', val: latency.pushMs, color: '#60A5FA' },
  ];

  const totalMs = segments.reduce((acc, s) => acc + s.val, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-[var(--text-muted)] uppercase tracking-wider text-[11px]">
          End-to-End Hop Latency Budget
        </span>
        <span className="font-mono font-semibold tabular-nums text-[var(--accent)]">
          Total: {totalMs.toFixed(1)} ms
        </span>
      </div>

      <div className="h-3.5 w-full rounded-md overflow-hidden bg-[var(--surface-3)] flex">
        {segments.map((seg) => {
          if (seg.val <= 0 || totalMs <= 0) return null;
          const pct = Math.max(2, (seg.val / totalMs) * 100);
          return (
            <div
              key={seg.key}
              style={{ width: `${pct}%`, backgroundColor: seg.color }}
              title={`${seg.label}: ${seg.val.toFixed(1)} ms`}
              className="h-full border-r border-[var(--bg)]/40 transition-all duration-200"
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className="flex items-center justify-between px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-mono"
          >
            <span className="flex items-center gap-1.5 truncate">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="truncate text-[var(--text-muted)]">{seg.label.split(' ')[0]}</span>
            </span>
            <span className="tabular-nums font-semibold">{seg.val.toFixed(1)}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const PipelineScreen: React.FC = () => {
  const packets = useSimStore((s) => s.packets);
  const counters = useSimStore((s) => s.pipelineCounters);
  const faults = useSimStore((s) => s.pipelineFaults);
  const setPipelineFaults = useSimStore((s) => s.setPipelineFaults);
  const bridgeLogs = useSimStore((s) => s.bridgeLogs);
  const networkMode = useSimStore((s) => s.networkMode);
  const step = useSimStore((s) => s.step);
  const selectedBinId = useUiStore((s) => s.selectedBinId);
  const selectedPacketId = useUiStore((s) => s.selectedPacketId);
  const setSelectedPacketId = useUiStore((s) => s.setSelectedPacketId);
  const selectedPipelineHop = useUiStore((s) => s.selectedPipelineHop);
  const setSelectedPipelineHop = useUiStore((s) => s.setSelectedPipelineHop);
  const injectDemoFill = useSimStore((s) => s.injectDemoFill);

  const inspectedPacket: RadioPacket | undefined =
    packets.find((p) => p.id === selectedPacketId) ?? packets[0];

  const hops = [
    {
      id: 'bin-node',
      title: 'Bin Node',
      subtitle: 'HC-SR04 + Nano + SX1278',
      icon: <Cpu className="w-4 h-4" />,
      inCount: counters.binTx,
      outCount: counters.binTx,
      errCount: 0,
      healthy: true,
    },
    {
      id: 'lora-link',
      title: 'LoRa Radio Link',
      subtitle: 'Sub-GHz Chirp Spread Spectrum',
      icon: <Radio className="w-4 h-4" />,
      inCount: counters.binTx,
      outCount: counters.loraDelivered,
      errCount: counters.loraLost,
      healthy: counters.loraLost < counters.binTx * 0.5 || counters.binTx === 0,
    },
    {
      id: 'gateway',
      title: 'LoRa Gateway',
      subtitle: 'Nano + RFM95 (RSSI/SNR)',
      icon: <Server className="w-4 h-4" />,
      inCount: counters.loraDelivered,
      outCount: counters.gatewayRx,
      errCount: 0,
      healthy: true,
    },
    ...(networkMode === 'LORAWAN_SIM'
      ? [
          {
            id: 'network-server',
            title: 'Network Server',
            subtitle: 'Dedupe · MIC · FCnt · ADR',
            icon: <HardDrive className="w-4 h-4" />,
            inCount: counters.gatewayRx,
            outCount: counters.loraDelivered,
            errCount: counters.nsDeduplicated,
            healthy: true,
            isLoRaWanOnly: true,
          },
        ]
      : []),
    {
      id: 'usb-serial',
      title: 'USB Serial (COM4)',
      subtitle: '115200 baud JSON Lines',
      icon: <Usb className="w-4 h-4" />,
      inCount: counters.loraDelivered,
      outCount: counters.serialLines,
      errCount: counters.serialErrors,
      healthy: !faults.serialLinkDead,
    },
    {
      id: 'python-bridge',
      title: 'Python Serial Bridge',
      subtitle: 'Schema + Dedupe Validator',
      icon: <FileCode2 className="w-4 h-4" />,
      inCount: counters.serialLines,
      outCount: counters.bridgeValidated,
      errCount: counters.bridgeRejected,
      healthy: true,
    },
    {
      id: 'backend-api',
      title: 'Backend REST API',
      subtitle: 'POST /api/v1/telemetry',
      icon: <Server className="w-4 h-4" />,
      inCount: counters.apiRequests,
      outCount: counters.dbInserts,
      errCount: counters.apiErrors,
      healthy: !faults.backendReturn500,
    },
    {
      id: 'database',
      title: 'Telemetry Database',
      subtitle: 'SQLite / Postgres + Alerts',
      icon: <Database className="w-4 h-4" />,
      inCount: counters.dbInserts,
      outCount: counters.dbInserts,
      errCount: 0,
      healthy: true,
    },
    {
      id: 'dashboard',
      title: 'Ops Dashboard',
      subtitle: 'Live Store + Hysteresis UI',
      icon: <LayoutDashboard className="w-4 h-4" />,
      inCount: counters.uiUpdates,
      outCount: counters.uiUpdates,
      errCount: 0,
      healthy: true,
    },
  ];

  const triggerTestPacketWithFault = (faultUpdate: Partial<typeof faults>) => {
    setPipelineFaults(faultUpdate);
    setTimeout(() => {
      step(15);
    }, 40);
  };

  return (
    <div className="h-full w-full overflow-y-auto p-4 space-y-4">
      {/* Top Header + Fault Injection Controls */}
      <div className="card-surface p-4 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-[var(--text)]">
              End-to-End Telemetry Pipeline &amp; Packet Inspector
            </h1>
            <ProvenanceBadge provenance="SIMULATED" />
            {networkMode === 'LORAWAN_SIM' && <LoRaWanTag />}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Click any hop card or packet row to inspect the exact raw frame representation, transformation stepper, and hop latency budget.
          </p>
        </div>

        {/* Fault Injection Controls (Section 4 Screen 2 & Interaction #7) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono uppercase text-[var(--text-faint)] mr-1">
            Fault Injectors:
          </span>

          <button
            type="button"
            onClick={() => triggerTestPacketWithFault({ corruptNextPacket: true })}
            className="px-2.5 py-1.5 rounded-md text-xs font-mono bg-[var(--status-high)]/15 border border-[var(--status-high)]/40 text-[var(--status-high)] hover:bg-[var(--status-high)]/25 transition cursor-pointer flex items-center gap-1.5"
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            Corrupt Next Packet
          </button>

          <button
            type="button"
            onClick={() => triggerTestPacketWithFault({ duplicateNextSequence: true })}
            className="px-2.5 py-1.5 rounded-md text-xs font-mono bg-[var(--sim)]/15 border border-[var(--sim)]/40 text-[var(--sim)] hover:bg-[var(--sim)]/25 transition cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Duplicate Sequence #
          </button>

          <button
            type="button"
            onClick={() => triggerTestPacketWithFault({ dropNextPacket: true })}
            className="px-2.5 py-1.5 rounded-md text-xs font-mono bg-[var(--surface-2)] border border-[var(--border-strong)] text-[var(--text)] hover:bg-[var(--surface-3)] transition cursor-pointer"
          >
            Drop Next RF Frame
          </button>

          <button
            type="button"
            onClick={() =>
              setPipelineFaults({ serialLinkDead: !faults.serialLinkDead })
            }
            className={`px-2.5 py-1.5 rounded-md text-xs font-mono border transition cursor-pointer ${
              faults.serialLinkDead
                ? 'bg-[var(--status-full)] text-white border-[var(--status-full)]'
                : 'bg-[var(--surface-2)] border-[var(--border-strong)] text-[var(--text)]'
            }`}
          >
            {faults.serialLinkDead ? 'Restore USB Serial' : 'Kill USB Serial Link'}
          </button>

          <button
            type="button"
            onClick={() =>
              setPipelineFaults({ backendReturn500: !faults.backendReturn500 })
            }
            className={`px-2.5 py-1.5 rounded-md text-xs font-mono border transition cursor-pointer ${
              faults.backendReturn500
                ? 'bg-[var(--status-full)] text-white border-[var(--status-full)]'
                : 'bg-[var(--surface-2)] border-[var(--border-strong)] text-[var(--text)]'
            }`}
          >
            {faults.backendReturn500 ? 'Restore API (201)' : 'Force Backend HTTP 500'}
          </button>
        </div>
      </div>

      {/* Horizontal Architecture Pipeline Flow Diagram */}
      <div className="card-surface p-4 overflow-x-auto">
        <div className="flex items-stretch gap-2 min-w-[1050px]">
          {hops.map((hop, idx) => {
            const isSelected = selectedPipelineHop === hop.id;
            return (
              <React.Fragment key={hop.id}>
                <button
                  type="button"
                  onClick={() => setSelectedPipelineHop(hop.id)}
                  className={`flex-1 p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between min-w-[125px] ${
                    isSelected
                      ? 'bg-[var(--accent-soft)] border-[var(--accent)] ring-1 ring-[var(--accent)]'
                      : (hop as { isLoRaWanOnly?: boolean }).isLoRaWanOnly
                        ? 'bg-[var(--lorawan)]/10 border-dashed border-[var(--lorawan)]/60'
                        : 'bg-[var(--surface-2)] border-[var(--border)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[var(--accent)]">{hop.icon}</span>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          hop.healthy ? 'bg-[var(--status-normal)]' : 'bg-[var(--status-full)] animate-full-alert'
                        }`}
                        title={hop.healthy ? 'Hop Healthy' : 'Fault Active'}
                      />
                    </div>
                    <div className="font-semibold text-xs text-[var(--text)] mt-2">
                      {hop.title}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] leading-tight mt-0.5">
                      {hop.subtitle}
                    </div>
                    {(hop as { isLoRaWanOnly?: boolean }).isLoRaWanOnly && (
                      <div className="mt-1">
                        <LoRaWanTag label="SIM LoRaWAN" />
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-2 border-t border-[var(--border)]/60 grid grid-cols-3 gap-1 font-mono text-[10px] tabular-nums">
                    <div>
                      <div className="text-[8px] text-[var(--text-faint)]">IN</div>
                      <div>{hop.inCount}</div>
                    </div>
                    <div>
                      <div className="text-[8px] text-[var(--text-faint)]">OUT</div>
                      <div className="text-[var(--status-normal)]">{hop.outCount}</div>
                    </div>
                    <div>
                      <div className="text-[8px] text-[var(--text-faint)]">ERR/DROP</div>
                      <div
                        className={
                          hop.errCount > 0 ? 'text-[var(--status-full)] font-bold' : 'text-[var(--text-muted)]'
                        }
                      >
                        {hop.errCount}
                      </div>
                    </div>
                  </div>
                </button>

                {idx < hops.length - 1 && (
                  <div className="flex flex-col items-center justify-center px-0.5 text-[var(--text-faint)]">
                    <ArrowRight className="w-4 h-4 text-[var(--accent)]" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Main Inspector Grid: Recent Packets Table + Deep Packet Inspector Sheet */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 5 Cols: Recent Packets in Flight + Python Bridge Log */}
        <div className="lg:col-span-5 space-y-4">
          <div className="card-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Recent Radio Packets ({packets.length})
              </h2>
              <button
                type="button"
                onClick={() => injectDemoFill(selectedBinId, 88)}
                className="px-2 py-1 rounded text-[11px] font-mono bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/30 hover:opacity-90 cursor-pointer flex items-center gap-1"
              >
                <Zap className="w-3 h-3" /> Send Test Frame ({selectedBinId})
              </button>
            </div>

            {packets.length === 0 ? (
              <EmptyState
                title="No packets transmitted yet"
                description="Step the simulation or click Send Test Frame to inspect a live packet across every pipeline hop."
                actionLabel="Step +1 Minute"
                onAction={() => step(60)}
              />
            ) : (
              <div className="max-h-68 overflow-y-auto divide-y divide-[var(--border)]/60">
                {packets.slice(0, 30).map((pkt) => {
                  const isSel = inspectedPacket?.id === pkt.id;
                  return (
                    <button
                      key={pkt.id}
                      type="button"
                      onClick={() => setSelectedPacketId(pkt.id)}
                      className={`w-full py-2 px-2.5 text-left font-mono text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                        isSel ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[var(--text)]">{pkt.binId}</span>
                          <span className="text-[var(--text-muted)]">#{pkt.sequence}</span>
                          <ProvenanceBadge provenance={pkt.provenance} compact />
                        </div>
                        <div className="text-[10px] text-[var(--text-faint)] truncate mt-0.5">
                          {pkt.payload}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            pkt.dbInserted
                              ? 'bg-[var(--status-normal)]/15 text-[var(--status-normal)]'
                              : 'bg-[var(--status-full)]/15 text-[var(--status-full)]'
                          }`}
                        >
                          {pkt.validationError
                            ? pkt.validationError.replace('ERR_', '')
                            : pkt.backendHttpStatus === 500
                              ? 'HTTP 500'
                              : pkt.outcome}
                        </span>
                        <div className="text-[10px] text-[var(--text-faint)] mt-0.5 tabular-nums">
                          ToA {pkt.airtimeMs} ms · SF{pkt.sf}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Python Serial Bridge & Reconnect Log */}
          <div className="card-surface p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[var(--accent)]" />
                Python Serial Bridge Log
              </span>
              <span className="font-mono text-[10px] text-[var(--text-faint)]">
                serial_bridge.py
              </span>
            </div>
            <div className="h-48 overflow-y-auto rounded-lg bg-[var(--bg)] p-2.5 border border-[var(--border)] font-mono text-[11px] space-y-1.5">
              {bridgeLogs.map((log) => (
                <div key={log.id} className="leading-snug">
                  <span className="text-[var(--text-faint)]">[{formatSimClock(log.simTime)}]</span>{' '}
                  <span
                    className={
                      log.level === 'ERROR'
                        ? 'text-[var(--status-full)] font-semibold'
                        : log.level === 'WARN'
                          ? 'text-[var(--status-filling)]'
                          : 'text-[var(--status-normal)]'
                    }
                  >
                    {log.level}:
                  </span>{' '}
                  <span className="text-[var(--text)]">{log.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 7 Cols: Packet Inspector Sheet (Raw Representation + Transformation Stepper + Latency Bar) */}
        <div className="lg:col-span-7 card-surface p-4 flex flex-col justify-between space-y-4">
          {!inspectedPacket ? (
            <EmptyState
              title="Select a packet to inspect"
              description="Click any packet row on the left to inspect its byte-level payload, JSON serial line, and validation steps."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-[var(--accent)]">
                    Packet Inspector: {inspectedPacket.binId} (Seq #{inspectedPacket.sequence})
                  </span>
                  <ProvenanceBadge provenance={inspectedPacket.provenance} />
                </div>
                <div className="font-mono text-xs text-[var(--text-muted)]">
                  Sent at {formatSimClock(inspectedPacket.sentAt)} · Hop:{' '}
                  <span className="text-[var(--text)] uppercase font-semibold">
                    {selectedPipelineHop}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left Column: Raw Representation at Each Hop */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    1. Raw Representation by Hop
                  </div>

                  {/* Hop A: Radio Frame */}
                  <div className="p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                      <span>HOP 1-2: LORA PHY / CSV PAYLOAD</span>
                      <span className="text-[var(--accent)]">
                        {inspectedPacket.payload.length} bytes · ToA {inspectedPacket.airtimeMs} ms
                      </span>
                    </div>
                    <div className="font-mono text-xs text-[var(--text)] bg-[var(--bg)] p-2 rounded border border-[var(--border)] break-all">
                      {inspectedPacket.payload}
                    </div>
                    <div className="font-mono text-[10px] text-[var(--text-faint)] break-all">
                      HEX: {stringToHexBytes(inspectedPacket.payload)}
                    </div>
                    <div className="font-mono text-[10px] text-[var(--text-muted)] pt-1">
                      SF{inspectedPacket.sf} · BW {inspectedPacket.bwKhz} kHz · CR 4/{inspectedPacket.cr} ·{' '}
                      {inspectedPacket.freqMhz} MHz · TX {inspectedPacket.txPowerDbm} dBm
                    </div>
                  </div>

                  {/* Hop B: Gateway USB Serial JSON Line */}
                  <div className="p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                      <span>HOP 3-5: GATEWAY SERIAL JSON LINE</span>
                      <span>
                        {inspectedPacket.receptions[0]
                          ? `${inspectedPacket.receptions[0].gatewayId} (${inspectedPacket.receptions[0].rssiDbm} dBm / ${inspectedPacket.receptions[0].snrDb} dB)`
                          : 'NO RECEPTION'}
                      </span>
                    </div>
                    <pre className="font-mono text-[11px] text-[var(--text)] bg-[var(--bg)] p-2 rounded border border-[var(--border)] overflow-x-auto whitespace-pre-wrap">
                      {inspectedPacket.gatewayJsonLine || '// Frame lost before serial output'}
                    </pre>
                  </div>

                  {/* Hop C: Backend API & Database Row */}
                  <div className="p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                      <span>HOP 7-8: BACKEND API &amp; DB RECORD</span>
                      <span
                        className={
                          inspectedPacket.backendHttpStatus === 201
                            ? 'text-[var(--status-normal)]'
                            : 'text-[var(--status-full)]'
                        }
                      >
                        HTTP {inspectedPacket.backendHttpStatus || 'NONE'}
                      </span>
                    </div>
                    <pre className="font-mono text-[11px] text-[var(--text)] bg-[var(--bg)] p-2 rounded border border-[var(--border)] overflow-x-auto">
                      {inspectedPacket.dbInserted
                        ? JSON.stringify(
                            {
                              table: 'telemetry_readings',
                              bin_id: inspectedPacket.binId,
                              sequence: inspectedPacket.sequence,
                              provenance: inspectedPacket.provenance,
                              committed: true,
                            },
                            null,
                            2
                          )
                        : `// No DB row inserted (${inspectedPacket.validationError || 'HTTP/RF failure'})`}
                    </pre>
                  </div>
                </div>

                {/* Right Column: Transformations Applied (Vertical Stepper with Pass/Fail Icons) */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    2. Transformations &amp; Validation Stepper
                  </div>

                  <div className="space-y-2">
                    {[
                      {
                        title: '1. Ultrasonic Median Filter & CSV Encode',
                        passed: true,
                        detail: `5 HC-SR04 samples filtered -> UTF-8 payload "${inspectedPacket.payload}"`,
                      },
                      {
                        title: '2. RF Demodulation & RSSI/SNR Attachment',
                        passed: inspectedPacket.outcome === 'DELIVERED',
                        detail:
                          inspectedPacket.outcome === 'DELIVERED'
                            ? `Received by ${inspectedPacket.receptions
                                .map((r) => `${r.gatewayId} (${r.rssiDbm} dBm, SNR ${r.snrDb} dB)`)
                                .join(', ')}`
                            : `Failed: ${inspectedPacket.outcome}`,
                      },
                      ...(networkMode === 'LORAWAN_SIM'
                        ? [
                            {
                              title: '3. LoRaWAN Network Server Deduplication & ADR',
                              passed: inspectedPacket.outcome === 'DELIVERED',
                              detail:
                                inspectedPacket.lorawanAdrCommand ||
                                `Merged ${inspectedPacket.receptions.length} gateway reception(s), MIC verified.`,
                            },
                          ]
                        : []),
                      {
                        title: '4. Python Bridge Schema & Range Validation',
                        passed:
                          inspectedPacket.outcome === 'DELIVERED' &&
                          inspectedPacket.validationPassed,
                        detail: inspectedPacket.validationPassed
                          ? 'V1 header valid, fill_level in [0..100], status enum valid'
                          : `Rejected: ${inspectedPacket.validationError}`,
                      },
                      {
                        title: '5. Duplicate Sequence Check',
                        passed:
                          inspectedPacket.outcome === 'DELIVERED' &&
                          !inspectedPacket.duplicateRejected &&
                          inspectedPacket.validationPassed,
                        detail: inspectedPacket.duplicateRejected
                          ? `Rejected duplicate sequence #${inspectedPacket.sequence}`
                          : `Sequence #${inspectedPacket.sequence} verified unique for ${inspectedPacket.binId}`,
                      },
                      {
                        title: '6. Database Commit & Hysteresis Alert Evaluation',
                        passed: inspectedPacket.dbInserted,
                        detail: inspectedPacket.dbInserted
                          ? 'Row inserted (HTTP 201) -> Hysteresis state evaluated (HIGH >=80/resolve <70, FULL >=95/resolve <85)'
                          : `Aborted (${
                              inspectedPacket.backendHttpStatus === 500
                                ? 'HTTP 500 Internal Server Error — bridge retry queued'
                                : 'Upstream validation failed'
                            })`,
                      },
                    ].map((stepItem, i) => (
                      <div
                        key={i}
                        className={`p-2.5 rounded-lg border flex items-start gap-2.5 ${
                          stepItem.passed
                            ? 'bg-[var(--surface-2)] border-[var(--border)]'
                            : 'bg-[var(--status-full)]/10 border-[var(--status-full)]/40'
                        }`}
                      >
                        {stepItem.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-[var(--status-normal)] shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-[var(--status-full)] shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[var(--text)]">
                            {stepItem.title}
                          </div>
                          <div className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5 break-words">
                            {stepItem.detail}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom: Stacked Horizontal Latency Budget Bar */}
              <div className="pt-3 border-t border-[var(--border)]">
                <LatencyBar latency={inspectedPacket.hopLatency} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
