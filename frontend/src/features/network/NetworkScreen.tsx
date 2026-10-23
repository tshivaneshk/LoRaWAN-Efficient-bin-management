import React from 'react';
import {
  CloudRain,
  Power,
  Radio,
  ShieldAlert,
  Signal,
  Sun,
  Waves,
  Zap,
} from 'lucide-react';
import { REGION_PRESETS } from '../../data/regions';
import { LoRaWanTag, ProvenanceBadge } from '../../components/Primitives';
import { formatSimClock } from '../../lib/format';
import { computeLinkBudget, mapDistanceToMeters } from '../../sim/radioModel';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';

export const NetworkScreen: React.FC = () => {
  const bins = useSimStore((s) => s.bins);
  const gateways = useSimStore((s) => s.gateways);
  const collisions = useSimStore((s) => s.collisions);
  const lorawanLog = useSimStore((s) => s.lorawanLog);
  const region = useSimStore((s) => s.region);
  const weather = useSimStore((s) => s.weather);
  const networkMode = useSimStore((s) => s.networkMode);
  const setWeather = useSimStore((s) => s.setWeather);
  const setGatewayOnline = useSimStore((s) => s.setGatewayOnline);
  const setNetworkMode = useSimStore((s) => s.setNetworkMode);

  const coverageSfPreview = useUiStore((s) => s.coverageSfPreview);
  const setCoverageSfPreview = useUiStore((s) => s.setCoverageSfPreview);

  const preset = REGION_PRESETS[region];
  const sfs: Array<7 | 8 | 9 | 10 | 11 | 12> = [7, 8, 9, 10, 11, 12];

  // Compute SF distribution counts across the 24 bins
  const sfCounts = sfs.map((sf) => ({
    sf,
    count: bins.filter((b) => b.sf === sf).length,
  }));

  // Compute RSSI vs Distance scatter points + fitted theoretical log-distance curve
  const scatterPoints = bins.map((bin) => {
    const gw =
      gateways.find((g) => g.id === (bin.lastGatewayId || 'GW-01')) ?? gateways[0];
    const distM = gw ? mapDistanceToMeters(bin.position, gw.position) : 350;
    const rssi = bin.lastRssiDbm ?? -90;
    return {
      binId: bin.id,
      distM: Math.round(distM),
      rssi,
      provenance: bin.provenance,
    };
  });

  const fittedCurvePoints: string[] = [];
  for (let d = 50; d <= 1200; d += 50) {
    const link = computeLinkBudget({
      distanceM: d,
      txPowerDbm: 14,
      pathLossExponent: 3.15,
      staticShadowingDb: 0,
      fastFadingDb: 0,
      region,
      weather,
      bwKhz: 125,
      sf: coverageSfPreview,
    });
    const x = 40 + ((d - 50) / 1150) * 480;
    // RSSI range -60 to -135 dBm
    const y = 20 + ((-60 - link.rssiDbm) / 75) * 160;
    fittedCurvePoints.push(`${x.toFixed(1)},${Math.min(185, Math.max(15, y)).toFixed(1)}`);
  }

  return (
    <div className="h-full w-full overflow-y-auto p-4 space-y-4">
      {/* Top Bar: Weather, SF Selector & Regional Duty Cycle Info */}
      <div className="card-surface p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-[var(--text)]">
              RF Propagation, Channel Duty Cycle &amp; Gateway Telemetry
            </h1>
            <ProvenanceBadge provenance="SIMULATED" />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {preset.name} · Channels: {preset.channelsMhz.join(', ')} MHz · Max EIRP: +
            {preset.maxEirpDbm} dBm · {preset.dutyCycleNote}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Weather Selector */}
          <div className="flex items-center gap-1 bg-[var(--surface-2)] p-1 rounded-lg border border-[var(--border)]">
            {(['CLEAR', 'RAIN', 'STORM'] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWeather(w)}
                className={`px-2.5 py-1 rounded text-xs font-mono flex items-center gap-1 cursor-pointer transition ${
                  weather === w
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/40 font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {w === 'CLEAR' ? (
                  <Sun className="w-3.5 h-3.5" />
                ) : (
                  <CloudRain className="w-3.5 h-3.5" />
                )}
                <span>{w}</span>
              </button>
            ))}
          </div>

          {/* Coverage SF Preview Selector */}
          <div className="flex items-center gap-1 bg-[var(--surface-2)] p-1 rounded-lg border border-[var(--border)] font-mono text-xs">
            <span className="text-[10px] text-[var(--text-faint)] px-1.5">COVERAGE SF:</span>
            {sfs.map((sf) => (
              <button
                key={sf}
                type="button"
                onClick={() => setCoverageSfPreview(sf)}
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  coverageSfPreview === sf
                    ? 'bg-[var(--accent)] text-[#041014] font-bold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                SF{sf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3 Gateway Cards with Power Toggle & Airtime Utilisation Gauge */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {gateways.map((gw) => {
          const utilPct = Math.min(100, Number((gw.airtimeUtilisation * 100).toFixed(2)));
          const limitPct = preset.dutyCycleLimit * 100;
          return (
            <div key={gw.id} className="card-surface p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Radio
                      className={`w-4 h-4 ${
                        gw.online ? 'text-[var(--accent)]' : 'text-[var(--status-full)]'
                      }`}
                    />
                    <span className="font-mono text-sm font-bold">{gw.id}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                        gw.online
                          ? 'bg-[var(--status-normal)]/15 text-[var(--status-normal)]'
                          : 'bg-[var(--status-full)]/20 text-[var(--status-full)]'
                      }`}
                    >
                      {gw.online ? 'ONLINE' : 'POWER LOSS'}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">{gw.name}</div>
                </div>

                <button
                  type="button"
                  onClick={() => setGatewayOnline(gw.id, !gw.online)}
                  className={`px-2.5 py-1 rounded text-xs font-mono border cursor-pointer flex items-center gap-1 transition ${
                    gw.online
                      ? 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--status-full)]'
                      : 'bg-[var(--status-normal)]/20 border-[var(--status-normal)] text-[var(--status-normal)]'
                  }`}
                >
                  <Power className="w-3 h-3" />
                  <span>{gw.online ? 'Trip Power' : 'Restore'}</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                <div className="p-2 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[9px] text-[var(--text-faint)]">FRAMES RX</div>
                  <div className="font-semibold tabular-nums">{gw.rxCount}</div>
                </div>
                <div className="p-2 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[9px] text-[var(--text-faint)]">MEAN RSSI</div>
                  <div className="font-semibold tabular-nums">{gw.meanRssiDbm} dBm</div>
                </div>
                <div className="p-2 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[9px] text-[var(--text-faint)]">MEAN SNR</div>
                  <div className="font-semibold tabular-nums">{gw.meanSnrDb} dB</div>
                </div>
              </div>

              {/* Airtime Utilisation Gauge with Regional Duty-Cycle Limit Line */}
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[10px]">
                  <span className="text-[var(--text-muted)]">AIRTIME UTILISATION</span>
                  <span className="tabular-nums text-[var(--accent)]">
                    {utilPct}% (Limit: {limitPct}%)
                  </span>
                </div>
                <div className="relative h-2.5 w-full rounded-full bg-[var(--surface-3)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-200"
                    style={{ width: `${Math.min(100, utilPct * 25)}%` }}
                  />
                  {/* Duty cycle limit line marker */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-[var(--status-full)]"
                    style={{ left: `${Math.min(95, limitPct * 25)}%` }}
                    title={`Regional Duty-Cycle Limit (${limitPct}%)`}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Middle Row: RSSI vs Distance Scatter + SF Distribution Stacked Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* RSSI vs Distance Scatter with Fitted Log-Distance Path Loss Curve */}
        <div className="lg:col-span-7 card-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                RSSI vs Distance Scatter &amp; Log-Distance Path Loss Curve
              </h2>
              <p className="text-[11px] text-[var(--text-faint)] font-mono">
                PL(d) = PL0 + 10·n·log10(d/d0) + Xσ · Dashed curve = theoretical mean · Dots = 24 bins with shadowing Xσ
              </p>
            </div>
            <ProvenanceBadge provenance="SIMULATED" compact />
          </div>

          <div className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-2">
            <svg viewBox="0 0 550 205" className="w-full h-48 overflow-visible">
              {/* Grid lines */}
              {[-60, -80, -100, -120].map((dbm) => {
                const y = 20 + ((-60 - dbm) / 75) * 160;
                return (
                  <g key={dbm}>
                    <line
                      x1="40"
                      y1={y}
                      x2="525"
                      y2={y}
                      stroke="var(--border)"
                      strokeWidth="0.7"
                      strokeDasharray="3 3"
                    />
                    <text
                      x="35"
                      y={y + 3}
                      textAnchor="end"
                      fill="var(--text-faint)"
                      fontSize="9"
                      fontFamily="JetBrains Mono"
                    >
                      {dbm}
                    </text>
                  </g>
                );
              })}

              {/* X-axis distance labels */}
              {[100, 400, 800, 1200].map((dist) => {
                const x = 40 + ((dist - 50) / 1150) * 480;
                return (
                  <text
                    key={dist}
                    x={x}
                    y="196"
                    textAnchor="middle"
                    fill="var(--text-faint)"
                    fontSize="9"
                    fontFamily="JetBrains Mono"
                  >
                    {dist}m
                  </text>
                );
              })}

              {/* Fitted Path Loss Curve */}
              <polyline
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeDasharray="5 3"
                points={fittedCurvePoints.join(' ')}
              />

              {/* Bin Scatter Points */}
              {scatterPoints.map((pt) => {
                const x = Math.min(520, Math.max(44, 40 + ((pt.distM - 50) / 1150) * 480));
                const y = Math.min(180, Math.max(18, 20 + ((-60 - pt.rssi) / 75) * 160));
                return (
                  <g key={pt.binId}>
                    <circle
                      cx={x}
                      cy={y}
                      r="4.2"
                      fill={
                        pt.provenance === 'LIVE_HARDWARE' ? 'var(--live)' : 'var(--sim)'
                      }
                      stroke="var(--bg)"
                      strokeWidth="1"
                    >
                      <title>{`${pt.binId}: ${pt.distM}m -> ${pt.rssi} dBm`}</title>
                    </circle>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* SF Distribution & Orthogonality Breakdown */}
        <div className="lg:col-span-5 card-surface p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Spreading Factor (SF7–SF12) Distribution
              </h2>
              <span className="font-mono text-[11px] text-[var(--accent)]">24 Active Nodes</span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              In LoRaWAN mode with ADR enabled, high-SNR nodes step down toward SF7 (61.7 ms ToA), while rain/edge nodes step up toward SF10–SF12.
            </p>
          </div>

          {/* Stacked Bar */}
          <div className="space-y-2">
            <div className="h-5 w-full rounded-lg overflow-hidden bg-[var(--surface-3)] flex">
              {sfCounts.map((item, idx) => {
                if (item.count === 0) return null;
                const pct = (item.count / Math.max(1, bins.length)) * 100;
                const colors = ['#22D3EE', '#34D399', '#FBBF24', '#FB923C', '#F43F5E', '#A78BFA'];
                return (
                  <div
                    key={item.sf}
                    style={{ width: `${pct}%`, backgroundColor: colors[idx] }}
                    className="h-full flex items-center justify-center font-mono text-[10px] font-bold text-[#051014]"
                    title={`SF${item.sf}: ${item.count} bins`}
                  >
                    SF{item.sf}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-2 font-mono text-xs pt-2">
              {sfCounts.map((item) => (
                <div
                  key={item.sf}
                  className="p-2 rounded bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-between"
                >
                  <span className="text-[var(--text-muted)]">SF{item.sf}</span>
                  <span className="font-bold tabular-nums">{item.count} nodes</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-[11px] font-mono text-[var(--text-faint)] border-t border-[var(--border)] pt-2">
            Verify the legal band and limits for your deployment location.
          </div>
        </div>
      </div>

      {/* Bottom Row: RF Collision Log + Simulated LoRaWAN Network Server Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Collision Log */}
        <div className="card-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-[var(--status-high)]" />
              Co-Channel &amp; Co-SF Collision Log ({collisions.length})
            </h2>
            <span className="font-mono text-[10px] text-[var(--text-faint)]">
              Capture Effect Threshold: &ge; 6.0 dB
            </span>
          </div>

          {collisions.length === 0 ? (
            <div className="p-6 text-center text-xs font-mono text-[var(--text-faint)] border border-dashed border-[var(--border)] rounded-lg">
              No co-SF packet collisions recorded yet. Switch weather to STORM or trigger the 21:00 Heavy Rain event to induce higher airtime &amp; collisions.
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border)]/60 font-mono text-xs">
              {collisions.map((col) => (
                <div key={col.id} className="py-2 px-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-[var(--text)]">
                      {col.binAId} ({col.rssiADbm} dBm) vs {col.binBId} ({col.rssiBDbm} dBm)
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {formatSimClock(col.simTime)} · {col.channelMhz} MHz · SF{col.sf} at{' '}
                      {col.gatewayId}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] ${
                      col.winnerBinId
                        ? 'bg-[var(--status-filling)]/15 text-[var(--status-filling)]'
                        : 'bg-[var(--status-full)]/15 text-[var(--status-full)]'
                    }`}
                  >
                    {col.winnerBinId
                      ? `CAPTURED BY ${col.winnerBinId} (>=6dB)`
                      : 'BOTH LOST (<6dB diff)'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Simulated LoRaWAN Network Server Panel (Tagged Violet SIMULATED LoRaWAN) */}
        <div className="card-surface p-4 space-y-3 border-[var(--lorawan)]/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--lorawan)]">
                LoRaWAN Network Server Layer
              </h2>
              <LoRaWanTag label="SIMULATED LoRaWAN" />
            </div>

            {networkMode !== 'LORAWAN_SIM' && (
              <button
                type="button"
                onClick={() => setNetworkMode('LORAWAN_SIM')}
                className="px-2.5 py-1 rounded text-xs font-mono bg-[var(--lorawan)]/20 text-[var(--lorawan)] border border-[var(--lorawan)]/50 hover:bg-[var(--lorawan)]/30 cursor-pointer"
              >
                Enable LoRaWAN Mode
              </button>
            )}
          </div>

          {networkMode !== 'LORAWAN_SIM' ? (
            <div className="p-6 text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--lorawan)]/40 rounded-lg space-y-2">
              <p>
                Currently running in <strong>Prototype Mode (Point-to-Point CSV)</strong> — single gateway, no network server, no join procedure.
              </p>
              <p className="text-[11px] font-mono text-[var(--lorawan)]">
                Switch to LoRaWAN Mode above to inspect multi-gateway frame deduplication, frame counters (FCntUp), and Adaptive Data Rate (ADR) commands.
              </p>
            </div>
          ) : lorawanLog.length === 0 ? (
            <div className="p-6 text-center text-xs font-mono text-[var(--text-faint)]">
              LoRaWAN Mode active. Step or Play the simulation to see multi-gateway deduplication and ADR events.
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border)]/60 font-mono text-xs">
              {lorawanLog.map((entry) => (
                <div key={entry.id} className="py-2 px-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[var(--lorawan)]">
                      [{entry.type}] {entry.binId}
                    </span>
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {formatSimClock(entry.simTime)} · Gateways: {entry.gatewaysHeard.join(', ')}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--text)]">{entry.details}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
