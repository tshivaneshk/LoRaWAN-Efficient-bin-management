import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CloudRain,
  Compass,
  Eye,
  Flame,
  Layers,
  Maximize2,
  Radio,
  ShieldAlert,
  Trash2,
  Truck as TruckIcon,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { NORTHGATE_DISTRICT_GEO } from '../../data/districtGeo';
import { formatRelativeAge, isBinOffline } from '../../lib/format';
import {
  computeLinkBudget,
  mapDistanceToMeters,
  SF_DEMOD_FLOOR_DB,
} from '../../sim/radioModel';
import { Bin, Gateway, RadioPacket, Truck } from '../../sim/types';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import { ProvenanceBadge } from '../../components/Primitives';

interface ActiveParticle {
  id: string;
  binX: number;
  binY: number;
  gwX: number;
  gwY: number;
  hqX: number;
  hqY: number;
  startedAtMs: number;
  durationMs: number;
  color: string;
  delivered: boolean;
}

export const DistrictMap: React.FC = () => {
  const bins = useSimStore((s) => s.bins);
  const gateways = useSimStore((s) => s.gateways);
  const trucks = useSimStore((s) => s.trucks);
  const packets = useSimStore((s) => s.packets);
  const simTimeSec = useSimStore((s) => s.simTimeSec);
  const region = useSimStore((s) => s.region);
  const weather = useSimStore((s) => s.weather);
  const speed = useSimStore((s) => s.speed);
  const networkMode = useSimStore((s) => s.networkMode);

  const selectedBinId = useUiStore((s) => s.selectedBinId);
  const selectBin = useUiStore((s) => s.selectBin);
  const mapLayers = useUiStore((s) => s.mapLayers);
  const toggleMapLayer = useUiStore((s) => s.toggleMapLayer);
  const coverageSfPreview = useUiStore((s) => s.coverageSfPreview);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);

  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const seenPacketIdsRef = useRef<Set<string>>(new Set());
  const activeParticlesRef = useRef<ActiveParticle[]>([]);

  // Keyboard navigation across map markers (Arrow keys cycle bins, Enter opens drawer)
  const handleMapKeyDown = (e: React.KeyboardEvent) => {
    if (bins.length === 0) return;
    const currentIndex = bins.findIndex((b) => b.id === selectedBinId);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = bins[(currentIndex + 1) % bins.length];
      selectBin(next.id, false);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = bins[(currentIndex - 1 + bins.length) % bins.length];
      selectBin(prev.id, false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedBinId) {
        selectBin(selectedBinId, true);
      }
    }
  };

  // Draw Coverage Heatmap on Canvas when gateways, weather, region, or coverageSfPreview changes
  useEffect(() => {
    const canvas = heatmapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 1000, 700);
    if (!mapLayers.coverageHeatmap) return;

    const onlineGws = gateways.filter((g) => g.online);
    if (onlineGws.length === 0) return;

    const cellW = 25;
    const cellH = 25;
    const demodFloor = SF_DEMOD_FLOOR_DB[coverageSfPreview];

    for (let x = 0; x < 1000; x += cellW) {
      for (let y = 0; y < 700; y += cellH) {
        const cx = x + cellW / 2;
        const cy = y + cellH / 2;
        let bestSnr = -999;

        for (const gw of onlineGws) {
          const distM = mapDistanceToMeters({ x: cx, y: cy }, gw.position);
          const link = computeLinkBudget({
            distanceM: distM,
            txPowerDbm: 14,
            pathLossExponent: 3.15,
            staticShadowingDb: 0,
            fastFadingDb: 0,
            region,
            weather,
            bwKhz: 125,
            sf: coverageSfPreview,
          });
          if (link.snrDb > bestSnr) {
            bestSnr = link.snrDb;
          }
        }

        const margin = bestSnr - demodFloor;
        if (margin >= 0) {
          const alpha = Math.min(0.24, Math.max(0.03, (margin / 28) * 0.22));
          ctx.fillStyle =
            margin > 10
              ? `rgba(34, 211, 238, ${alpha.toFixed(3)})`
              : margin > 4
                ? `rgba(52, 211, 153, ${alpha.toFixed(3)})`
                : `rgba(251, 191, 36, ${alpha.toFixed(3)})`;
          ctx.fillRect(x, y, cellW, cellH);
        }
      }
    }
  }, [gateways, weather, region, coverageSfPreview, mapLayers.coverageHeatmap]);

  // Spawn packet particles when new packets arrive
  useEffect(() => {
    if (!mapLayers.particles) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const recentPackets = packets.slice(0, 12);
    for (const pkt of recentPackets) {
      if (seenPacketIdsRef.current.has(pkt.id)) continue;
      seenPacketIdsRef.current.add(pkt.id);

      const bin = bins.find((b) => b.id === pkt.binId);
      if (!bin) continue;

      const rxGwId = pkt.receptions[0]?.gatewayId ?? bin.lastGatewayId ?? 'GW-01';
      const gw = gateways.find((g) => g.id === rxGwId) ?? gateways[0];
      if (!gw) continue;

      // Duration scaled from real airtime and clamped 300..1800 ms at display speed
      const speedCompression = speed >= 600 ? 0.45 : speed >= 60 ? 0.7 : 1.0;
      const durationMs = Math.min(
        1800,
        Math.max(320, (pkt.airtimeMs * 6 + 380) * speedCompression)
      );

      const color =
        pkt.provenance === 'LIVE_HARDWARE'
          ? '#4ADE80'
          : pkt.outcome === 'DELIVERED'
            ? '#22D3EE'
            : '#F43F5E';

      activeParticlesRef.current.push({
        id: pkt.id,
        binX: bin.position.x,
        binY: bin.position.y,
        gwX: gw.position.x,
        gwY: gw.position.y,
        hqX: NORTHGATE_DISTRICT_GEO.controlRoomPos.x,
        hqY: NORTHGATE_DISTRICT_GEO.controlRoomPos.y,
        startedAtMs: performance.now(),
        durationMs,
        color,
        delivered: pkt.outcome === 'DELIVERED',
      });
    }

    if (seenPacketIdsRef.current.size > 400) {
      const arr = Array.from(seenPacketIdsRef.current);
      seenPacketIdsRef.current = new Set(arr.slice(arr.length - 150));
    }
  }, [packets, bins, gateways, speed, mapLayers.particles]);

  // 60 fps requestAnimationFrame loop for Canvas packet particles & expanding transmit rings
  useEffect(() => {
    let rafId = 0;
    const renderParticles = (now: number) => {
      const canvas = particleCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, 1000, 700);
          const remaining: ActiveParticle[] = [];

          for (const p of activeParticlesRef.current) {
            const elapsed = now - p.startedAtMs;
            const progress = elapsed / p.durationMs;
            if (progress >= 1) continue;
            remaining.push(p);

            // 1. Expanding ring at bin (first 600ms ease-out)
            const ringProgress = Math.min(1, elapsed / 600);
            if (ringProgress < 1) {
              const easeOut = 1 - Math.pow(1 - ringProgress, 3);
              const radius = 14 + easeOut * 28;
              ctx.beginPath();
              ctx.arc(p.binX, p.binY, radius, 0, Math.PI * 2);
              ctx.strokeStyle = p.color;
              ctx.globalAlpha = (1 - easeOut) * 0.75;
              ctx.lineWidth = 2;
              ctx.stroke();
              ctx.globalAlpha = 1;
            }

            // 2. Particle travel: Phase A (0..0.65) Bin -> Gateway; Phase B (0.65..1.0) Gateway -> Control Room
            if (progress <= 0.65) {
              const legT = progress / 0.65;
              const easeT = legT < 0.5 ? 2 * legT * legT : 1 - Math.pow(-2 * legT + 2, 2) / 2;
              const px = p.binX + (p.gwX - p.binX) * easeT;
              const py = p.binY + (p.gwY - p.binY) * easeT;

              ctx.beginPath();
              ctx.arc(px, py, 4, 0, Math.PI * 2);
              ctx.fillStyle = p.color;
              ctx.fill();
            } else if (p.delivered) {
              const legT = (progress - 0.65) / 0.35;
              const px = p.gwX + (p.hqX - p.gwX) * legT;
              const py = p.gwY + (p.hqY - p.gwY) * legT;

              ctx.beginPath();
              ctx.arc(px, py, 3.2, 0, Math.PI * 2);
              ctx.fillStyle = '#A78BFA';
              ctx.fill();
            }
          }

          activeParticlesRef.current = remaining;
        }
      }
      rafId = requestAnimationFrame(renderParticles);
    };

    rafId = requestAnimationFrame(renderParticles);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const selectedBin = bins.find((b) => b.id === selectedBinId);
  const selectedBinLastPackets = packets
    .filter((p) => p.binId === selectedBinId && p.outcome === 'DELIVERED')
    .slice(0, 5);

  const handleSelectAndFly = (bin: Bin) => {
    selectBin(bin.id, true);
    if (zoom > 1.15) {
      setPan({
        x: (500 - bin.position.x) * (zoom - 1),
        y: (350 - bin.position.y) * (zoom - 1),
      });
    }
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-[var(--map-land)] select-none focus:outline-none"
      tabIndex={0}
      onKeyDown={handleMapKeyDown}
      aria-label="Northgate 2D District Operations Map. Use arrow keys to cycle bins and Enter to open Bin Detail."
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }}
      onMouseMove={(e) => {
        if (!isDragging) return;
        setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
      }}
      onMouseUp={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
    >
      {/* Top-Left HUD Overlay: District Status & Weather */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="px-2.5 py-1.5 rounded-lg bg-[var(--surface-1)]/90 backdrop-blur-xs border border-[var(--border)] flex items-center gap-2 text-xs shadow-sm pointer-events-auto">
          <Compass className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span className="font-semibold">Northgate District</span>
          <span className="text-[var(--text-faint)] font-mono">|</span>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            2.0 km × 1.4 km (2D Flat SVG+Canvas)
          </span>
        </div>

        {weather !== 'CLEAR' && (
          <div className="px-2.5 py-1.5 rounded-lg bg-[var(--status-filling)]/15 border border-[var(--status-filling)]/50 text-[var(--status-filling)] flex items-center gap-1.5 text-xs font-mono">
            <CloudRain className="w-3.5 h-3.5" />
            <span>{weather}: +Path Loss / Lower SNR</span>
          </div>
        )}
      </div>

      {/* Top-Right Floating Controls: Zoom & Layer Control */}
      <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1 bg-[var(--surface-1)]/95 border border-[var(--border)] rounded-lg p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.4, Number((z + 0.35).toFixed(2))))}
            title="Zoom In (expands bin markers to detail cards)"
            className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <span className="font-mono text-[11px] px-1.5 tabular-nums text-[var(--text-muted)]">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.85, Number((z - 0.35).toFixed(2))))}
            title="Zoom Out"
            className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title="Reset Map View"
            className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setLayerMenuOpen((o) => !o)}
            className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
              layerMenuOpen
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'hover:bg-[var(--surface-2)] text-[var(--text)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Layers</span>
          </button>
        </div>

        {layerMenuOpen && (
          <div className="w-56 p-3 rounded-xl bg-[var(--surface-1)]/95 backdrop-blur-md border border-[var(--border)] shadow-lg space-y-2 text-xs">
            <div className="font-semibold text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
              Map Layers (Toggle)
            </div>
            {(
              [
                ['base', '1. Base (Roads, Buildings, Water)'],
                ['zones', '2. District Zones'],
                ['coverageHeatmap', '3. RF Coverage Heatmap'],
                ['radioLinks', '4. Radio Links (SNR Colored)'],
                ['bins', '5. Smart Bins (24)'],
                ['gateways', '6. Gateways & Range Rings'],
                ['trucks', '7. Collection Trucks & Routes'],
                ['particles', '8. Packet Particles (Canvas)'],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between gap-2 py-0.5 cursor-pointer hover:text-[var(--accent)]"
              >
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={mapLayers[key]}
                  onChange={() => toggleMapLayer(key)}
                  className="accent-[var(--accent)] cursor-pointer"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Main Pan/Zoom Map Viewport */}
      <div
        className="w-full h-full flex items-center justify-center transition-transform duration-150 ease-out"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        <div className="relative w-[1000px] h-[700px] shrink-0">
          {/* Layer 3: Coverage Heatmap Canvas */}
          <canvas
            ref={heatmapCanvasRef}
            width={1000}
            height={700}
            className="absolute inset-0 pointer-events-none z-0"
          />

          {/* SVG Vector Layers: Base, Zones, Gateways, Links, Trucks */}
          <svg
            viewBox="0 0 1000 700"
            className="absolute inset-0 w-full h-full z-10 overflow-visible"
          >
            {/* Subtle Coordinate Grid */}
            <defs>
              <pattern id="ops-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path
                  d="M 50 0 L 0 0 0 50"
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="0.5"
                  strokeOpacity="0.35"
                />
              </pattern>
            </defs>
            <rect width="1000" height="700" fill="url(#ops-grid)" />

            {/* Layer 1: Base (Water, Roads, Buildings) */}
            {mapLayers.base && (
              <g>
                {/* River / Waterfront South */}
                <polygon
                  points={NORTHGATE_DISTRICT_GEO.waterPolygon
                    .map((p) => `${p[0]},${p[1]}`)
                    .join(' ')}
                  fill="var(--map-water)"
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x="790"
                  y="655"
                  fill="var(--text-faint)"
                  fontSize="11"
                  fontFamily="JetBrains Mono"
                  letterSpacing="2"
                >
                  NORTHGATE ESTUARY CANAL
                </text>

                {/* Roads */}
                {NORTHGATE_DISTRICT_GEO.roads.map((rd) => (
                  <polyline
                    key={rd.id}
                    points={rd.points.map((p) => `${p[0]},${p[1]}`).join(' ')}
                    fill="none"
                    stroke="var(--map-road)"
                    strokeWidth={rd.major ? 10 : 5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}

                {/* Buildings */}
                {NORTHGATE_DISTRICT_GEO.buildings.map((b) => (
                  <rect
                    key={b.id}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    rx={3}
                    fill="var(--map-building)"
                    stroke="var(--border)"
                    strokeWidth="1"
                  />
                ))}
              </g>
            )}

            {/* Layer 2: Zones */}
            {mapLayers.zones && (
              <g>
                {NORTHGATE_DISTRICT_GEO.zones.map((z) => (
                  <g key={z.id}>
                    <polygon
                      points={z.polygon.map((p) => `${p[0]},${p[1]}`).join(' ')}
                      fill={z.tintColor}
                      stroke="var(--border-strong)"
                      strokeWidth="1"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={z.labelPos.x}
                      y={z.labelPos.y}
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize="10"
                      fontWeight="600"
                      fontFamily="JetBrains Mono"
                      letterSpacing="1.2"
                    >
                      {z.name}
                    </text>
                  </g>
                ))}
              </g>
            )}

            {/* Layer 6 (underlay): Gateway Range Rings at SF7 and SF12 sensitivity */}
            {mapLayers.gateways &&
              gateways.map((gw) => {
                if (!gw.online) return null;
                return (
                  <g key={`rings-${gw.id}`} opacity={0.35}>
                    {/* SF7 sensitivity ring */}
                    <circle
                      cx={gw.position.x}
                      cy={gw.position.y}
                      r={190}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    {/* SF12 sensitivity ring */}
                    <circle
                      cx={gw.position.x}
                      cy={gw.position.y}
                      r={310}
                      fill="none"
                      stroke="var(--sim)"
                      strokeWidth="0.8"
                      strokeDasharray="6 4"
                    />
                  </g>
                );
              })}

            {/* Layer 4: Radio Links (Bin -> Last Gateway) */}
            {mapLayers.radioLinks &&
              bins.map((bin) => {
                const gwId = bin.lastGatewayId || 'GW-01';
                const gw = gateways.find((g) => g.id === gwId);
                if (!gw) return null;

                const isSelected = bin.id === selectedBinId;
                const ageSec = Math.max(0, simTimeSec - bin.lastSeenSimTime);
                const recencyOpacity = isSelected
                  ? 0.95
                  : gw.online
                    ? Math.max(0.18, 0.72 - ageSec / 3600)
                    : 0.12;

                const snr = bin.lastSnrDb ?? 5;
                const linkColor = !gw.online
                  ? 'var(--status-offline)'
                  : snr >= 5
                    ? 'var(--accent)'
                    : snr >= -5
                      ? 'var(--status-filling)'
                      : 'var(--status-full)';

                return (
                  <g key={`link-${bin.id}`}>
                    <line
                      x1={bin.position.x}
                      y1={bin.position.y}
                      x2={gw.position.x}
                      y2={gw.position.y}
                      stroke={linkColor}
                      strokeWidth={isSelected ? 2.4 : 1.1}
                      strokeDasharray={
                        bin.provenance === 'LIVE_HARDWARE'
                          ? undefined
                          : isSelected
                            ? '6 3'
                            : '3 3'
                      }
                      opacity={recencyOpacity}
                    />
                  </g>
                );
              })}

            {/* Dotted Backhaul Links from Gateways to Control Room HQ */}
            {mapLayers.gateways &&
              gateways.map((gw) => (
                <line
                  key={`backhaul-${gw.id}`}
                  x1={gw.position.x}
                  y1={gw.position.y}
                  x2={NORTHGATE_DISTRICT_GEO.controlRoomPos.x}
                  y2={NORTHGATE_DISTRICT_GEO.controlRoomPos.y}
                  stroke="var(--sim)"
                  strokeWidth="1.2"
                  strokeDasharray="2 4"
                  opacity={gw.online ? 0.5 : 0.15}
                />
              ))}

            {/* Selected Bin Last 5 Packets as Chips along the Link (Interaction #1) */}
            {selectedBin &&
              selectedBinLastPackets.length > 0 &&
              (() => {
                const gw =
                  gateways.find((g) => g.id === (selectedBin.lastGatewayId || 'GW-01')) ??
                  gateways[0];
                if (!gw) return null;
                return (
                  <g>
                    {selectedBinLastPackets.map((pkt, idx) => {
                      const t = (idx + 1) / (selectedBinLastPackets.length + 1);
                      const cx = selectedBin.position.x + (gw.position.x - selectedBin.position.x) * t;
                      const cy = selectedBin.position.y + (gw.position.y - selectedBin.position.y) * t;
                      return (
                        <g key={pkt.id} transform={`translate(${cx}, ${cy})`}>
                          <rect
                            x="-26"
                            y="-9"
                            width="52"
                            height="18"
                            rx="4"
                            fill="var(--surface-1)"
                            stroke="var(--accent)"
                            strokeWidth="1"
                          />
                          <text
                            x="0"
                            y="3"
                            textAnchor="middle"
                            fill="var(--text)"
                            fontSize="8.5"
                            fontFamily="JetBrains Mono"
                          >
                            #{pkt.sequence}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })()}

            {/* Layer 7: Trucks and Route Trails */}
            {mapLayers.trucks &&
              trucks.map((truck) => {
                const routePolyline = [
                  [truck.position.x, truck.position.y],
                  ...truck.routePoints.map((p) => [p.x, p.y]),
                ]
                  .map((p) => `${p[0]},${p[1]}`)
                  .join(' ');

                return (
                  <g key={truck.id}>
                    {truck.routePoints.length > 0 && (
                      <polyline
                        points={routePolyline}
                        fill="none"
                        stroke="var(--status-normal)"
                        strokeWidth="2.5"
                        strokeDasharray="6 4"
                      />
                    )}
                  </g>
                );
              })}
          </svg>

          {/* Layer 8: Packet Particles Canvas (60 fps) */}
          <canvas
            ref={particleCanvasRef}
            width={1000}
            height={700}
            className="absolute inset-0 pointer-events-none z-20"
          />

          {/* Interactive HTML Marker Overlays: Gateways, Trucks, and 24 Smart Bins */}
          <div className="absolute inset-0 z-30 pointer-events-none">
            {/* Gateways (Hexagon markers) */}
            {mapLayers.gateways &&
              gateways.map((gw) => (
                <div
                  key={gw.id}
                  style={{ left: gw.position.x, top: gw.position.y }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto group"
                >
                  <div
                    className={`w-9 h-9 rounded-lg rotate-45 flex items-center justify-center border-2 shadow-md transition ${
                      gw.online
                        ? 'bg-[var(--surface-1)] border-[var(--accent)] text-[var(--accent)]'
                        : 'bg-[var(--surface-2)] border-dashed border-[var(--status-full)] text-[var(--status-full)]'
                    }`}
                  >
                    <Radio className="w-4 h-4 -rotate-45" />
                  </div>
                  <div className="mt-1 px-1.5 py-0.5 rounded bg-[var(--surface-1)]/95 border border-[var(--border)] font-mono text-[10px] whitespace-nowrap text-center shadow-xs">
                    <span className="font-semibold">{gw.id}</span>{' '}
                    <span
                      className={
                        gw.online ? 'text-[var(--status-normal)]' : 'text-[var(--status-full)]'
                      }
                    >
                      {gw.online ? 'ONLINE' : 'POWER LOSS'}
                    </span>
                  </div>
                </div>
              ))}

            {/* Trucks */}
            {mapLayers.trucks &&
              trucks.map((truck) => (
                <div
                  key={truck.id}
                  style={{ left: truck.position.x, top: truck.position.y }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto transition-all duration-150"
                >
                  <div className="px-2 py-1 rounded-md bg-[var(--surface-1)] border border-[var(--status-normal)] text-[var(--status-normal)] flex items-center gap-1 shadow-md font-mono text-[10px]">
                    <TruckIcon className="w-3.5 h-3.5" />
                    <span>{truck.id}</span>
                  </div>
                </div>
              ))}

            {/* 24 Smart Bins (Circular 28px radial gauge or Expanded Card at Zoom >= 1.35) */}
            {mapLayers.bins &&
              bins.map((bin) => {
                const offline = isBinOffline(
                  simTimeSec,
                  bin.lastSeenSimTime,
                  bin.expectedIntervalSec
                );
                const isSelected = bin.id === selectedBinId;

                const statusColor = offline
                  ? 'var(--status-offline)'
                  : bin.latestStatus === 'FULL'
                    ? 'var(--status-full)'
                    : bin.latestStatus === 'HIGH'
                      ? 'var(--status-high)'
                      : bin.latestStatus === 'FILLING'
                        ? 'var(--status-filling)'
                        : 'var(--status-normal)';

                const statusIcon = offline ? (
                  <WifiOff className="w-3 h-3" />
                ) : bin.latestStatus === 'FULL' ? (
                  <Flame className="w-3 h-3" />
                ) : bin.latestStatus === 'HIGH' ? (
                  <AlertTriangle className="w-3 h-3" />
                ) : bin.latestStatus === 'FILLING' ? (
                  <ArrowUpRight className="w-3 h-3" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                );

                // Radial gauge ring math for 28px circular badge
                const r = 11;
                const circ = 2 * Math.PI * r;
                const offset = circ - (Math.min(100, Math.max(0, bin.latestFillPct)) / 100) * circ;

                return (
                  <div
                    key={bin.id}
                    style={{ left: bin.position.x, top: bin.position.y }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                  >
                    {zoom >= 1.35 ? (
                      /* Expanded Card View on Zoom-In */
                      <button
                        type="button"
                        onClick={() => handleSelectAndFly(bin)}
                        className={`p-2 rounded-lg bg-[var(--surface-1)]/95 border text-left shadow-md transition cursor-pointer min-w-[125px] ${
                          isSelected
                            ? 'ring-2 ring-[var(--accent)] border-[var(--accent)]'
                            : 'border-[var(--border-strong)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-bold text-[var(--text)]">
                            {bin.id}
                          </span>
                          <ProvenanceBadge provenance={bin.provenance} compact />
                        </div>
                        <div
                          className="flex items-center gap-1 font-mono text-[11px] font-semibold mt-0.5"
                          style={{ color: statusColor }}
                        >
                          {statusIcon}
                          <span>{Math.round(bin.latestFillPct)}%</span>
                          <span>{offline ? 'OFFLINE' : bin.latestStatus}</span>
                        </div>
                        <div className="text-[9px] font-mono text-[var(--text-faint)] mt-0.5">
                          Last seen {formatRelativeAge(simTimeSec, bin.lastSeenSimTime)}
                        </div>
                      </button>
                    ) : (
                      /* Standard 28px Circular Badge + Status Pill (Color + Icon + Text) */
                      <button
                        type="button"
                        onClick={() => handleSelectAndFly(bin)}
                        aria-label={`${bin.id} ${bin.name}, Fill ${Math.round(
                          bin.latestFillPct
                        )}%, Status ${offline ? 'OFFLINE' : bin.latestStatus}`}
                        className={`group relative flex flex-col items-center cursor-pointer focus:outline-none`}
                      >
                        <div
                          className={`relative w-7 h-7 rounded-full bg-[var(--surface-1)] flex items-center justify-center transition-all duration-250 ${
                            isSelected ? 'ring-2 ring-[var(--accent)] scale-115' : ''
                          } ${
                            offline ? 'border-2 border-dashed border-[var(--status-offline)]' : ''
                          } ${bin.latestStatus === 'FULL' && !offline ? 'animate-full-alert' : ''}`}
                          style={
                            !offline
                              ? { boxShadow: `0 0 0 1.5px ${statusColor}` }
                              : undefined
                          }
                        >
                          <svg width="28" height="28" className="absolute inset-0 -rotate-90">
                            <circle
                              cx="14"
                              cy="14"
                              r={r}
                              fill="transparent"
                              stroke="var(--surface-3)"
                              strokeWidth="2.5"
                            />
                            {!offline && (
                              <circle
                                cx="14"
                                cy="14"
                                r={r}
                                fill="transparent"
                                stroke={statusColor}
                                strokeWidth="2.5"
                                strokeDasharray={circ}
                                strokeDashoffset={offset}
                                strokeLinecap="round"
                              />
                            )}
                          </svg>
                          <span style={{ color: statusColor }}>{statusIcon}</span>
                        </div>

                        {/* Compact Label Beneath Marker (Always shows ID + Status Text + %) */}
                        <div
                          className={`mt-0.5 px-1 py-0.2 rounded bg-[var(--surface-1)]/90 border font-mono text-[9px] leading-tight whitespace-nowrap flex items-center gap-1 ${
                            offline
                              ? 'border-dashed border-[var(--status-offline)] text-[var(--status-offline)]'
                              : 'border-[var(--border)] text-[var(--text)]'
                          }`}
                        >
                          <span className="font-semibold">{bin.id.replace('BIN-', 'B')}</span>
                          <span style={{ color: statusColor }}>
                            {offline
                              ? `Last seen ${formatRelativeAge(simTimeSec, bin.lastSeenSimTime)}`
                              : `${Math.round(bin.latestFillPct)}% ${bin.latestStatus.slice(0, 4)}`}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Bottom-Left Map Legend */}
      <div className="absolute bottom-3 left-3 z-20 px-3 py-2 rounded-lg bg-[var(--surface-1)]/92 backdrop-blur-xs border border-[var(--border)] flex flex-wrap items-center gap-3 text-[11px] font-mono">
        <span className="flex items-center gap-1 text-[var(--status-normal)]">
          <CheckCircle2 className="w-3 h-3" /> NORMAL (&lt;60%)
        </span>
        <span className="flex items-center gap-1 text-[var(--status-filling)]">
          <ArrowUpRight className="w-3 h-3" /> FILLING (60-79%)
        </span>
        <span className="flex items-center gap-1 text-[var(--status-high)]">
          <AlertTriangle className="w-3 h-3" /> HIGH (80-94%)
        </span>
        <span className="flex items-center gap-1 text-[var(--status-full)]">
          <Flame className="w-3 h-3" /> FULL (95-100%)
        </span>
        <span className="flex items-center gap-1 text-[var(--status-offline)]">
          <WifiOff className="w-3 h-3" /> OFFLINE (&gt;3 intervals)
        </span>
        {networkMode === 'LORAWAN_SIM' && (
          <span className="text-[var(--lorawan)] border-l border-[var(--border)] pl-2">
            Multi-Gateway Diversity Active
          </span>
        )}
      </div>
    </div>
  );
};
