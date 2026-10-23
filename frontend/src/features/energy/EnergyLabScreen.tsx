import React, { useState } from 'react';
import { BatteryCharging, Info, Sliders } from 'lucide-react';
import { KpiCard, ProvenanceBadge } from '../../components/Primitives';
import { compareDailyEnergySchedules } from '../../sim/energy';
import { useSimStore } from '../../store/simStore';

export const EnergyLabScreen: React.FC = () => {
  const energyParams = useSimStore((s) => s.energyParams);
  const setEnergyParams = useSimStore((s) => s.setEnergyParams);
  const scheduleMode = useSimStore((s) => s.scheduleMode);
  const setScheduleMode = useSimStore((s) => s.setScheduleMode);
  const networkMode = useSimStore((s) => s.networkMode);

  const [selectedSf, setSelectedSf] = useState<7 | 8 | 9 | 10 | 11 | 12>(9);
  const [selectedZone, setSelectedZone] = useState('market');

  const comparison = compareDailyEnergySchedules(
    energyParams,
    selectedSf,
    selectedZone,
    networkMode === 'LORAWAN_SIM'
  );

  const savingsPct = Math.round(
    ((comparison.fixedMahPerDay - comparison.adaptiveMahPerDay) /
      Math.max(0.0001, comparison.fixedMahPerDay)) *
      100
  );

  return (
    <div className="h-full w-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="card-surface p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BatteryCharging className="w-4 h-4 text-[var(--status-normal)]" />
            <h1 className="text-base font-semibold text-[var(--text)]">
              Estimated Energy (Model) — Fixed Interval vs Adaptive Schedule Lab
            </h1>
            <ProvenanceBadge provenance="SIMULATED" />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Side-by-side integral of node current draw across SLEEP, WAKE, HC-SR04 MEASURE, and LoRa TX states over 24 hours.
          </p>
        </div>

        {/* Active Schedule Switch */}
        <div className="flex items-center gap-1.5 bg-[var(--surface-2)] p-1 rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setScheduleMode('FIXED')}
            className={`px-3 py-1 rounded text-xs font-mono cursor-pointer transition ${
              scheduleMode === 'FIXED'
                ? 'bg-[var(--surface-3)] text-[var(--text)] font-bold border border-[var(--border-strong)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            Active Sim: FIXED ({energyParams.fixedIntervalMin}m)
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode('ADAPTIVE')}
            className={`px-3 py-1 rounded text-xs font-mono cursor-pointer transition ${
              scheduleMode === 'ADAPTIVE'
                ? 'bg-[var(--status-normal)]/20 text-[var(--status-normal)] font-bold border border-[var(--status-normal)]/40'
                : 'text-[var(--text-muted)]'
            }`}
          >
            Active Sim: ADAPTIVE
          </button>
        </div>
      </div>

      {/* Top 4 KPI Comparison Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Fixed Interval Energy / Day"
          value={`${comparison.fixedMahPerDay} mAh`}
          subtext={`${comparison.fixedPacketsPerDay} packets/day (every ${energyParams.fixedIntervalMin} min)`}
          provenance="SIMULATED"
        />
        <KpiCard
          label="Adaptive Schedule Energy / Day"
          value={`${comparison.adaptiveMahPerDay} mAh`}
          subtext={`${comparison.adaptivePacketsPerDay} packets/day (stretches at night)`}
          accentColor="var(--status-normal)"
          provenance="SIMULATED"
        />
        <KpiCard
          label="Estimated Battery Life (Fixed)"
          value={`~${comparison.fixedBatteryDays} days`}
          subtext={`Cell capacity: ${energyParams.batteryCapacityMah} mAh`}
          provenance="SIMULATED"
        />
        <KpiCard
          label="Estimated Battery Life (Adaptive)"
          value={`~${comparison.adaptiveBatteryDays} days`}
          subtext={`Model delta: ${savingsPct > 0 ? `+${savingsPct}% saved` : `${savingsPct}%`}`}
          accentColor="var(--accent)"
          provenance="SIMULATED"
        />
      </div>

      {/* Main Grid: Parameter Inputs + 24h Hourly Current-Draw Comparison Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 5 Cols: Configurable Current & Timing Parameters */}
        <div className="lg:col-span-5 card-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-[var(--accent)]" />
              Hardware Current &amp; Timing Parameters
            </span>
          </div>

          <div className="space-y-2.5 font-mono text-xs">
            {[
              {
                key: 'sleepCurrentMa',
                label: 'Deep Sleep Current (mA)',
                min: 0.01,
                max: 2.0,
                step: 0.01,
                val: energyParams.sleepCurrentMa,
              },
              {
                key: 'wakeCurrentMa',
                label: 'MCU Active / Wake Current (mA)',
                min: 2,
                max: 25,
                step: 0.5,
                val: energyParams.wakeCurrentMa,
              },
              {
                key: 'measureCurrentMa',
                label: 'HC-SR04 + MCU Measure Current (mA)',
                min: 5,
                max: 40,
                step: 1,
                val: energyParams.measureCurrentMa,
              },
              {
                key: 'txCurrentMa',
                label: 'LoRa RF Transmit Current (mA)',
                min: 35,
                max: 140,
                step: 5,
                val: energyParams.txCurrentMa,
              },
              {
                key: 'wakeTimeMs',
                label: 'Wake & Stabilise Duration (ms)',
                min: 20,
                max: 500,
                step: 10,
                val: energyParams.wakeTimeMs,
              },
              {
                key: 'measureTimeMs',
                label: '5-Sample Ultrasonic Measure Time (ms)',
                min: 100,
                max: 1000,
                step: 20,
                val: energyParams.measureTimeMs,
              },
              {
                key: 'fixedIntervalMin',
                label: 'Fixed Reporting Interval (minutes)',
                min: 2,
                max: 60,
                step: 2,
                val: energyParams.fixedIntervalMin,
              },
              {
                key: 'batteryCapacityMah',
                label: 'Cell Capacity (mAh, e.g. 18650 Li-ion)',
                min: 500,
                max: 5000,
                step: 100,
                val: energyParams.batteryCapacityMah,
              },
            ].map((input) => (
              <div key={input.key} className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">{input.label}</span>
                  <span className="font-bold text-[var(--accent)] tabular-nums">{input.val}</span>
                </div>
                <input
                  type="range"
                  min={input.min}
                  max={input.max}
                  step={input.step}
                  value={input.val}
                  onChange={(e) =>
                    setEnergyParams({ [input.key]: Number(e.target.value) })
                  }
                  className="w-full accent-[var(--accent)] cursor-pointer h-1.5"
                />
              </div>
            ))}

            <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between gap-2">
              <span>Spreading Factor (affects ToA):</span>
              <select
                value={selectedSf}
                onChange={(e) =>
                  setSelectedSf(Number(e.target.value) as typeof selectedSf)
                }
                className="px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)]"
              >
                {[7, 8, 9, 10, 11, 12].map((sf) => (
                  <option key={sf} value={sf}>
                    SF{sf}
                  </option>
                ))}
              </select>
              <span>Zone Profile:</span>
              <select
                value={selectedZone}
                onChange={(e) => setSelectedZone(e.target.value)}
                className="px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] uppercase"
              >
                {['market', 'terminal', 'stadium', 'campus', 'hospital', 'park', 'residential'].map(
                  (z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>
        </div>

        {/* Right 7 Cols: Side-by-Side 24-Hour Current Draw Timeline & Hourly Table */}
        <div className="lg:col-span-7 card-surface p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                24-Hour Hourly Current-Draw Timeline (06:00 → 06:00)
              </h2>
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="flex items-center gap-1 text-[var(--status-high)]">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[var(--status-high)]" /> Fixed Schedule
                </span>
                <span className="flex items-center gap-1 text-[var(--status-normal)]">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[var(--status-normal)]" /> Adaptive Schedule
                </span>
              </div>
            </div>

            {/* Bar Chart Comparing Hourly mAh */}
            <div className="h-56 bg-[var(--bg)] rounded-lg border border-[var(--border)] p-3 flex items-end gap-1.5">
              {comparison.hourlyProfile.map((h) => {
                const maxVal = Math.max(
                  ...comparison.hourlyProfile.map((x) =>
                    Math.max(x.fixedCurrentMeanMa, x.adaptiveCurrentMeanMa)
                  ),
                  0.08
                );
                const fixedH = Math.max(6, (h.fixedCurrentMeanMa / maxVal) * 165);
                const adaptH = Math.max(6, (h.adaptiveCurrentMeanMa / maxVal) * 165);

                return (
                  <div
                    key={h.hour}
                    className="flex-1 flex flex-col items-center gap-1 group"
                    title={`${h.timeLabel} — Fixed: ${h.fixedCurrentMeanMa} mAh (${h.fixedPackets} pkts) | Adaptive: ${h.adaptiveCurrentMeanMa} mAh (${h.adaptivePackets} pkts)`}
                  >
                    <div className="w-full flex items-end justify-center gap-0.5 h-44">
                      <div
                        style={{ height: `${fixedH}px` }}
                        className="w-2 rounded-t bg-[var(--status-high)]/80"
                      />
                      <div
                        style={{ height: `${adaptH}px` }}
                        className="w-2 rounded-t bg-[var(--status-normal)]"
                      />
                    </div>
                    <span className="font-mono text-[9px] text-[var(--text-faint)] -rotate-45 origin-top-left mt-1">
                      {h.timeLabel.slice(0, 2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hourly Packet & Current Breakdown Table */}
          <div className="overflow-x-auto max-h-48 border border-[var(--border)] rounded-lg">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="bg-[var(--surface-2)] border-b border-[var(--border)] text-[10px] text-[var(--text-muted)] uppercase">
                  <th className="py-1.5 px-2.5">Hour</th>
                  <th className="py-1.5 px-2.5">Fixed Pkts</th>
                  <th className="py-1.5 px-2.5">Adaptive Pkts</th>
                  <th className="py-1.5 px-2.5">Fixed mAh</th>
                  <th className="py-1.5 px-2.5">Adaptive mAh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/60">
                {comparison.hourlyProfile.map((h) => (
                  <tr key={h.hour} className="hover:bg-[var(--surface-2)]/40">
                    <td className="py-1 px-2.5 font-semibold">{h.timeLabel}</td>
                    <td className="py-1 px-2.5 tabular-nums">{h.fixedPackets}</td>
                    <td className="py-1 px-2.5 tabular-nums text-[var(--accent)]">
                      {h.adaptivePackets}
                    </td>
                    <td className="py-1 px-2.5 tabular-nums">{h.fixedCurrentMeanMa} mAh</td>
                    <td className="py-1 px-2.5 tabular-nums text-[var(--status-normal)]">
                      {h.adaptiveCurrentMeanMa} mAh
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mandatory Footer Disclaimer (Section 2 & Section 6.7) */}
          <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-strong)] flex items-center gap-2.5 text-xs font-mono text-[var(--text)]">
            <Info className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <span>
              Battery-life figures are model estimates. Measure real current draw before claiming improvement.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
