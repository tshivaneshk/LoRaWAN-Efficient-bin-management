import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Flame,
  Navigation,
  Play,
  Radio,
  ShieldAlert,
  Truck as TruckIcon,
  WifiOff,
} from 'lucide-react';
import {
  EmptyState,
  FillBar,
  ProvenanceBadge,
  Sparkline,
  StatusBadge,
} from '../../components/Primitives';
import { formatRelativeAge, formatSimClock, isBinOffline } from '../../lib/format';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import { DistrictMap } from './DistrictMap';

export const CommandCenterScreen: React.FC = () => {
  const bins = useSimStore((s) => s.bins);
  const alerts = useSimStore((s) => s.alerts);
  const trucks = useSimStore((s) => s.trucks);
  const simTimeSec = useSimStore((s) => s.simTimeSec);
  const running = useSimStore((s) => s.running);
  const play = useSimStore((s) => s.play);
  const acknowledgeAlert = useSimStore((s) => s.acknowledgeAlert);
  const dispatchTruck = useSimStore((s) => s.dispatchTruck);
  const scriptedEvents = useSimStore((s) => s.scriptedEvents);
  const timelineHistory = useSimStore((s) => s.timelineHistory);
  const scrubToTime = useSimStore((s) => s.scrubToTime);
  const triggerScenarioEvent = useSimStore((s) => s.triggerScenarioEvent);

  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);
  const selectBin = useUiStore((s) => s.selectBin);
  const selectedBinId = useUiStore((s) => s.selectedBinId);
  const timelineCollapsed = useUiStore((s) => s.timelineCollapsed);
  const setTimelineCollapsed = useUiStore((s) => s.setTimelineCollapsed);

  const [sortBy, setSortBy] = useState<'fill' | 'id' | 'rssi' | 'battery'>('fill');
  const [sortAsc, setSortAsc] = useState(false);

  const sortedBins = useMemo(() => {
    const copy = [...bins];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'fill') cmp = a.latestFillPct - b.latestFillPct;
      else if (sortBy === 'id') cmp = a.id.localeCompare(b.id);
      else if (sortBy === 'rssi') cmp = (a.lastRssiDbm ?? -120) - (b.lastRssiDbm ?? -120);
      else if (sortBy === 'battery') cmp = a.batteryPct - b.batteryPct;
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [bins, sortBy, sortAsc]);

  const activeAlerts = alerts.filter((a) => !a.resolvedAt);
  const highPriorityBinIds = bins
    .filter((b) => b.latestFillPct >= 80)
    .sort((a, b) => b.latestFillPct - a.latestFillPct)
    .map((b) => b.id);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else {
      setSortBy(col);
      setSortAsc(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Live region for screen readers announcing new FULL alerts */}
      <div className="sr-only" role="status" aria-live="polite">
        {activeAlerts[0]?.type === 'FULL' ? activeAlerts[0].message : ''}
      </div>

      {/* Top Zone: Map (~65%) + Right Panel (~35%) */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Zone A: 2D District Operations Map */}
        <div className="flex-1 lg:w-[64%] h-[52vh] lg:h-full relative border-b lg:border-b-0 lg:border-r border-[var(--border)]">
          <DistrictMap />
        </div>

        {/* Zone B: Right Panel (~36%, tabbed: Alerts, Bins, Fleet) */}
        <div className="w-full lg:w-[36%] h-[48vh] lg:h-full flex flex-col bg-[var(--surface-1)] min-h-0">
          {/* KPI Summary Strip */}
          <div className="grid grid-cols-4 gap-2 p-3 border-b border-[var(--border)] bg-[var(--surface-2)]/50">
            <div className="p-2 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
              <div className="text-[10px] font-mono uppercase text-[var(--text-faint)]">
                Active Alerts
              </div>
              <div className="text-lg font-semibold font-mono tabular-nums text-[var(--status-full)]">
                {activeAlerts.length}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
              <div className="text-[10px] font-mono uppercase text-[var(--text-faint)]">
                Bins &ge;80%
              </div>
              <div className="text-lg font-semibold font-mono tabular-nums text-[var(--status-high)]">
                {highPriorityBinIds.length}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
              <div className="text-[10px] font-mono uppercase text-[var(--text-faint)]">
                Mean Fill
              </div>
              <div className="text-lg font-semibold font-mono tabular-nums text-[var(--text)]">
                {Math.round(
                  bins.reduce((acc, b) => acc + b.latestFillPct, 0) / Math.max(1, bins.length)
                )}
                %
              </div>
            </div>
            <div className="p-2 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
              <div className="text-[10px] font-mono uppercase text-[var(--text-faint)]">
                Offline
              </div>
              <div className="text-lg font-semibold font-mono tabular-nums text-[var(--status-offline)]">
                {
                  bins.filter((b) =>
                    isBinOffline(simTimeSec, b.lastSeenSimTime, b.expectedIntervalSec)
                  ).length
                }
              </div>
            </div>
          </div>

          {/* Panel Tabs */}
          <div className="flex items-center border-b border-[var(--border)] px-3 pt-2 gap-1 bg-[var(--surface-1)]">
            <button
              type="button"
              onClick={() => setRightPanelTab('alerts')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                rightPanelTab === 'alerts'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Alerts</span>
              {activeAlerts.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[var(--status-full)]/20 text-[var(--status-full)] font-mono text-[10px]">
                  {activeAlerts.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setRightPanelTab('bins')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                rightPanelTab === 'bins'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <span>Bins ({bins.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setRightPanelTab('fleet')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                rightPanelTab === 'fleet'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <TruckIcon className="w-3.5 h-3.5" />
              <span>Fleet ({trucks.length})</span>
            </button>
          </div>

          {/* Tab Content Area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {rightPanelTab === 'alerts' && (
              <>
                {alerts.length === 0 ? (
                  <EmptyState
                    title="No alerts raised yet"
                    description="Press Play or trigger the 12:30 Market Spike / 17:00 Stadium Event to observe hysteresis alert transitions."
                    actionLabel={running ? 'Trigger 12:30 Market Spike' : 'Start Simulation'}
                    onAction={() =>
                      running ? triggerScenarioEvent('EVT-1230') : play()
                    }
                  />
                ) : (
                  alerts.map((alert) => {
                    const stateLabel = alert.resolvedAt
                      ? 'Resolved'
                      : alert.acknowledgedAt
                        ? 'Acknowledged'
                        : 'Active';
                    const isFull = alert.type === 'FULL' || alert.type === 'SENSOR_SUSPECT';

                    return (
                      <div
                        key={alert.id}
                        className={`p-3 rounded-lg border transition ${
                          alert.resolvedAt
                            ? 'bg-[var(--surface-2)]/40 border-[var(--border)] opacity-65'
                            : isFull
                              ? 'bg-[var(--status-full)]/8 border-[var(--status-full)]/40'
                              : 'bg-[var(--surface-2)] border-[var(--border-strong)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {alert.type === 'FULL' ? (
                              <Flame className="w-4 h-4 text-[var(--status-full)] shrink-0" />
                            ) : alert.type === 'SENSOR_SUSPECT' ? (
                              <ShieldAlert className="w-4 h-4 text-[var(--status-full)] shrink-0" />
                            ) : alert.type === 'OFFLINE' || alert.type === 'GATEWAY_DOWN' ? (
                              <WifiOff className="w-4 h-4 text-[var(--status-offline)] shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-[var(--status-high)] shrink-0" />
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (alert.binId.startsWith('BIN-')) {
                                  selectBin(alert.binId, true);
                                }
                              }}
                              className="font-mono text-xs font-bold text-[var(--text)] hover:text-[var(--accent)] cursor-pointer"
                            >
                              {alert.binId}
                            </button>
                            <ProvenanceBadge provenance={alert.provenance} compact />
                          </div>

                          <div className="flex items-center gap-1.5 font-mono text-[10px]">
                            <span className="text-[var(--text-faint)]">
                              {formatSimClock(alert.createdAt)}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded uppercase ${
                                stateLabel === 'Active'
                                  ? 'bg-[var(--status-full)]/20 text-[var(--status-full)]'
                                  : stateLabel === 'Acknowledged'
                                    ? 'bg-[var(--status-filling)]/20 text-[var(--status-filling)]'
                                    : 'bg-[var(--status-normal)]/20 text-[var(--status-normal)]'
                              }`}
                            >
                              {stateLabel}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-[var(--text)] mt-1.5 leading-snug">
                          {alert.message}
                        </p>

                        {!alert.resolvedAt && (
                          <div className="flex items-center gap-2 mt-2.5">
                            {!alert.acknowledgedAt && (
                              <button
                                type="button"
                                onClick={() => acknowledgeAlert(alert.id)}
                                className="px-2 py-1 rounded text-[11px] font-medium bg-[var(--surface-3)] hover:bg-[var(--border)] text-[var(--text)] flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-3 h-3" /> Acknowledge
                              </button>
                            )}
                            {alert.binId.startsWith('BIN-') && (
                              <button
                                type="button"
                                onClick={() => dispatchTruck('TRK-01', [alert.binId])}
                                className="px-2 py-1 rounded text-[11px] font-medium bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/25 flex items-center gap-1 cursor-pointer"
                              >
                                <TruckIcon className="w-3 h-3" /> Dispatch Truck
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            {rightPanelTab === 'bins' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] font-mono uppercase text-[var(--text-muted)]">
                      <th className="py-2 px-1.5">
                        <button
                          type="button"
                          onClick={() => toggleSort('id')}
                          className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]"
                        >
                          ID <ArrowUpDown className="w-2.5 h-2.5" />
                        </button>
                      </th>
                      <th className="py-2 px-1.5">
                        <button
                          type="button"
                          onClick={() => toggleSort('fill')}
                          className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]"
                        >
                          Fill <ArrowUpDown className="w-2.5 h-2.5" />
                        </button>
                      </th>
                      <th className="py-2 px-1.5">Status</th>
                      <th className="py-2 px-1.5">
                        <button
                          type="button"
                          onClick={() => toggleSort('rssi')}
                          className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]"
                        >
                          RF Link <ArrowUpDown className="w-2.5 h-2.5" />
                        </button>
                      </th>
                      <th className="py-2 px-1.5">Age</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]/60">
                    {sortedBins.map((bin) => {
                      const offline = isBinOffline(
                        simTimeSec,
                        bin.lastSeenSimTime,
                        bin.expectedIntervalSec
                      );
                      const isSel = bin.id === selectedBinId;
                      return (
                        <tr
                          key={bin.id}
                          onClick={() => selectBin(bin.id, true)}
                          className={`cursor-pointer transition ${
                            isSel
                              ? 'bg-[var(--accent-soft)]'
                              : 'hover:bg-[var(--surface-2)]'
                          }`}
                        >
                          <td className="py-2 px-1.5">
                            <div className="font-mono font-semibold text-[var(--text)]">
                              {bin.id}
                            </div>
                            <div className="text-[10px] text-[var(--text-faint)] uppercase">
                              {bin.zoneId}
                            </div>
                          </td>
                          <td className="py-2 px-1.5">
                            <FillBar
                              fillPct={bin.latestFillPct}
                              status={offline ? 'OFFLINE' : bin.latestStatus}
                            />
                          </td>
                          <td className="py-2 px-1.5">
                            <div className="flex flex-col items-start gap-1">
                              <StatusBadge
                                status={offline ? 'OFFLINE' : bin.latestStatus}
                                suspect={bin.suspectSensor}
                                size="sm"
                              />
                              <ProvenanceBadge provenance={bin.provenance} compact />
                            </div>
                          </td>
                          <td className="py-2 px-1.5 font-mono text-[11px] tabular-nums">
                            <div>{bin.lastRssiDbm ?? -95} dBm</div>
                            <div className="text-[10px] text-[var(--text-muted)]">
                              SNR {bin.lastSnrDb ?? 0} dB · SF{bin.sf}
                            </div>
                          </td>
                          <td className="py-2 px-1.5 font-mono text-[10px] text-[var(--text-muted)]">
                            {formatRelativeAge(simTimeSec, bin.lastSeenSimTime)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {rightPanelTab === 'fleet' && (
              <div className="space-y-3">
                {trucks.map((truck) => (
                  <div
                    key={truck.id}
                    className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TruckIcon className="w-4 h-4 text-[var(--status-normal)]" />
                        <div>
                          <div className="font-mono text-xs font-semibold">{truck.name}</div>
                          <div className="text-[10px] font-mono text-[var(--text-muted)]">
                            ID: {truck.id} · Collected today: {truck.collectedToday} bins
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-[var(--surface-3)] border border-[var(--border)]">
                        {truck.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="p-2 rounded bg-[var(--surface-1)] border border-[var(--border)]">
                        <div className="text-[10px] text-[var(--text-faint)]">HOPPER LOAD</div>
                        <div className="font-semibold tabular-nums">{truck.loadPct}%</div>
                      </div>
                      <div className="p-2 rounded bg-[var(--surface-1)] border border-[var(--border)]">
                        <div className="text-[10px] text-[var(--text-faint)]">ETA</div>
                        <div className="font-semibold tabular-nums">
                          {truck.etaSimTime ? formatSimClock(truck.etaSimTime, false) : 'Standby'}
                        </div>
                      </div>
                    </div>

                    {truck.assignedBinIds.length > 0 && (
                      <div className="text-[11px] font-mono text-[var(--text-muted)]">
                        Assigned Queue: {truck.assignedBinIds.join(' -> ')}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const targets =
                          highPriorityBinIds.length > 0
                            ? highPriorityBinIds.slice(0, 5)
                            : ['BIN-06', 'BIN-07', 'BIN-08', 'BIN-15'];
                        dispatchTruck(truck.id, targets);
                      }}
                      className="w-full py-1.5 px-3 rounded-md bg-[var(--accent)] text-[#041014] font-semibold text-xs flex items-center justify-center gap-1.5 hover:opacity-90 transition cursor-pointer"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      <span>
                        Suggested Route (
                        {highPriorityBinIds.length > 0
                          ? `${highPriorityBinIds.slice(0, 5).length} Priority Bins >=80%`
                          : 'Top 4 District Bins'}
                        )
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Zone C: Bottom Scrubbable Day Timeline (collapsible, ~150px) */}
      <div
        className={`border-t border-[var(--border)] bg-[var(--surface-1)] transition-all duration-200 shrink-0 ${
          timelineCollapsed ? 'h-9' : 'h-38'
        }`}
      >
        <div className="h-9 px-4 flex items-center justify-between border-b border-[var(--border)]/60">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold uppercase tracking-wider text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[var(--accent)]" />
              24-Hour Scenario Timeline (06:00 → 06:00)
            </span>
            <span className="font-mono text-[11px] text-[var(--text-faint)] hidden md:inline">
              Click any scripted event marker or drag scrubber to replay state
            </span>
          </div>

          <button
            type="button"
            onClick={() => setTimelineCollapsed(!timelineCollapsed)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1 cursor-pointer"
          >
            <span>{timelineCollapsed ? 'Expand Timeline' : 'Collapse'}</span>
            {timelineCollapsed ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {!timelineCollapsed && (
          <div className="px-4 py-2.5 flex flex-col justify-between h-[114px]">
            {/* Scripted Event Markers Row */}
            <div className="relative h-8 flex items-center">
              <input
                type="range"
                min={0}
                max={86400}
                step={60}
                value={simTimeSec}
                onChange={(e) => scrubToTime(Number(e.target.value))}
                aria-label="Scrub simulation time across 24 hour day"
                className="w-full accent-[var(--accent)] cursor-pointer h-1.5 rounded-lg bg-[var(--surface-3)]"
              />
              {scriptedEvents.map((evt) => {
                const leftPct = (evt.simTimeSec / 86400) * 100;
                return (
                  <button
                    key={evt.id}
                    type="button"
                    onClick={() => triggerScenarioEvent(evt.id)}
                    style={{ left: `${leftPct}%` }}
                    title={`${evt.timeLabel} — ${evt.title}: ${evt.demonstrates} (Click to trigger immediately)`}
                    className={`absolute -top-1 -translate-x-1/2 px-1.5 py-0.5 rounded font-mono text-[9px] border transition cursor-pointer whitespace-nowrap ${
                      evt.triggered
                        ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-semibold'
                        : 'bg-[var(--surface-2)] border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {evt.timeLabel}
                  </button>
                );
              })}
            </div>

            {/* Sparklines Row: Active Alerts & Network Airtime Load */}
            <div className="flex items-center justify-between gap-4 pt-1 border-t border-[var(--border)]/50">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[var(--text-muted)] uppercase">
                    Alert Count Sparkline:
                  </span>
                  <Sparkline
                    data={timelineHistory.map((m) => m.activeAlertsCount)}
                    width={160}
                    height={24}
                    color="var(--status-full)"
                  />
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[var(--text-muted)] uppercase">
                    Airtime Load (%):
                  </span>
                  <Sparkline
                    data={timelineHistory.map((m) => m.airtimeUtilPct)}
                    width={160}
                    height={24}
                    color="var(--accent)"
                  />
                </div>
              </div>

              {/* Quick Jump Buttons for Scripted Highlights */}
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-[10px] font-mono text-[var(--text-faint)]">Quick Trigger:</span>
                {scriptedEvents.slice(1, 8).map((evt) => (
                  <button
                    key={evt.id}
                    type="button"
                    onClick={() => triggerScenarioEvent(evt.id)}
                    className="px-2 py-0.5 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] font-mono text-[10px] text-[var(--text)] whitespace-nowrap cursor-pointer"
                  >
                    {evt.timeLabel} {evt.title.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
