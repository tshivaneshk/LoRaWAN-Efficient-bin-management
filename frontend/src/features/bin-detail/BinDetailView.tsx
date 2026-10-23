import React from 'react';
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Cpu,
  Radio,
  ShieldAlert,
  Thermometer,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import {
  ProvenanceBadge,
  RadialGauge,
  Sparkline,
  StatusBadge,
} from '../../components/Primitives';
import { formatRelativeAge, formatSimClock, isBinOffline } from '../../lib/format';
import { compareDailyEnergySchedules } from '../../sim/energy';
import { Bin, SensorFaultType } from '../../sim/types';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';

const HardwareSchematic2D: React.FC<{ bin: Bin }> = ({ bin }) => {
  const injectDemoFill = useSimStore((s) => s.injectDemoFill);

  const pinRows = [
    {
      mcuPin: 'D4 (GPIO)',
      target: 'HC-SR04 TRIG',
      domain: '5V TTL',
      liveValue: '10 us HIGH pulse',
      notes: 'Triggers 40 kHz ultrasonic burst (8 cycles)',
    },
    {
      mcuPin: 'D5 (GPIO)',
      target: 'HC-SR04 ECHO (via 1k/2k divider)',
      domain: '5V -> 3.3V Divided',
      liveValue: `${bin.lastEchoTimeUs} us (${bin.lastMedianCm} cm)`,
      notes: 'Voltage divider protects input / matches 3.3V logic threshold',
    },
    {
      mcuPin: 'D10 (SS)',
      target: 'SX1278 / RFM95 NSS (CS)',
      domain: '3.3V Level-Shifted',
      liveValue: 'ACTIVE LOW on SPI burst',
      notes: 'Chip select for LoRa transceiver registers',
    },
    {
      mcuPin: 'D9 (GPIO)',
      target: 'SX1278 / RFM95 RST',
      domain: '3.3V Level-Shifted',
      liveValue: 'HIGH (Idle)',
      notes: 'Hardware reset pin for radio transceiver',
    },
    {
      mcuPin: 'D2 (INT0)',
      target: 'SX1278 / RFM95 DIO0',
      domain: '3.3V Interrupt',
      liveValue: `IRQ TxDone (#${bin.sequence})`,
      notes: 'Hardware interrupt fires when packet transmission completes',
    },
    {
      mcuPin: 'D11 / D12 / D13',
      target: 'MOSI / MISO / SCK (SPI Bus)',
      domain: '3.3V Level-Shifted',
      liveValue: `8 MHz SPI (${bin.packetsSent} frames)`,
      notes: 'FIFO payload write & LoRa modulation configuration',
    },
    {
      mcuPin: 'A4 (SDA) / A5 (SCL)',
      target: 'SSD1306 0.96" OLED (Optional)',
      domain: '3.3V / 5V I2C',
      liveValue: `0x3C: "${bin.id} ${Math.round(bin.latestFillPct)}%"`,
      notes: 'Local debug display for benchtop & field verification',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Callout Banner for Level Shifter & Divider Requirement */}
      <div className="p-3 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/40 flex items-start justify-between gap-3">
        <div className="text-xs space-y-1">
          <div className="font-semibold text-[var(--accent)] flex items-center gap-1.5">
            <Cpu className="w-4 h-4" />
            Hardware Voltage Domain Protection: 5V Logic vs 3.3V RF Transceiver
          </div>
          <p className="text-[var(--text)] leading-relaxed">
            The <strong>Arduino Nano (ATmega328P)</strong> and <strong>HC-SR04</strong> operate at{' '}
            <strong>5.0 V logic</strong>, whereas the <strong>SX1278 / RFM95 LoRa module</strong> is
            strictly <strong>3.3 V max (absolute maximum 3.6 V)</strong>. Connecting 5V SPI/control
            pins directly to the LoRa module will permanently damage the transceiver silicon. A{' '}
            <strong>bidirectional logic level shifter</strong> is placed between the Nano and
            RFM95, and a <strong>1 kΩ + 2 kΩ resistive divider</strong> scales the HC-SR04 ECHO pulse.
          </p>
        </div>
        <button
          type="button"
          onClick={() => injectDemoFill(bin.id, bin.latestFillPct)}
          className="px-2.5 py-1.5 rounded bg-[var(--accent)] text-[#041014] font-mono text-xs font-semibold shrink-0 hover:opacity-90 cursor-pointer flex items-center gap-1"
        >
          <Zap className="w-3.5 h-3.5" /> Pulse Schematic Now
        </button>
      </div>

      {/* 2D Vector Hardware Schematic (Flat SVG with 5V and 3.3V Domain Tints) */}
      <div className="card-surface p-3 overflow-x-auto">
        <svg viewBox="0 0 920 350" className="w-full min-w-[760px] h-auto">
          {/* 5.0V Domain Background Tint (Left) */}
          <rect
            x="10"
            y="12"
            width="535"
            height="326"
            rx="10"
            fill="rgba(251, 191, 36, 0.05)"
            stroke="var(--status-filling)"
            strokeWidth="1"
            strokeDasharray="5 4"
          />
          <text
            x="24"
            y="32"
            fill="var(--status-filling)"
            fontSize="11"
            fontWeight="700"
            fontFamily="JetBrains Mono"
          >
            5.0 V LOGIC DOMAIN (ARDUINO NANO + HC-SR04 ULTRASONIC)
          </text>

          {/* 3.3V Domain Background Tint (Right) */}
          <rect
            x="560"
            y="12"
            width="350"
            height="326"
            rx="10"
            fill="rgba(34, 211, 238, 0.06)"
            stroke="var(--accent)"
            strokeWidth="1"
            strokeDasharray="5 4"
          />
          <text
            x="575"
            y="32"
            fill="var(--accent)"
            fontSize="11"
            fontWeight="700"
            fontFamily="JetBrains Mono"
          >
            3.3 V RF DOMAIN (SX1278 / RFM95 LORA)
          </text>

          {/* Block 1: HC-SR04 Ultrasonic Sensor */}
          <rect
            x="28"
            y="60"
            width="165"
            height="135"
            rx="8"
            fill="var(--surface-2)"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
          />
          <circle cx="72" cy="100" r="20" fill="var(--surface-3)" stroke="var(--accent)" strokeWidth="1.5" />
          <circle cx="145" cy="100" r="20" fill="var(--surface-3)" stroke="var(--accent)" strokeWidth="1.5" />
          <text x="72" y="104" textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="JetBrains Mono">
            TX
          </text>
          <text x="145" y="104" textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="JetBrains Mono">
            RX
          </text>
          <text x="110" y="142" textAnchor="middle" fill="var(--text)" fontSize="12" fontWeight="700" fontFamily="Inter">
            HC-SR04 Sensor
          </text>
          <text x="110" y="160" textAnchor="middle" fill="var(--accent)" fontSize="10" fontFamily="JetBrains Mono">
            d = {bin.lastMedianCm} cm ({bin.lastEchoTimeUs} us)
          </text>
          <text x="110" y="178" textAnchor="middle" fill="var(--text-muted)" fontSize="9.5" fontFamily="JetBrains Mono">
            VCC: 5V | TRIG | ECHO | GND
          </text>

          {/* 1k / 2k Voltage Divider Block on ECHO */}
          <rect
            x="212"
            y="112"
            width="72"
            height="54"
            rx="6"
            fill="var(--surface-3)"
            stroke="var(--status-filling)"
            strokeWidth="1.2"
          />
          <text x="248" y="132" textAnchor="middle" fill="var(--status-filling)" fontSize="9.5" fontWeight="700" fontFamily="JetBrains Mono">
            1kΩ / 2kΩ
          </text>
          <text x="248" y="146" textAnchor="middle" fill="var(--text)" fontSize="9" fontFamily="JetBrains Mono">
            DIVIDER
          </text>
          <text x="248" y="159" textAnchor="middle" fill="var(--text-muted)" fontSize="8" fontFamily="JetBrains Mono">
            5V -&gt; 3.3V
          </text>

          {/* Block 2: Optional I2C OLED Display */}
          <rect
            x="28"
            y="220"
            width="165"
            height="95"
            rx="8"
            fill="var(--surface-2)"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
          />
          <text x="110" y="242" textAnchor="middle" fill="var(--text)" fontSize="11" fontWeight="600">
            SSD1306 I2C OLED (Opt)
          </text>
          <rect x="46" y="252" width="128" height="46" rx="4" fill="#05080C" stroke="var(--border)" />
          <text x="56" y="270" fill="#22D3EE" fontSize="9.5" fontFamily="JetBrains Mono">
            {bin.id} FILL: {Math.round(bin.latestFillPct)}%
          </text>
          <text x="56" y="286" fill="#34D399" fontSize="9" fontFamily="JetBrains Mono">
            SEQ:{bin.sequence} SF:{bin.sf} {bin.lastRssiDbm ?? -90}dBm
          </text>

          {/* Block 3: Arduino Nano MCU */}
          <rect
            x="305"
            y="58"
            width="175"
            height="255"
            rx="8"
            fill="var(--surface-2)"
            stroke="var(--text-muted)"
            strokeWidth="1.8"
          />
          <text x="392" y="84" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="700">
            Arduino Nano
          </text>
          <text x="392" y="100" textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontFamily="JetBrains Mono">
            ATmega328P (16 MHz)
          </text>

          {/* Left side pins on Nano */}
          <text x="315" y="128" fill="var(--accent)" fontSize="10" fontFamily="JetBrains Mono">
            D4 (TRIG)
          </text>
          <text x="315" y="152" fill="var(--status-filling)" fontSize="10" fontFamily="JetBrains Mono">
            D5 (ECHO)
          </text>
          <text x="315" y="255" fill="var(--sim)" fontSize="10" fontFamily="JetBrains Mono">
            A4 (SDA)
          </text>
          <text x="315" y="275" fill="var(--sim)" fontSize="10" fontFamily="JetBrains Mono">
            A5 (SCL)
          </text>

          {/* Right side pins on Nano */}
          <text x="470" y="125" textAnchor="end" fill="var(--accent)" fontSize="10" fontFamily="JetBrains Mono">
            D10 (NSS)
          </text>
          <text x="470" y="150" textAnchor="end" fill="var(--accent)" fontSize="10" fontFamily="JetBrains Mono">
            D9 (RST)
          </text>
          <text x="470" y="175" textAnchor="end" fill="var(--status-normal)" fontSize="10" fontFamily="JetBrains Mono">
            D2 (DIO0)
          </text>
          <text x="470" y="205" textAnchor="end" fill="var(--text)" fontSize="10" fontFamily="JetBrains Mono">
            D11 (MOSI)
          </text>
          <text x="470" y="230" textAnchor="end" fill="var(--text)" fontSize="10" fontFamily="JetBrains Mono">
            D12 (MISO)
          </text>
          <text x="470" y="255" textAnchor="end" fill="var(--text)" fontSize="10" fontFamily="JetBrains Mono">
            D13 (SCK)
          </text>

          {/* Block 4: Bidirectional Logic Level Shifter (Between 5V and 3.3V domains) */}
          <rect
            x="505"
            y="95"
            width="82"
            height="185"
            rx="6"
            fill="var(--surface-3)"
            stroke="var(--accent)"
            strokeWidth="1.8"
          />
          <text x="546" y="135" textAnchor="middle" fill="var(--accent)" fontSize="10" fontWeight="700" fontFamily="JetBrains Mono">
            LEVEL
          </text>
          <text x="546" y="150" textAnchor="middle" fill="var(--accent)" fontSize="10" fontWeight="700" fontFamily="JetBrains Mono">
            SHIFTER
          </text>
          <text x="546" y="172" textAnchor="middle" fill="var(--text)" fontSize="9" fontFamily="JetBrains Mono">
            HV: 5.0V
          </text>
          <text x="546" y="186" textAnchor="middle" fill="var(--text)" fontSize="9" fontFamily="JetBrains Mono">
            LV: 3.3V
          </text>
          <text x="546" y="212" textAnchor="middle" fill="var(--status-normal)" fontSize="8.5" fontFamily="JetBrains Mono">
            BSS138x4
          </text>

          {/* Block 5: SX1278 / RFM95 LoRa Transceiver */}
          <rect
            x="625"
            y="68"
            width="260"
            height="235"
            rx="8"
            fill="var(--surface-2)"
            stroke="var(--accent)"
            strokeWidth="1.8"
          />
          <text x="755" y="95" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="700">
            RFM95 / SX1278 LoRa
          </text>
          <text x="755" y="112" textAnchor="middle" fill="var(--accent)" fontSize="10" fontFamily="JetBrains Mono">
            Sub-GHz Transceiver (3.3V VDD)
          </text>

          <text x="640" y="135" fill="var(--text)" fontSize="10" fontFamily="JetBrains Mono">
            NSS (CS)
          </text>
          <text x="640" y="158" fill="var(--text)" fontSize="10" fontFamily="JetBrains Mono">
            RESET
          </text>
          <text x="640" y="182" fill="var(--status-normal)" fontSize="10" fontFamily="JetBrains Mono">
            DIO0 (IRQ)
          </text>
          <text x="640" y="208" fill="var(--text)" fontSize="10" fontFamily="JetBrains Mono">
            MOSI / MISO / SCK
          </text>

          <rect x="645" y="226" width="220" height="60" rx="6" fill="var(--bg)" stroke="var(--border)" />
          <text x="655" y="245" fill="var(--accent)" fontSize="10" fontFamily="JetBrains Mono">
            SF{bin.sf} · BW 125 kHz · CR 4/5 · +{bin.txPowerDbm} dBm
          </text>
          <text x="655" y="263" fill="var(--text-muted)" fontSize="9.5" fontFamily="JetBrains Mono">
            Last RSSI: {bin.lastRssiDbm ?? -88} dBm | SNR: {bin.lastSnrDb ?? 6.5} dB
          </text>
          <text x="655" y="278" fill="var(--status-normal)" fontSize="9.5" fontFamily="JetBrains Mono">
            Payload: V1,{bin.id},{Math.round(bin.latestFillPct)},{bin.latestStatus}
          </text>

          {/* Animated Signal Wires */}
          {/* D4 TRIG Wire */}
          <line x1="305" y1="124" x2="193" y2="95" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 3" />
          {/* ECHO Wire via Divider */}
          <line x1="193" y1="138" x2="212" y2="138" stroke="var(--status-filling)" strokeWidth="2" />
          <line x1="284" y1="138" x2="305" y2="148" stroke="var(--status-filling)" strokeWidth="2" strokeDasharray="4 2" />
          {/* I2C Wires */}
          <line x1="305" y1="252" x2="193" y2="252" stroke="var(--sim)" strokeWidth="1.5" />
          <line x1="305" y1="272" x2="193" y2="272" stroke="var(--sim)" strokeWidth="1.5" />
          {/* SPI & Control Wires through Level Shifter */}
          <line x1="480" y1="122" x2="505" y2="122" stroke="var(--accent)" strokeWidth="1.8" />
          <line x1="587" y1="122" x2="625" y2="132" stroke="var(--accent)" strokeWidth="1.8" />

          <line x1="480" y1="147" x2="505" y2="147" stroke="var(--text-muted)" strokeWidth="1.5" />
          <line x1="587" y1="147" x2="625" y2="155" stroke="var(--text-muted)" strokeWidth="1.5" />

          <line x1="480" y1="172" x2="505" y2="172" stroke="var(--status-normal)" strokeWidth="1.8" strokeDasharray="4 2" />
          <line x1="587" y1="172" x2="625" y2="179" stroke="var(--status-normal)" strokeWidth="1.8" strokeDasharray="4 2" />

          <line x1="480" y1="225" x2="505" y2="225" stroke="var(--accent)" strokeWidth="2.2" strokeDasharray="6 3" />
          <line x1="587" y1="225" x2="625" y2="205" stroke="var(--accent)" strokeWidth="2.2" strokeDasharray="6 3" />
        </svg>
      </div>

      {/* Pin Assignment Table matching Architecture Specification */}
      <div className="card-surface overflow-hidden">
        <div className="px-4 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Transmitter Node Pinout &amp; Live Signal Values
          </span>
          <span className="font-mono text-[11px] text-[var(--accent)]">
            Node: {bin.id} (Empty Depth: {bin.emptyDistanceCm} cm)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] font-mono uppercase text-[var(--text-muted)]">
                <th className="py-2 px-3">Arduino Nano Pin</th>
                <th className="py-2 px-3">Connected Peripheral Pin</th>
                <th className="py-2 px-3">Voltage Domain</th>
                <th className="py-2 px-3">Live Telemetry / Signal State</th>
                <th className="py-2 px-3">Engineering Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/60 font-mono text-[11px]">
              {pinRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-[var(--surface-2)]/50">
                  <td className="py-2 px-3 font-bold text-[var(--accent)]">{row.mcuPin}</td>
                  <td className="py-2 px-3 text-[var(--text)]">{row.target}</td>
                  <td className="py-2 px-3 text-[var(--status-filling)]">{row.domain}</td>
                  <td className="py-2 px-3 text-[var(--status-normal)] tabular-nums">
                    {row.liveValue}
                  </td>
                  <td className="py-2 px-3 font-sans text-xs text-[var(--text-muted)]">
                    {row.notes}
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

export const BinDetailView: React.FC<{ isDrawer?: boolean }> = ({ isDrawer = false }) => {
  const bins = useSimStore((s) => s.bins);
  const packets = useSimStore((s) => s.packets);
  const alerts = useSimStore((s) => s.alerts);
  const simTimeSec = useSimStore((s) => s.simTimeSec);
  const energyParams = useSimStore((s) => s.energyParams);
  const networkMode = useSimStore((s) => s.networkMode);
  const setBinFault = useSimStore((s) => s.setBinFault);
  const injectDemoFill = useSimStore((s) => s.injectDemoFill);

  const selectedBinId = useUiStore((s) => s.selectedBinId);
  const selectBin = useUiStore((s) => s.selectBin);
  const setBinDrawerOpen = useUiStore((s) => s.setBinDrawerOpen);
  const binDetailTab = useUiStore((s) => s.binDetailTab);
  const setBinDetailTab = useUiStore((s) => s.setBinDetailTab);

  const bin = bins.find((b) => b.id === selectedBinId) ?? bins[0];
  if (!bin) return null;

  const offline = isBinOffline(simTimeSec, bin.lastSeenSimTime, bin.expectedIntervalSec);
  const binPackets = packets.filter((p) => p.binId === bin.id).slice(0, 50);
  const binAlerts = alerts.filter((a) => a.binId === bin.id);

  const pdrPct =
    bin.packetsSent > 0 ? Math.round((bin.packetsDelivered / bin.packetsSent) * 100) : 100;
  const speedOfSoundMs = Number((331.3 + 0.606 * bin.lastTempC).toFixed(2));

  const energyComparison = compareDailyEnergySchedules(
    energyParams,
    bin.sf,
    bin.zoneId,
    networkMode === 'LORAWAN_SIM'
  );

  return (
    <div className="h-full flex flex-col bg-[var(--surface-1)] overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-2)]/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <select
            value={bin.id}
            onChange={(e) => selectBin(e.target.value, isDrawer)}
            aria-label="Select Smart Bin Node"
            className="px-2.5 py-1.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border-strong)] font-mono text-sm font-bold text-[var(--text)] cursor-pointer"
          >
            {bins.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id} — {b.name} ({Math.round(b.latestFillPct)}%)
              </option>
            ))}
          </select>

          <StatusBadge
            status={offline ? 'OFFLINE' : bin.latestStatus}
            suspect={bin.suspectSensor}
          />
          <ProvenanceBadge provenance={bin.provenance} />
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-muted)]">
            Zone: <strong className="uppercase text-[var(--text)]">{bin.zoneId}</strong> · Last seen{' '}
            {formatRelativeAge(simTimeSec, bin.lastSeenSimTime)}
          </span>
          {isDrawer && (
            <button
              type="button"
              onClick={() => setBinDrawerOpen(false)}
              className="p-1.5 rounded-lg bg-[var(--surface-3)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              title="Close Drawer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 5 Tabs: Overview, Hardware, Sensor, Radio, Energy */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b border-[var(--border)] bg-[var(--surface-1)] overflow-x-auto shrink-0">
        {(
          [
            ['overview', '1. Overview', <Activity className="w-3.5 h-3.5" key="1" />],
            ['hardware', '2. Hardware (2D Schematic)', <Cpu className="w-3.5 h-3.5" key="2" />],
            ['sensor', '3. Ultrasonic Sensor', <Waves className="w-3.5 h-3.5" key="3" />],
            ['radio', '4. LoRa Radio (50 Frames)', <Radio className="w-3.5 h-3.5" key="4" />],
            ['energy', '5. Energy Duty-Cycle', <BatteryCharging className="w-3.5 h-3.5" key="5" />],
          ] as const
        ).map(([tabKey, label, icon]) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setBinDetailTab(tabKey)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              binDetailTab === tabKey
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {binDetailTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Radial Gauge Card */}
              <div className="card-surface p-4 flex items-center gap-4">
                <RadialGauge
                  valuePct={bin.latestFillPct}
                  status={offline ? 'OFFLINE' : bin.latestStatus}
                  size={96}
                />
                <div className="space-y-1">
                  <div className="text-xs font-mono text-[var(--text-muted)]">
                    REPORTED FILL LEVEL
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums">
                    {Math.round(bin.latestFillPct)}%
                  </div>
                  <div className="text-[11px] font-mono text-[var(--text-faint)]">
                    Ground Truth: {bin.trueFillPct.toFixed(1)}% · Depth: {bin.emptyDistanceCm} cm
                  </div>
                </div>
              </div>

              {/* RF Link & Battery Card */}
              <div className="card-surface p-4 space-y-2 font-mono text-xs">
                <div className="text-[var(--text-muted)] uppercase text-[10px]">
                  Radio &amp; Power Telemetry
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Gateway / SF:</span>
                  <span className="font-semibold text-[var(--accent)]">
                    {bin.lastGatewayId || 'GW-01'} · SF{bin.sf}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">RSSI / SNR:</span>
                  <span className="tabular-nums">
                    {bin.lastRssiDbm ?? -88} dBm / {bin.lastSnrDb ?? 6.5} dB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Battery / PDR:</span>
                  <span className="tabular-nums text-[var(--status-normal)]">
                    {bin.batteryPct}% · PDR {pdrPct}%
                  </span>
                </div>
              </div>

              {/* Quick Demo Override Buttons */}
              <div className="card-surface p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase text-[var(--text-muted)]">
                    Push Demo Reading (SIMULATED DEMO)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { pct: 20, label: '20% NORMAL' },
                    { pct: 65, label: '65% FILLING' },
                    { pct: 85, label: '85% HIGH' },
                    { pct: 97, label: '97% FULL' },
                  ].map((btn) => (
                    <button
                      key={btn.pct}
                      type="button"
                      onClick={() => injectDemoFill(bin.id, btn.pct)}
                      className="px-2 py-1.5 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] font-mono text-[11px] text-[var(--text)] cursor-pointer transition"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 24h Threshold Bands Visual & Alert History */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Fill Threshold Bands &amp; Hysteresis Recovery
                  </span>
                  <span className="font-mono text-[10px] text-[var(--text-faint)]">
                    60% / 80% / 95%
                  </span>
                </div>
                <div className="space-y-2 text-xs font-mono">
                  <div className="p-2 rounded bg-[var(--status-full)]/12 border border-[var(--status-full)]/30 flex justify-between">
                    <span className="text-[var(--status-full)] font-semibold">
                      95% – 100%: FULL
                    </span>
                    <span className="text-[var(--text-muted)]">
                      Raises FULL alert · Downgrades &lt; 85%
                    </span>
                  </div>
                  <div className="p-2 rounded bg-[var(--status-high)]/12 border border-[var(--status-high)]/30 flex justify-between">
                    <span className="text-[var(--status-high)] font-semibold">
                      80% – 94%: HIGH
                    </span>
                    <span className="text-[var(--text-muted)]">
                      Raises HIGH alert · Resolves &lt; 70%
                    </span>
                  </div>
                  <div className="p-2 rounded bg-[var(--status-filling)]/12 border border-[var(--status-filling)]/30 flex justify-between">
                    <span className="text-[var(--status-filling)] font-semibold">
                      60% – 79%: FILLING
                    </span>
                    <span className="text-[var(--text-muted)]">Tightens adaptive interval</span>
                  </div>
                  <div className="p-2 rounded bg-[var(--status-normal)]/12 border border-[var(--status-normal)]/30 flex justify-between">
                    <span className="text-[var(--status-normal)] font-semibold">
                      0% – 59%: NORMAL
                    </span>
                    <span className="text-[var(--text-muted)]">Standard sleep interval</span>
                  </div>
                </div>
              </div>

              <div className="card-surface p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Alert History for {bin.id} ({binAlerts.length})
                </div>
                {binAlerts.length === 0 ? (
                  <div className="text-xs text-[var(--text-faint)] font-mono py-6 text-center">
                    No alerts triggered for {bin.id} today.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {binAlerts.map((a) => (
                      <div
                        key={a.id}
                        className="p-2 rounded bg-[var(--surface-2)] border border-[var(--border)] text-xs flex items-center justify-between gap-2"
                      >
                        <div className="truncate">
                          <span className="font-mono font-semibold text-[var(--status-full)]">
                            [{a.type}]
                          </span>{' '}
                          <span>{a.message}</span>
                        </div>
                        <span className="font-mono text-[10px] text-[var(--text-faint)] shrink-0">
                          {formatSimClock(a.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {binDetailTab === 'hardware' && <HardwareSchematic2D bin={bin} />}

        {binDetailTab === 'sensor' && (
          <div className="space-y-4">
            <div className="card-surface p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  HC-SR04 Ultrasonic Sensor Pipeline &amp; Plausibility Check
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Takes 5 raw pulse readings per wake cycle, applies a 5-sample median filter to reject outlier spikes, and checks against the &lt;2.0 cm physical blind zone.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[var(--text-muted)]">Inject Fault:</span>
                {(['NONE', 'BLOCKED', 'SPIKE', 'STUCK', 'DRIFT'] as SensorFaultType[]).map(
                  (f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setBinFault(bin.id, f)}
                      className={`px-2 py-1 rounded font-mono text-xs border cursor-pointer transition ${
                        bin.sensorFault === f
                          ? 'bg-[var(--status-full)]/20 border-[var(--status-full)] text-[var(--status-full)] font-semibold'
                          : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      {f}
                    </button>
                  )
                )}
              </div>
            </div>

            {bin.suspectSensor && (
              <div className="p-3.5 rounded-lg bg-[var(--status-full)]/15 border border-[var(--status-full)] text-[var(--status-full)] flex items-center gap-3 text-xs">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <div>
                  <div className="font-bold font-mono uppercase">
                    PLAUSIBILITY CHECK FAILED: SUSPECT SENSOR READING (&lt; 2.0 CM BLIND ZONE)
                  </div>
                  <div className="mt-0.5">
                    Median distance ({bin.lastMedianCm} cm) fell inside the HC-SR04 2 cm transducer blind zone with an unphysical jump from previous fill. Firmware transmits the frame, and backend flags the alert as <strong>FULL (suspect sensor)</strong>.
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 5 Raw Samples */}
              <div className="card-surface p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Last 5 Raw Ultrasonic Samples
                </div>
                <div className="space-y-1.5 font-mono text-xs">
                  {bin.lastSamplesCm.map((s, i) => {
                    const isOutlier = Math.abs(s - bin.lastMedianCm) > 2.5 || s === 0;
                    return (
                      <div
                        key={i}
                        className={`p-2 rounded border flex items-center justify-between ${
                          isOutlier
                            ? 'bg-[var(--status-high)]/10 border-[var(--status-high)]/40 text-[var(--status-high)]'
                            : 'bg-[var(--surface-2)] border-[var(--border)]'
                        }`}
                      >
                        <span>Sample #{i + 1}</span>
                        <span className="font-semibold tabular-nums">
                          {s === 0 ? '0.00 cm (TIMEOUT)' : `${s.toFixed(2)} cm`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Median Filter Result */}
              <div className="card-surface p-4 space-y-3 font-mono text-xs">
                <div className="text-xs font-sans font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Median Filter &amp; Fill Conversion
                </div>
                <div className="p-2.5 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)]">MEDIAN OF 5 DISTANCE</div>
                  <div className="text-lg font-bold text-[var(--accent)] tabular-nums">
                    d = {bin.lastMedianCm} cm
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)]">
                    FORMULA: clamp((empty - d)/empty * 100, 0, 100)
                  </div>
                  <div className="text-sm font-semibold tabular-nums mt-0.5">
                    (({bin.emptyDistanceCm} - {bin.lastMedianCm}) / {bin.emptyDistanceCm}) × 100 ={' '}
                    <span className="text-[var(--status-normal)]">{bin.latestFillPct}%</span>
                  </div>
                </div>
              </div>

              {/* Speed of Sound Temperature Compensation */}
              <div className="card-surface p-4 space-y-3 font-mono text-xs">
                <div className="text-xs font-sans font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                  <Thermometer className="w-3.5 h-3.5 text-[var(--accent)]" />
                  Temperature Compensation
                </div>
                <div className="p-2.5 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)]">AMBIENT TEMPERATURE</div>
                  <div className="text-base font-semibold tabular-nums">
                    T = {bin.lastTempC.toFixed(1)} °C
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)]">
                    SPEED OF SOUND (v = 331.3 + 0.606 × T)
                  </div>
                  <div className="text-base font-semibold text-[var(--accent)] tabular-nums">
                    v = {speedOfSoundMs} m/s
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)]">ECHO PULSE WIDTH (t = 2d/v)</div>
                  <div className="text-base font-semibold tabular-nums">
                    t = {bin.lastEchoTimeUs} µs
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {binDetailTab === 'radio' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
              <div className="card-surface p-3">
                <div className="text-[10px] text-[var(--text-faint)]">PACKET DELIVERY RATIO</div>
                <div className="text-lg font-bold text-[var(--status-normal)] tabular-nums">
                  {pdrPct}% ({bin.packetsDelivered}/{bin.packetsSent})
                </div>
              </div>
              <div className="card-surface p-3">
                <div className="text-[10px] text-[var(--text-faint)]">CURRENT SF &amp; TX POWER</div>
                <div className="text-lg font-bold text-[var(--accent)] tabular-nums">
                  SF{bin.sf} @ +{bin.txPowerDbm} dBm
                </div>
              </div>
              <div className="card-surface p-3">
                <div className="text-[10px] text-[var(--text-faint)]">DUTY CYCLE USED THIS HOUR</div>
                <div className="text-lg font-bold tabular-nums">
                  {bin.dutyCycleUsedSecInHour.toFixed(2)}s / 36.0s
                </div>
              </div>
            </div>

            <div className="card-surface overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Last 50 Transmitted Frames for {bin.id}
              </div>
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] text-[var(--text-muted)] uppercase">
                      <th className="py-2 px-3">Seq #</th>
                      <th className="py-2 px-3">Sim Time</th>
                      <th className="py-2 px-3">CSV Payload</th>
                      <th className="py-2 px-3">SF / Freq</th>
                      <th className="py-2 px-3">Airtime (ToA)</th>
                      <th className="py-2 px-3">RSSI / SNR</th>
                      <th className="py-2 px-3">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]/60">
                    {binPackets.map((pkt) => (
                      <tr key={pkt.id} className="hover:bg-[var(--surface-2)]/50">
                        <td className="py-2 px-3 font-bold">#{pkt.sequence}</td>
                        <td className="py-2 px-3 text-[var(--text-muted)]">
                          {formatSimClock(pkt.sentAt)}
                        </td>
                        <td className="py-2 px-3">{pkt.payload}</td>
                        <td className="py-2 px-3">
                          SF{pkt.sf} · {pkt.freqMhz} MHz
                        </td>
                        <td className="py-2 px-3 text-[var(--accent)] tabular-nums">
                          {pkt.airtimeMs} ms
                        </td>
                        <td className="py-2 px-3 tabular-nums">
                          {pkt.receptions[0]
                            ? `${pkt.receptions[0].rssiDbm} dBm / ${pkt.receptions[0].snrDb} dB`
                            : '—'}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${
                              pkt.outcome === 'DELIVERED'
                                ? 'bg-[var(--status-normal)]/15 text-[var(--status-normal)]'
                                : 'bg-[var(--status-full)]/15 text-[var(--status-full)]'
                            }`}
                          >
                            {pkt.outcome}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {binDetailTab === 'energy' && (
          <div className="space-y-4">
            <div className="card-surface p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  Estimated Energy (Model) — {bin.id} Duty-Cycle Breakdown
                </h3>
                <ProvenanceBadge provenance="SIMULATED" />
              </div>

              {/* Colored Duty Cycle Bands */}
              <div className="space-y-1.5">
                <div className="text-xs text-[var(--text-muted)]">
                  Single Wake-Measure-Transmit Cycle States (colored proportional bands):
                </div>
                <div className="h-5 w-full rounded-lg overflow-hidden flex font-mono text-[10px] text-[#051014] font-bold">
                  <div
                    style={{ width: '18%' }}
                    className="bg-[#38BDF8] flex items-center justify-center"
                    title="MCU Wake (8 mA)"
                  >
                    WAKE {energyParams.wakeTimeMs}ms
                  </div>
                  <div
                    style={{ width: '48%' }}
                    className="bg-[#FBBF24] flex items-center justify-center"
                    title="HC-SR04 5x Ultrasonic Samples (15 mA)"
                  >
                    MEASURE {energyParams.measureTimeMs}ms
                  </div>
                  <div
                    style={{ width: '24%' }}
                    className="bg-[#F43F5E] text-white flex items-center justify-center"
                    title="LoRa RF Transmit (95 mA)"
                  >
                    TX (SF{bin.sf})
                  </div>
                  <div
                    style={{ width: '10%' }}
                    className="bg-[#34D399] flex items-center justify-center"
                    title="Deep Sleep (0.05 mA)"
                  >
                    SLEEP
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 font-mono text-xs">
                <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)]">FIXED INTERVAL TODAY</div>
                  <div className="text-base font-bold tabular-nums mt-0.5">
                    {energyComparison.fixedMahPerDay} mAh/day
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)]">ADAPTIVE SCHEDULE TODAY</div>
                  <div className="text-base font-bold text-[var(--status-normal)] tabular-nums mt-0.5">
                    {energyComparison.adaptiveMahPerDay} mAh/day
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)]">CURRENT INTERVAL</div>
                  <div className="text-base font-bold text-[var(--accent)] tabular-nums mt-0.5">
                    {Math.round(bin.expectedIntervalSec / 60)} min
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)]">EST. BATTERY DAYS</div>
                  <div className="text-base font-bold tabular-nums mt-0.5">
                    ~{energyComparison.adaptiveBatteryDays} days
                  </div>
                </div>
              </div>

              {/* Mandatory Energy Disclaimer (Section 2) */}
              <div className="pt-2 border-t border-[var(--border)] text-[11px] font-mono text-[var(--text-muted)]">
                Battery-life figures are model estimates. Measure real current draw before claiming improvement.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
