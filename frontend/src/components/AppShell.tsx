import React, { useState } from 'react';
import {
  Activity,
  BatteryCharging,
  Clapperboard,
  Cpu,
  HardDrive,
  Map as MapIcon,
  Moon,
  Pause,
  Play,
  Radio,
  RotateCcw,
  StepForward,
  Sun,
  Truck as TruckIcon,
  Usb,
} from 'lucide-react';
import { formatSimClock } from '../lib/format';
import { reconcileBinsWithBackend } from '../lib/liveBridge';
import { RefreshCw } from 'lucide-react';
import { useSimStore } from '../store/simStore';
import { ScreenRoute, useUiStore } from '../store/uiStore';
import { LoRaWanTag, ProvenanceBadge } from './Primitives';

export const TopBar: React.FC = () => {
  const simTimeSec = useSimStore((s) => s.simTimeSec);
  const running = useSimStore((s) => s.running);
  const speed = useSimStore((s) => s.speed);
  const networkMode = useSimStore((s) => s.networkMode);
  const play = useSimStore((s) => s.play);
  const pause = useSimStore((s) => s.pause);
  const step = useSimStore((s) => s.step);
  const setSpeed = useSimStore((s) => s.setSpeed);
  const setNetworkMode = useSimStore((s) => s.setNetworkMode);
  const resetWithSeed = useSimStore((s) => s.resetWithSeed);
  const seed = useSimStore((s) => s.seed);
  const systemMode = useSimStore((s) => s.systemMode);

  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const hardwareConnectionState = useUiStore((s) => s.hardwareConnectionState);
  const setHardwareDialogOpen = useUiStore((s) => s.setHardwareDialogOpen);
  const [isResyncing, setIsResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);

  const speeds: Array<1 | 60 | 600 | 3600> = [1, 60, 600, 3600];

  return (
    <header className="h-14 border-b border-[var(--border)] bg-[var(--surface-1)] px-4 flex items-center justify-between gap-4 shrink-0 z-30">
      {/* Left: Brand & Scenario Title */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/40 flex items-center justify-center text-[var(--accent)] shrink-0">
          <Radio className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm tracking-tight text-[var(--text)] truncate">
              NORTHGATE WASTE OPS
            </span>
            <ProvenanceBadge provenance="SIMULATED" compact />
          </div>
          <div className="text-[11px] text-[var(--text-muted)] truncate">
            Scenario: A Day in Northgate (24 Bins · 3 Gateways · 2 Trucks)
          </div>
        </div>
      </div>

      {/* Center: Mode Switch (Prototype P2P vs Simulated LoRaWAN) */}
      <div className="hidden xl:flex items-center gap-2 bg-[var(--surface-2)] p-1 rounded-lg border border-[var(--border)]">
        <button
          type="button"
          onClick={() => setNetworkMode('PROTOTYPE_P2P')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
            networkMode === 'PROTOTYPE_P2P'
              ? 'bg-[var(--surface-3)] text-[var(--text)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <span>Prototype Mode (Point-to-Point)</span>
        </button>
        <button
          type="button"
          onClick={() => setNetworkMode('LORAWAN_SIM')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
            networkMode === 'LORAWAN_SIM'
              ? 'bg-[var(--lorawan)]/20 text-[var(--lorawan)] border border-[var(--lorawan)]/50'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <span>LoRaWAN Mode</span>
          <LoRaWanTag label="SIMULATED LoRaWAN" />
        </button>
      </div>

      {/* Right: Sim Clock, Speed Control, Live Hardware Bridge, Theme */}
      <div className="flex items-center gap-2.5">
        {/* Sim Clock + Controls */}
        <div className="flex items-center gap-1.5 bg-[var(--surface-2)] px-2.5 py-1 rounded-lg border border-[var(--border)]">
          <div className="pr-2 border-r border-[var(--border)]">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text-faint)] font-mono">
              SIM CLOCK
            </div>
            <div className="font-mono text-sm font-semibold tabular-nums text-[var(--accent)]">
              {formatSimClock(simTimeSec)}
            </div>
          </div>

          <button
            type="button"
            onClick={() => (running ? pause() : play())}
            title={running ? 'Pause Simulation' : 'Play Simulation'}
            className="p-1.5 rounded bg-[var(--accent)] text-[#051014] hover:opacity-90 transition cursor-pointer"
          >
            {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => step(60)}
            title="Step +1 Simulated Minute"
            className="p-1.5 rounded bg-[var(--surface-3)] text-[var(--text)] hover:bg-[var(--border)] transition cursor-pointer"
          >
            <StepForward className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => resetWithSeed(seed)}
            title="Reset Day to 06:00"
            className="p-1.5 rounded bg-[var(--surface-3)] text-[var(--text-muted)] hover:text-[var(--text)] transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-0.5 pl-1 border-l border-[var(--border)]">
            {speeds.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`px-1.5 py-0.5 rounded font-mono text-[11px] tabular-nums cursor-pointer transition ${
                  speed === s
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/40 font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

                {/* Connection Status Badge, Resync Now Button & Hardware Button */}
        <div className="flex items-center gap-1.5 bg-[var(--surface-2)] p-1 rounded-lg border border-[var(--border)]">
          {/* Connection Status Indicator */}
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[11px] font-medium border ${
              hardwareConnectionState === 'CONNECTED'
                ? 'border-[var(--live)] bg-[var(--live)]/10 text-[var(--live)]'
                : hardwareConnectionState === 'CONNECTING'
                ? 'border-[var(--status-filling)] bg-[var(--status-filling)]/10 text-[var(--status-filling)]'
                : 'border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-muted)]'
            }`}
            title={`Backend WebSocket: ${hardwareConnectionState}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                hardwareConnectionState === 'CONNECTED'
                  ? 'bg-[var(--live)] animate-live-dot'
                  : hardwareConnectionState === 'CONNECTING'
                  ? 'bg-[var(--status-filling)] animate-pulse'
                  : 'bg-[var(--text-faint)]'
              }`}
            />
            <span>{hardwareConnectionState === 'CONNECTED' ? (systemMode === 'REALTIME' ? 'BACKEND LIVE (REALTIME)' : 'BACKEND LIVE (SIM)') : hardwareConnectionState}</span>
          </div>

          {/* Resync Mode Button */}
          <button
            type="button"
            disabled={isResyncing}
            onClick={async () => {
              setIsResyncing(true);
              const result = await reconcileBinsWithBackend();
              setIsResyncing(false);
              setResyncMsg(result.success ? 'Mode checked' : 'Check failed');
              setTimeout(() => setResyncMsg(null), 3000);
            }}
            title={resyncMsg || "Check backend mode from /api/mode"}
            className="px-2 py-1 rounded bg-[var(--surface-3)] hover:bg-[var(--border)] text-[var(--text)] border border-[var(--border-strong)] text-[11px] font-mono flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isResyncing ? 'animate-spin text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
            <span>{resyncMsg || 'Check Mode'}</span>
          </button>

          {/* Connect Hardware Dialog Opener */}
          <button
            type="button"
            onClick={() => setHardwareDialogOpen(true)}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition cursor-pointer"
            title="Open Hardware Bridge / Web Serial Settings"
          >
            <Usb className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Theme Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`}
          className="p-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] transition cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
};

export const LeftRail: React.FC = () => {
  const activeRoute = useUiStore((s) => s.activeRoute);
  const setActiveRoute = useUiStore((s) => s.setActiveRoute);
  const alerts = useSimStore((s) => s.alerts);
  const activeAlertsCount = alerts.filter((a) => !a.resolvedAt).length;

  const navItems: Array<{
    id: ScreenRoute;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'command-center',
      label: 'Command Center',
      icon: <MapIcon className="w-4 h-4" />,
      badge: activeAlertsCount > 0 ? activeAlertsCount : undefined,
    },
    {
      id: 'pipeline',
      label: 'Pipeline & Inspector',
      icon: <HardDrive className="w-4 h-4" />,
    },
    {
      id: 'bin-detail',
      label: 'Bin Node & Schematic',
      icon: <Cpu className="w-4 h-4" />,
    },
    {
      id: 'network',
      label: 'Network & RF',
      icon: <Radio className="w-4 h-4" />,
    },
    {
      id: 'operations',
      label: 'Operations & Fleet',
      icon: <TruckIcon className="w-4 h-4" />,
    },
    {
      id: 'scenario',
      label: 'Scenario Director',
      icon: <Clapperboard className="w-4 h-4" />,
    },
    {
      id: 'energy',
      label: 'Energy Lab',
      icon: <BatteryCharging className="w-4 h-4" />,
    },
  ];

  return (
    <aside className="w-16 lg:w-52 border-r border-[var(--border)] bg-[var(--surface-1)] flex flex-col justify-between py-3 px-2 shrink-0">
      <nav className="space-y-1" aria-label="Main Operations Navigation">
        {navItems.map((item) => {
          const isActive = activeRoute === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveRoute(item.id)}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                isActive
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/30'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
              }`}
              title={item.label}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0">{item.icon}</span>
                <span className="hidden lg:inline truncate">{item.label}</span>
              </div>
              {item.badge !== undefined && (
                <span className="px-1.5 py-0.2 rounded-full font-mono text-[10px] font-semibold bg-[var(--status-full)] text-white tabular-nums">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom mode indicator for smaller screens */}
      <div className="hidden lg:block p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[11px] space-y-1">
        <div className="flex items-center justify-between text-[var(--text-muted)]">
          <span>Engine</span>
          <span className="font-mono text-[var(--accent)] flex items-center gap-1">
            <Activity className="w-3 h-3" /> Worker 20Hz
          </span>
        </div>
        <div className="text-[10px] text-[var(--text-faint)] leading-tight">
          All telemetry &amp; RF values computed from Section 6 equations.
        </div>
      </div>
    </aside>
  );
};

