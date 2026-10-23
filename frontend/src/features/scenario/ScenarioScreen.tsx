import React, { useState } from 'react';
import {
  Clapperboard,
  CloudRain,
  Flame,
  Play,
  Power,
  ShieldAlert,
  Sliders,
  Truck as TruckIcon,
  Users,
  Zap,
} from 'lucide-react';
import { ProvenanceBadge, StatusBadge } from '../../components/Primitives';
import { SensorFaultType } from '../../sim/types';
import { useSimStore } from '../../store/simStore';

export const ScenarioScreen: React.FC = () => {
  const scriptedEvents = useSimStore((s) => s.scriptedEvents);
  const triggerScenarioEvent = useSimStore((s) => s.triggerScenarioEvent);
  const toggleScenarioEvent = useSimStore((s) => s.toggleScenarioEvent);
  const bins = useSimStore((s) => s.bins);
  const gateways = useSimStore((s) => s.gateways);
  const trucks = useSimStore((s) => s.trucks);
  const weather = useSimStore((s) => s.weather);
  const setWeather = useSimStore((s) => s.setWeather);
  const setGatewayOnline = useSimStore((s) => s.setGatewayOnline);
  const setBinFault = useSimStore((s) => s.setBinFault);
  const setZoneCrowd = useSimStore((s) => s.setZoneCrowd);
  const zoneCrowdMultipliers = useSimStore((s) => s.zoneCrowdMultipliers);
  const setTruckBreakdown = useSimStore((s) => s.setTruckBreakdown);
  const injectDemoFill = useSimStore((s) => s.injectDemoFill);

  const [demoBinId, setDemoBinId] = useState('BIN-07');
  const [demoFillSlider, setDemoFillSlider] = useState(85);
  const [faultBinId, setFaultBinId] = useState('BIN-07');
  const [selectedZone, setSelectedZone] = useState('market');

  const demoBin = bins.find((b) => b.id === demoBinId) ?? bins[0];

  return (
    <div className="h-full w-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="card-surface p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Clapperboard className="w-4 h-4 text-[var(--accent)]" />
            <h1 className="text-base font-semibold text-[var(--text)]">
              Scenario Director &amp; Manual Fault / Demo Injectors
            </h1>
            <ProvenanceBadge provenance="SIMULATED" />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Orchestrate the scripted 24-hour "A Day in Northgate" timeline, inject physical/RF anomalies, or push manual Demo Mode readings.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 7 Cols: Scripted Event Timeline Cards */}
        <div className="lg:col-span-7 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Scripted Event Timeline ("A Day in Northgate" — 06:00 to 06:00)
          </div>

          <div className="space-y-2.5">
            {scriptedEvents.map((evt) => (
              <div
                key={evt.id}
                className={`card-surface p-3.5 transition ${
                  evt.triggered
                    ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)]/30'
                    : 'hover:border-[var(--border-strong)]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-[var(--surface-3)] text-[var(--accent)] border border-[var(--border)]">
                      {evt.timeLabel}
                    </span>
                    <span className="font-semibold text-sm text-[var(--text)]">{evt.title}</span>
                    {evt.triggered && (
                      <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-[var(--status-normal)]/15 text-[var(--status-normal)]">
                        TRIGGERED
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={evt.enabled}
                        onChange={(e) => toggleScenarioEvent(evt.id, e.target.checked)}
                        className="accent-[var(--accent)] cursor-pointer"
                      />
                      <span>Auto-fire</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => triggerScenarioEvent(evt.id)}
                      className="px-2.5 py-1 rounded-md bg-[var(--accent)] text-[#041014] font-semibold text-xs flex items-center gap-1 hover:opacity-90 cursor-pointer"
                    >
                      <Play className="w-3 h-3" /> Trigger Now
                    </button>
                  </div>
                </div>

                <p className="text-xs text-[var(--text-muted)] mt-1.5">{evt.description}</p>
                <div className="mt-2 text-[11px] font-mono text-[var(--sim)]">
                  Demonstrates: {evt.demonstrates}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right 5 Cols: Demo Mode Panel + Manual Anomaly Injectors */}
        <div className="lg:col-span-5 space-y-4">
          {/* Demo Mode Panel (Mirrors architecture's demo endpoint, tagged SIMULATED (demo)) */}
          <div className="card-surface p-4 space-y-3 border-[var(--sim)]/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[var(--sim)]" />
                <h2 className="text-sm font-semibold text-[var(--text)]">
                  Demo Mode Telemetry Injector
                </h2>
              </div>
              <ProvenanceBadge provenance="SIMULATED_DEMO" />
            </div>

            <p className="text-xs text-[var(--text-muted)]">
              Mirrors the backend demo endpoint. Push any fill level to immediately evaluate NORMAL, FILLING, HIGH, or FULL transitions and hysteresis alerts. Every demo reading is explicitly tagged <code className="text-[var(--sim)]">SIMULATED (DEMO)</code>.
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-mono text-[var(--text-muted)]">
                Target Smart Bin:
              </label>
              <select
                value={demoBinId}
                onChange={(e) => setDemoBinId(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border-strong)] font-mono text-xs text-[var(--text)]"
              >
                {bins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id} — {b.name} (Current: {Math.round(b.latestFillPct)}% {b.latestStatus})
                  </option>
                ))}
              </select>
            </div>

            {demoBin && (
              <div className="p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-between">
                <span className="font-mono text-xs">
                  {demoBin.id} Current State: <strong>{Math.round(demoBin.latestFillPct)}%</strong>
                </span>
                <StatusBadge status={demoBin.latestStatus} suspect={demoBin.suspectSensor} size="sm" />
              </div>
            )}

            {/* Quick State Buttons: 20%, 65%, 85%, 97% */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-[var(--text-muted)]">
                Quick State Presets:
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { pct: 20, label: '20% -> NORMAL', color: 'var(--status-normal)' },
                  { pct: 65, label: '65% -> FILLING', color: 'var(--status-filling)' },
                  { pct: 85, label: '85% -> HIGH Alert', color: 'var(--status-high)' },
                  { pct: 97, label: '97% -> FULL Alert', color: 'var(--status-full)' },
                ].map((btn) => (
                  <button
                    key={btn.pct}
                    type="button"
                    onClick={() => {
                      setDemoFillSlider(btn.pct);
                      injectDemoFill(demoBinId, btn.pct);
                    }}
                    className="py-2 px-3 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-strong)] font-mono text-xs font-semibold text-left flex items-center justify-between cursor-pointer transition"
                  >
                    <span style={{ color: btn.color }}>{btn.label}</span>
                    <Zap className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Fill Slider */}
            <div className="space-y-2 pt-2 border-t border-[var(--border)]">
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[var(--text-muted)]">Custom Fill Level Slider:</span>
                <span className="font-bold text-[var(--accent)] tabular-nums">
                  {demoFillSlider}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={demoFillSlider}
                onChange={(e) => setDemoFillSlider(Number(e.target.value))}
                className="w-full accent-[var(--sim)] cursor-pointer"
              />
              <button
                type="button"
                onClick={() => injectDemoFill(demoBinId, demoFillSlider)}
                className="w-full py-2 rounded-lg bg-[var(--sim)] text-[#090414] font-semibold text-xs hover:opacity-90 transition cursor-pointer"
              >
                Push {demoFillSlider}% Demo Reading to {demoBinId}
              </button>
            </div>
          </div>

          {/* Manual Environment & Hardware Anomaly Injectors */}
          <div className="card-surface p-4 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Manual Environment &amp; Hardware Injectors
            </h2>

            {/* 1. Weather */}
            <div className="space-y-1.5">
              <div className="text-xs font-mono text-[var(--text-muted)] flex items-center gap-1.5">
                <CloudRain className="w-3.5 h-3.5 text-[var(--accent)]" />
                1. Weather Attenuation (Path Loss &amp; Noise Floor)
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['CLEAR', 'RAIN', 'STORM'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWeather(w)}
                    className={`py-1.5 rounded font-mono text-xs border cursor-pointer ${
                      weather === w
                        ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-bold'
                        : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)]'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Gateway Power Failure */}
            <div className="space-y-1.5">
              <div className="text-xs font-mono text-[var(--text-muted)] flex items-center gap-1.5">
                <Power className="w-3.5 h-3.5 text-[var(--status-full)]" />
                2. Gateway Mains Power Failure
              </div>
              <div className="grid grid-cols-3 gap-2">
                {gateways.map((gw) => (
                  <button
                    key={gw.id}
                    type="button"
                    onClick={() => setGatewayOnline(gw.id, !gw.online)}
                    className={`py-1.5 px-2 rounded font-mono text-xs border cursor-pointer ${
                      gw.online
                        ? 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--status-normal)]'
                        : 'bg-[var(--status-full)]/20 border-[var(--status-full)] text-[var(--status-full)] font-bold'
                    }`}
                  >
                    {gw.id}: {gw.online ? 'ON' : 'OFF'}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Sensor Fault Type */}
            <div className="space-y-1.5">
              <div className="text-xs font-mono text-[var(--text-muted)] flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-[var(--status-high)]" />
                3. Ultrasonic Transducer Fault Injector
              </div>
              <div className="flex gap-2">
                <select
                  value={faultBinId}
                  onChange={(e) => setFaultBinId(e.target.value)}
                  className="px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] font-mono text-xs"
                >
                  {bins.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.id}
                    </option>
                  ))}
                </select>
                <div className="flex-1 flex flex-wrap gap-1">
                  {(['NONE', 'BLOCKED', 'SPIKE', 'STUCK', 'DRIFT'] as SensorFaultType[]).map(
                    (f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setBinFault(faultBinId, f)}
                        className="px-2 py-1 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] font-mono text-[10px] cursor-pointer"
                      >
                        {f}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* 4. Zone Crowd Intensity Slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-[var(--text-muted)]">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-[var(--accent)]" />
                  4. Zone Crowd Surge Multiplier
                </span>
                <span className="text-[var(--accent)] font-bold">
                  {(zoneCrowdMultipliers[selectedZone] ?? 1.0).toFixed(1)}x
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedZone}
                  onChange={(e) => setSelectedZone(e.target.value)}
                  className="px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] font-mono text-xs uppercase"
                >
                  {Object.keys(zoneCrowdMultipliers).map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
                <input
                  type="range"
                  min={0.2}
                  max={5.0}
                  step={0.2}
                  value={zoneCrowdMultipliers[selectedZone] ?? 1.0}
                  onChange={(e) => setZoneCrowd(selectedZone, Number(e.target.value))}
                  className="flex-1 accent-[var(--accent)] cursor-pointer"
                />
              </div>
            </div>

            {/* 5. Truck Breakdown */}
            <div className="space-y-1.5">
              <div className="text-xs font-mono text-[var(--text-muted)] flex items-center gap-1.5">
                <TruckIcon className="w-3.5 h-3.5 text-[var(--status-normal)]" />
                5. Fleet Vehicle Mechanical Breakdown
              </div>
              <div className="grid grid-cols-2 gap-2">
                {trucks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTruckBreakdown(t.id, t.status !== 'BROKEN_DOWN')}
                    className={`py-1.5 px-2 rounded font-mono text-xs border cursor-pointer ${
                      t.status === 'BROKEN_DOWN'
                        ? 'bg-[var(--status-full)]/20 border-[var(--status-full)] text-[var(--status-full)] font-bold'
                        : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)]'
                    }`}
                  >
                    {t.id}: {t.status}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
