import React from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Flame,
  Navigation,
  ShieldAlert,
  Truck as TruckIcon,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { NORTHGATE_DISTRICT_GEO } from '../../data/districtGeo';
import {
  FillBar,
  KpiCard,
  ProvenanceBadge,
  StatusBadge,
} from '../../components/Primitives';
import { formatSimClock, isBinOffline } from '../../lib/format';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';

export const OperationsScreen: React.FC = () => {
  const bins = useSimStore((s) => s.bins);
  const alerts = useSimStore((s) => s.alerts);
  const trucks = useSimStore((s) => s.trucks);
  const simTimeSec = useSimStore((s) => s.simTimeSec);
  const acknowledgeAlert = useSimStore((s) => s.acknowledgeAlert);
  const dispatchTruck = useSimStore((s) => s.dispatchTruck);
  const setTruckBreakdown = useSimStore((s) => s.setTruckBreakdown);
  const selectBin = useUiStore((s) => s.selectBin);

  const binsAbove80 = bins.filter((b) => b.latestFillPct >= 80);
  const meanFill = Math.round(
    bins.reduce((acc, b) => acc + b.latestFillPct, 0) / Math.max(1, bins.length)
  );
  const elapsedHours = Math.max(1, simTimeSec / 3600);
  const alertsPerHour = (alerts.length / elapsedHours).toFixed(1);
  const totalCollected = trucks.reduce((acc, t) => acc + t.collectedToday, 0);
  const offlineCount = bins.filter((b) =>
    isBinOffline(simTimeSec, b.lastSeenSimTime, b.expectedIntervalSec)
  ).length;

  // Priority Dispatch Board: sorted by fill percent & estimated time to FULL
  const priorityQueue = [...bins]
    .sort((a, b) => b.latestFillPct - a.latestFillPct)
    .slice(0, 10)
    .map((bin) => {
      const remainingPct = Math.max(0, 95 - bin.latestFillPct);
      const estHrsToFull =
        bin.baseRate > 0 ? Number((remainingPct / (bin.baseRate * 1.4)).toFixed(1)) : 99;
      return { bin, estHrsToFull };
    });

  return (
    <div className="h-full w-full overflow-y-auto p-4 space-y-4">
      {/* Top 5-KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard
          label="Bins >= 80% (HIGH/FULL)"
          value={binsAbove80.length}
          subtext="Priority dispatch threshold"
          accentColor={binsAbove80.length > 0 ? 'var(--status-high)' : 'var(--status-normal)'}
          provenance="SIMULATED"
        />
        <KpiCard
          label="District Mean Fill"
          value={`${meanFill}%`}
          subtext="Across 24 ultrasonic nodes"
          provenance="SIMULATED"
        />
        <KpiCard
          label="Alerts / Sim Hour"
          value={alertsPerHour}
          subtext={`Total raised today: ${alerts.length}`}
          provenance="SIMULATED"
        />
        <KpiCard
          label="Collection Efficiency"
          value={`${totalCollected} bins`}
          subtext="Serviced by Alpha-1 & Bravo-2"
          accentColor="var(--status-normal)"
          provenance="SIMULATED"
        />
        <KpiCard
          label="Offline Nodes"
          value={offlineCount}
          subtext=">3 missed intervals"
          accentColor={offlineCount > 0 ? 'var(--status-offline)' : 'var(--text)'}
          provenance="SIMULATED"
        />
      </div>

      {/* Main Grid: Dispatch Board + Fleet Mini-Map + Alert Hysteresis Lifecycle Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 7 Cols: Priority Dispatch Board */}
        <div className="lg:col-span-7 card-surface p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Collection Priority Dispatch Board
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Ranked by reported fill level and estimated time to 95% FULL threshold.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  dispatchTruck(
                    'TRK-01',
                    priorityQueue.slice(0, 5).map((p) => p.bin.id)
                  )
                }
                className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[#041014] font-semibold text-xs flex items-center gap-1.5 hover:opacity-90 cursor-pointer"
              >
                <Navigation className="w-3.5 h-3.5" />
                Dispatch TRK-01 (Top 5)
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatchTruck(
                    'TRK-02',
                    priorityQueue.slice(5, 9).map((p) => p.bin.id)
                  )
                }
                className="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border-strong)] text-[var(--text)] font-semibold text-xs flex items-center gap-1.5 hover:bg-[var(--surface-3)] cursor-pointer"
              >
                <TruckIcon className="w-3.5 h-3.5" />
                Dispatch TRK-02 (Next 4)
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] font-mono uppercase text-[var(--text-muted)]">
                  <th className="py-2 px-2">Rank</th>
                  <th className="py-2 px-2">Bin Node</th>
                  <th className="py-2 px-2">Zone</th>
                  <th className="py-2 px-2">Reported Fill</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Est. Time to FULL</th>
                  <th className="py-2 px-2">Assign</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/60">
                {priorityQueue.map(({ bin, estHrsToFull }, idx) => (
                  <tr key={bin.id} className="hover:bg-[var(--surface-2)]/50">
                    <td className="py-2 px-2 font-mono font-bold text-[var(--text-muted)]">
                      #{idx + 1}
                    </td>
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={() => selectBin(bin.id, true)}
                        className="font-mono font-bold text-[var(--accent)] hover:underline cursor-pointer"
                      >
                        {bin.id}
                      </button>
                      <div className="text-[10px] text-[var(--text-muted)]">{bin.name}</div>
                    </td>
                    <td className="py-2 px-2 font-mono text-[11px] uppercase">{bin.zoneId}</td>
                    <td className="py-2 px-2">
                      <FillBar fillPct={bin.latestFillPct} status={bin.latestStatus} />
                    </td>
                    <td className="py-2 px-2">
                      <StatusBadge status={bin.latestStatus} suspect={bin.suspectSensor} size="sm" />
                    </td>
                    <td className="py-2 px-2 font-mono text-xs tabular-nums">
                      {bin.latestFillPct >= 95 ? (
                        <span className="text-[var(--status-full)] font-semibold">NOW (FULL)</span>
                      ) : (
                        <span>~{estHrsToFull} hrs</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={() => dispatchTruck('TRK-01', [bin.id])}
                        className="px-2 py-1 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] font-mono text-[10px] cursor-pointer"
                      >
                        +TRK-01
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 5 Cols: Fleet Route Mini-Map & Truck Controls */}
        <div className="lg:col-span-5 card-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Live Fleet Route Mini-Map &amp; Vehicle Status
            </h2>
            <ProvenanceBadge provenance="SIMULATED" compact />
          </div>

          <div className="rounded-lg bg-[var(--map-land)] border border-[var(--border)] p-2">
            <svg viewBox="0 0 1000 700" className="w-full h-48">
              {NORTHGATE_DISTRICT_GEO.roads.map((r) => (
                <polyline
                  key={r.id}
                  points={r.points.map((p) => `${p[0]},${p[1]}`).join(' ')}
                  fill="none"
                  stroke="var(--map-road)"
                  strokeWidth={r.major ? 12 : 6}
                />
              ))}
              {bins.map((b) => (
                <circle
                  key={b.id}
                  cx={b.position.x}
                  cy={b.position.y}
                  r="9"
                  fill={
                    b.latestStatus === 'FULL'
                      ? 'var(--status-full)'
                      : b.latestStatus === 'HIGH'
                        ? 'var(--status-high)'
                        : 'var(--status-normal)'
                  }
                />
              ))}
              {trucks.map((t) => (
                <g key={t.id}>
                  {t.routePoints.length > 0 && (
                    <polyline
                      points={[
                        `${t.position.x},${t.position.y}`,
                        ...t.routePoints.map((p) => `${p.x},${p.y}`),
                      ].join(' ')}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="5"
                      strokeDasharray="10 6"
                    />
                  )}
                  <rect
                    x={t.position.x - 16}
                    y={t.position.y - 16}
                    width="32"
                    height="32"
                    rx="6"
                    fill="var(--surface-1)"
                    stroke="var(--accent)"
                    strokeWidth="4"
                  />
                </g>
              ))}
            </svg>
          </div>

          <div className="space-y-2">
            {trucks.map((t) => (
              <div
                key={t.id}
                className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-between gap-2 text-xs"
              >
                <div>
                  <div className="font-mono font-bold text-[var(--text)]">
                    {t.id} — {t.name} ({t.status})
                  </div>
                  <div className="font-mono text-[11px] text-[var(--text-muted)]">
                    Stop Queue: {t.assignedBinIds.length > 0 ? t.assignedBinIds.join(', ') : 'Idle'} ·{' '}
                    ETA: {t.etaSimTime ? formatSimClock(t.etaSimTime, false) : '—'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTruckBreakdown(t.id, t.status !== 'BROKEN_DOWN')}
                  className={`px-2.5 py-1 rounded font-mono text-[11px] border flex items-center gap-1 cursor-pointer ${
                    t.status === 'BROKEN_DOWN'
                      ? 'bg-[var(--status-normal)]/20 border-[var(--status-normal)] text-[var(--status-normal)]'
                      : 'bg-[var(--surface-3)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--status-full)]'
                  }`}
                >
                  <Wrench className="w-3 h-3" />
                  {t.status === 'BROKEN_DOWN' ? 'Repair Truck' : 'Simulate Breakdown'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom: Active & Historical Alerts with Hysteresis Thresholds Shown */}
      <div className="card-surface p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">
              Alert Lifecycle &amp; Hysteresis Transitions Log ({alerts.length})
            </h2>
            <p className="text-xs text-[var(--text-muted)] font-mono">
              Hysteresis rules: HIGH raises at &ge;80% and resolves only &lt;70% · FULL raises at &ge;95% and downgrades only &lt;85% · One alert per state transition
            </p>
          </div>
        </div>

        <div className="overflow-x-auto max-h-72">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--text-muted)]">
                <th className="py-2 px-3">Entity</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Provenance</th>
                <th className="py-2 px-3">Message</th>
                <th className="py-2 px-3">Raised At</th>
                <th className="py-2 px-3">Ack At</th>
                <th className="py-2 px-3">Resolved At (Hysteresis)</th>
                <th className="py-2 px-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/60">
              {alerts.map((a) => (
                <tr key={a.id} className="hover:bg-[var(--surface-2)]/50">
                  <td className="py-2 px-3 font-bold">{a.binId}</td>
                  <td className="py-2 px-3">
                    <span className="px-1.5 py-0.5 rounded bg-[var(--status-full)]/15 text-[var(--status-full)] text-[10px]">
                      {a.type}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <ProvenanceBadge provenance={a.provenance} compact />
                  </td>
                  <td className="py-2 px-3 font-sans">{a.message}</td>
                  <td className="py-2 px-3 tabular-nums">{formatSimClock(a.createdAt)}</td>
                  <td className="py-2 px-3 tabular-nums">
                    {a.acknowledgedAt ? formatSimClock(a.acknowledgedAt) : '—'}
                  </td>
                  <td className="py-2 px-3 tabular-nums text-[var(--status-normal)]">
                    {a.resolvedAt ? formatSimClock(a.resolvedAt) : 'ACTIVE'}
                  </td>
                  <td className="py-2 px-3">
                    {!a.acknowledgedAt && !a.resolvedAt && (
                      <button
                        type="button"
                        onClick={() => acknowledgeAlert(a.id)}
                        className="px-2 py-0.5 rounded bg-[var(--surface-3)] hover:bg-[var(--border)] text-[10px] cursor-pointer"
                      >
                        Ack
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