export const FooterBar: React.FC = () => {
  const seed = useSimStore((s) => s.seed);
  const resetWithSeed = useSimStore((s) => s.resetWithSeed);
  const region = useSimStore((s) => s.region);
  const setRegion = useSimStore((s) => s.setRegion);
  const networkMode = useSimStore((s) => s.networkMode);
  const [seedInput, setSeedInput] = useState(String(seed));

  const handleSeedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(seedInput, 10);
    if (!Number.isNaN(parsed)) {
      resetWithSeed(parsed);
    }
  };

  return (
    <footer className="h-8 border-t border-[var(--border)] bg-[var(--surface-1)] px-4 flex items-center justify-between text-[11px] text-[var(--text-muted)] shrink-0 z-20">
      <div className="flex items-center gap-4">
        <form onSubmit={handleSeedSubmit} className="flex items-center gap-1.5">
          <span className="text-[var(--text-faint)] font-mono">PRNG SEED (mulberry32):</span>
          <input
            type="text"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            aria-label="Simulation PRNG Seed"
            className="w-20 px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] font-mono text-[11px] text-[var(--text)] tabular-nums"
          />
          <button
            type="submit"
            className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] hover:bg-[var(--border)] text-[var(--text)] font-mono text-[10px] cursor-pointer"
          >
            Apply
          </button>
        </form>

        <div className="hidden md:flex items-center gap-1.5">
          <span className="text-[var(--text-faint)] font-mono">RF BAND:</span>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as typeof region)}
            aria-label="Select Regional LoRa Frequency Plan"
            className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] font-mono text-[11px] text-[var(--text)] cursor-pointer"
          >
            <option value="IN865">IN865 (865-867 MHz)</option>
            <option value="EU868">EU868 (863-870 MHz)</option>
            <option value="US915">US915 (902-928 MHz)</option>
            <option value="AS923">AS923 (920-925 MHz)</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 truncate">
        <span className="text-[var(--text-faint)] hidden sm:inline">
          Verify the legal band and limits for your deployment location.
        </span>
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)]">
          {networkMode === 'PROTOTYPE_P2P' ? 'P2P CSV PROTOCOL V1' : 'SIMULATED LoRaWAN'}
        </span>
      </div>
    </footer>
  );
};

