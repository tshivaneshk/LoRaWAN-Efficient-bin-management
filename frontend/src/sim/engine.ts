import { REGION_PRESETS } from '../data/regions';
import { calculateLoRaAirtime } from './airtime';
import { classifyBinStatusWithHysteresis, evaluateBinAlerts } from './alerts';
import { collectBinFill, stepBinTrueFill } from './binModel';
import {
  computeAdaptiveIntervalSec,
  computeSingleCycleEnergyMah,
  DEFAULT_ENERGY_PARAMS,
} from './energy';
import { deduplicateGatewayReceptions, evaluateLoRaWanAdr } from './lorawan';
import { SeededPRNG } from './prng';
import {
  computeLinkBudget,
  generateFastFading,
  mapDistanceToMeters,
  resolveCaptureEffect,
} from './radioModel';
import {
  createInitialBins,
  createScriptedEvents,
  INITIAL_GATEWAYS,
  INITIAL_TRUCKS,
} from './scenario';
import { measureUltrasonicSensor } from './sensorModel';
import {
  Alert,
  Bin,
  BinStatus,
  CollisionEvent,
  EnergyParams,
  Gateway,
  LoRaWANLogEntry,
  MinuteSnapshot,
  NetworkMode,
  PipelineCounters,
  PipelineFaultConfig,
  Provenance,
  RadioPacket,
  RegionCode,
  ScheduleMode,
  ScriptedScenarioEvent,
  SensorFaultType,
  SimStateSnapshot,
  SystemMode,
  TelemetryRecord,
  Truck,
  WeatherCondition,
} from './types';

export class SimulationEngine {
  private prng: SeededPRNG;
  private seed: number;
  private simTimeSec = 0; // 0 = 06:00
  private running = false;
  private speed: 1 | 60 | 600 | 3600 = 60;
  private networkMode: NetworkMode = 'PROTOTYPE_P2P';
  private systemMode: SystemMode = 'SIMULATION';
  private region: RegionCode = 'IN865';
  private weather: WeatherCondition = 'CLEAR';
  private ambientTempC = 22.0;
  private scheduleMode: ScheduleMode = 'ADAPTIVE';
  private zoneCrowdMultipliers: Record<string, number> = {
    terminal: 1.0,
    market: 1.0,
    campus: 1.0,
    stadium: 1.0,
    hospital: 1.0,
    park: 1.0,
    residential: 1.0,
  };

  private bins: Bin[] = [];
  private gateways: Gateway[] = [];
  private trucks: Truck[] = [];
  private packets: RadioPacket[] = [];
  private telemetryLog: TelemetryRecord[] = [];
  private alerts: Alert[] = [];
  private collisions: CollisionEvent[] = [];
  private lorawanLog: LoRaWANLogEntry[] = [];
  private scriptedEvents: ScriptedScenarioEvent[] = [];
  private pipelineCounters: PipelineCounters = {
    binTx: 0,
    loraDelivered: 0,
    loraLost: 0,
    gatewayRx: 0,
    nsDeduplicated: 0,
    nsAdrCount: 0,
    serialLines: 0,
    serialErrors: 0,
    bridgeValidated: 0,
    bridgeRejected: 0,
    apiRequests: 0,
    apiErrors: 0,
    dbInserts: 0,
    uiUpdates: 0,
  };
  private pipelineFaults: PipelineFaultConfig = {
    corruptNextPacket: false,
    dropNextPacket: false,
    duplicateNextSequence: false,
    serialLinkDead: false,
    backendReturn500: false,
  };
  private bridgeLogs: Array<{
    id: string;
    simTime: number;
    level: 'INFO' | 'WARN' | 'ERROR';
    text: string;
  }> = [];
  private timelineHistory: MinuteSnapshot[] = [];
  private stateSnapshotsByMinute: Map<number, SimStateSnapshot> = new Map();
  private energyParams: EnergyParams = { ...DEFAULT_ENERGY_PARAMS };
  private seenSequencesByBin: Map<string, Set<number>> = new Map();
  private lastMinuteRecorded = -1;

  constructor(seed = 42026) {
    this.seed = seed;
    this.prng = new SeededPRNG(seed);
    this.reset(seed);
  }

  public reset(newSeed?: number): void {
    if (newSeed !== undefined) {
      this.seed = newSeed;
    }
    this.prng = new SeededPRNG(this.seed);
    this.simTimeSec = 0;
    this.running = false;
    this.weather = 'CLEAR';
    this.ambientTempC = 22.0;
    this.zoneCrowdMultipliers = {
      terminal: 1.0,
      market: 1.0,
      campus: 1.0,
      stadium: 1.0,
      hospital: 1.0,
      park: 1.0,
      residential: 1.0,
    };
    this.bins = createInitialBins(this.prng);
    this.gateways = INITIAL_GATEWAYS.map((g) => ({ ...g }));
    this.trucks = INITIAL_TRUCKS.map((t) => ({
      ...t,
      position: { ...t.position },
      assignedBinIds: [],
      routePoints: [],
    }));
    this.packets = [];
    this.telemetryLog = [];
    this.alerts = [];
    this.collisions = [];
    this.lorawanLog = [];
    this.scriptedEvents = createScriptedEvents();
    this.pipelineCounters = {
      binTx: 0,
      loraDelivered: 0,
      loraLost: 0,
      gatewayRx: 0,
      nsDeduplicated: 0,
      nsAdrCount: 0,
      serialLines: 0,
      serialErrors: 0,
      bridgeValidated: 0,
      bridgeRejected: 0,
      apiRequests: 0,
      apiErrors: 0,
      dbInserts: 0,
      uiUpdates: 0,
    };
    this.pipelineFaults = {
      corruptNextPacket: false,
      dropNextPacket: false,
      duplicateNextSequence: false,
      serialLinkDead: false,
      backendReturn500: false,
    };
    this.bridgeLogs = [
      {
        id: 'LOG-INIT-1',
        simTime: 0,
        level: 'INFO',
        text: '{"type":"boot","device":"GW-01","fw":"1.4.2-nano","freq_mhz":865.0625} (non-telemetry startup JSON ignored by bridge)',
      },
      {
        id: 'LOG-INIT-2',
        simTime: 0,
        level: 'INFO',
        text: 'Python serial bridge connected on COM4 @ 115200 baud. Awaiting LoRa CSV frames...',
      },
    ];
    this.timelineHistory = [];
    this.stateSnapshotsByMinute.clear();
    this.seenSequencesByBin.clear();
    this.lastMinuteRecorded = -1;
    this.recordMinuteSnapshot(0);
  }

  public getSnapshot(): SimStateSnapshot {
    return {
      simTimeSec: this.simTimeSec,
      running: this.running,
      speed: this.speed,
      seed: this.seed,
      networkMode: this.networkMode,
      region: this.region,
      weather: this.weather,
      ambientTempC: this.ambientTempC,
      scheduleMode: this.scheduleMode,
      zoneCrowdMultipliers: { ...this.zoneCrowdMultipliers },
      bins: this.bins.map((b) => ({ ...b, position: { ...b.position } })),
      gateways: this.gateways.map((g) => ({ ...g, position: { ...g.position } })),
      trucks: this.trucks.map((t) => ({
        ...t,
        position: { ...t.position },
        assignedBinIds: [...t.assignedBinIds],
        routePoints: t.routePoints.map((p) => ({ ...p })),
      })),
      packets: this.packets.slice(0, 140),
      telemetryLog: this.telemetryLog.slice(0, 140),
      alerts: this.alerts.slice(0, 120),
      collisions: this.collisions.slice(0, 60),
      lorawanLog: this.lorawanLog.slice(0, 80),
      scriptedEvents: this.scriptedEvents.map((e) => ({ ...e })),
      pipelineCounters: { ...this.pipelineCounters },
      pipelineFaults: { ...this.pipelineFaults },
      bridgeLogs: this.bridgeLogs.slice(0, 80),
      timelineHistory: [...this.timelineHistory],
      energyParams: { ...this.energyParams },
      systemMode: this.systemMode,
    };
  }

  public setSystemMode(mode: SystemMode): void {
    this.systemMode = mode;
  }

  public setRunning(running: boolean): void {
    this.running = running;
  }

  public setSpeed(speed: 1 | 60 | 600 | 3600): void {
    this.speed = speed;
  }

  public setNetworkMode(mode: NetworkMode): void {
    this.networkMode = mode;
    this.addBridgeLog(
      'INFO',
      mode === 'LORAWAN_SIM'
        ? 'Switched pipeline to Simulated LoRaWAN mode (multi-gateway deduplication + ADR + MIC check enabled).'
        : 'Switched pipeline to Prototype Point-to-Point mode (single gateway USB serial CSV->JSON).'
    );
  }

  public setRegion(region: RegionCode): void {
    this.region = region;
  }

  public setWeather(weather: WeatherCondition): void {
    this.weather = weather;
    this.ambientTempC = weather === 'STORM' ? 16.5 : weather === 'RAIN' ? 18.2 : 23.0;
    this.addBridgeLog('INFO', `Weather condition updated to ${weather} (Temp: ${this.ambientTempC} C).`);
  }

  public setScheduleMode(mode: ScheduleMode): void {
    this.scheduleMode = mode;
  }

  public setEnergyParams(params: Partial<EnergyParams>): void {
    this.energyParams = { ...this.energyParams, ...params };
  }

  public setZoneCrowdMultiplier(zoneId: string, multiplier: number): void {
    this.zoneCrowdMultipliers[zoneId] = multiplier;
  }

  public setGatewayOnline(gatewayId: string, online: boolean): void {
    const gw = this.gateways.find((g) => g.id === gatewayId);
    if (!gw) return;
    gw.online = online;
    if (!online) {
      const existing = this.alerts.find(
        (a) => a.binId === gatewayId && a.type === 'GATEWAY_DOWN' && !a.resolvedAt
      );
      if (!existing) {
        this.alerts.unshift({
          id: `ALT-${gatewayId}-${this.simTimeSec}`,
          binId: gatewayId,
          type: 'GATEWAY_DOWN',
          message: `${gatewayId} (${gw.name}) lost mains power — heartbeat timeout`,
          createdAt: this.simTimeSec,
          provenance: 'SIMULATED',
        });
      }
      this.addBridgeLog('ERROR', `Gateway ${gatewayId} offline — no serial frames or heartbeat.`);
    } else {
      for (const a of this.alerts) {
        if (a.binId === gatewayId && a.type === 'GATEWAY_DOWN' && !a.resolvedAt) {
          a.resolvedAt = this.simTimeSec;
        }
      }
      this.addBridgeLog('INFO', `Gateway ${gatewayId} power restored and online.`);
    }
  }

  public setBinSensorFault(binId: string, fault: SensorFaultType): void {
    const bin = this.bins.find((b) => b.id === binId);
    if (!bin) return;
    bin.sensorFault = fault;
    bin.nextTxSimTime = this.simTimeSec + 2; // trigger immediate measurement cycle
    this.addBridgeLog('WARN', `Sensor fault injector: ${binId} set to ${fault}.`);
  }

  public setPipelineFaults(faults: Partial<PipelineFaultConfig>): void {
    this.pipelineFaults = { ...this.pipelineFaults, ...faults };
  }

  public acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert && !alert.acknowledgedAt) {
      alert.acknowledgedAt = this.simTimeSec;
    }
  }

  public dispatchTruck(truckId: string, binIds: string[]): void {
    const truck = this.trucks.find((t) => t.id === truckId);
    if (!truck || binIds.length === 0) return;

    const targetBins = binIds
      .map((id) => this.bins.find((b) => b.id === id))
      .filter((b): b is Bin => Boolean(b));

    if (targetBins.length === 0) return;

    truck.assignedBinIds = targetBins.map((b) => b.id);
    truck.routePoints = targetBins.map((b) => ({ ...b.position }));
    truck.status = 'EN_ROUTE';

    let totalDist = 0;
    let curr = truck.position;
    for (const pt of truck.routePoints) {
      totalDist += Math.hypot(pt.x - curr.x, pt.y - curr.y);
      curr = pt;
    }
    // Truck speed ~ 0.35 map units per sim second
    truck.etaSimTime = Math.round(this.simTimeSec + totalDist / 0.35);
    this.addBridgeLog(
      'INFO',
      `Dispatched ${truck.id} (${truck.name}) to collect ${truck.assignedBinIds.join(', ')}.`
    );
  }

  public setTruckBreakdown(truckId: string, broken: boolean): void {
    const truck = this.trucks.find((t) => t.id === truckId);
    if (!truck) return;
    truck.status = broken ? 'BROKEN_DOWN' : truck.assignedBinIds.length > 0 ? 'EN_ROUTE' : 'IDLE';
  }

  /**
   * Demo mode injection (Section 6 / Screen 6):
   * Push a specific fill percentage for a chosen bin, tagged SIMULATED_DEMO
   */
  public injectDemoFill(binId: string, fillPct: number): void {
    const bin = this.bins.find((b) => b.id === binId);
    if (!bin) return;
    bin.trueFillPct = fillPct;
    bin.sensorFault = 'NONE';
    this.transmitFromBin(bin, 'SIMULATED_DEMO', fillPct);
  }

  /**
   * Live hardware record injection (Section 9):
   * Updates or creates a bin with provenance LIVE_HARDWARE
   */
  public ingestLiveHardwareRecord(raw: {
    bin_id: string;
    fill_level: number;
    status?: BinStatus;
    battery_pct: number;
    sequence: number; rssi_dbm: number; snr_db: number; provenance?: any;
    isInitialSync?: boolean;
  }): void {
    let bin = this.bins.find((b) => b.id === raw.bin_id);
    if (!bin) {
      bin = {
        id: raw.bin_id,
        name: `Live Prototype (${raw.bin_id})`,
        zoneId: 'market',
        position: { x: 510, y: 310 },
        emptyDistanceCm: 30,
        trueFillPct: raw.fill_level,
        latestFillPct: raw.fill_level,
        latestStatus: raw.status ?? classifyBinStatusWithHysteresis(raw.fill_level, 'NORMAL'),
        batteryPct: raw.battery_pct,
        lastSeenSimTime: this.simTimeSec,
        suspectSensor: false,
        provenance: 'LIVE_HARDWARE',
        baseRate: 0,
        sequence: raw.sequence,
        expectedIntervalSec: 600,
        nextTxSimTime: 999999,
        sf: 7,
        txPowerDbm: 14,
        pathLossExponent: 3.0,
        shadowingDb: { 'GW-01': 0, 'GW-02': 0, 'GW-03': 0 },
        sensorFault: 'NONE',
        consecutiveLowDistanceCount: 0,
        lastSamplesCm: [10, 10, 10, 10, 10],
        lastMedianCm: Number((30 * (1 - raw.fill_level / 100)).toFixed(2)),
        lastEchoTimeUs: 580,
        lastTempC: this.ambientTempC,
        packetsSent: 1,
        packetsDelivered: 1,
        dutyCycleUsedSecInHour: 0,
        energyMahFixedToday: 0.01,
        energyMahAdaptiveToday: 0.01,
        lorawanJoined: false,
        lorawanDevAddr: 'LIVE0001',
        lorawanFCntUp: raw.sequence,
        lorawanFCntDown: 0,
        lastGatewayId: 'GW-01',
        lastRssiDbm: raw.rssi_dbm,
        lastSnrDb: raw.snr_db,
      };
      this.bins.unshift(bin);
    }

    const prevStatus = bin.latestStatus;
    const nextStatus = classifyBinStatusWithHysteresis(raw.fill_level, prevStatus);
    bin.trueFillPct = raw.fill_level;
    bin.latestFillPct = raw.fill_level;
    bin.latestStatus = nextStatus;
    bin.batteryPct = raw.battery_pct;
    bin.sequence = raw.sequence;
    bin.lastSeenSimTime = this.simTimeSec;
    bin.provenance = (raw as any).provenance || 'LIVE_HARDWARE';
    bin.lastRssiDbm = raw.rssi_dbm;
    bin.lastSnrDb = raw.snr_db;
    bin.lastGatewayId = 'GW-01';

    const payload = `V1,${bin.id},${raw.fill_level},${nextStatus},${raw.battery_pct},${raw.sequence}`;
    const airtime = calculateLoRaAirtime({
      payloadBytes: payload.length,
      sf: 7,
      bwKhz: 125,
      cr: 5,
    }).airtimeMs;

    const gwJson = JSON.stringify({
      type: 'telemetry',
      bin_id: bin.id,
      fill_level: raw.fill_level,
      status: nextStatus,
      battery_pct: raw.battery_pct,
      sequence: raw.sequence,
      rssi_dbm: raw.rssi_dbm,
      snr_db: raw.snr_db,
    });

    const pkt: RadioPacket = {
      id: `PKT-LIVE-${raw.sequence}-${Date.now()}`,
      binId: bin.id,
      sequence: raw.sequence,
      payload,
      sf: 7,
      bwKhz: 125,
      cr: 5,
      freqMhz: REGION_PRESETS[this.region].channelsMhz[0],
      txPowerDbm: 14,
      airtimeMs: airtime,
      sentAt: this.simTimeSec,
      receptions: [{ gatewayId: 'GW-01', rssiDbm: raw.rssi_dbm, snrDb: raw.snr_db, distanceM: 45 }],
      outcome: 'DELIVERED', provenance: ((raw as any).provenance || 'LIVE_HARDWARE'),
      hopLatency: {
        sensingMs: 35,
        airtimeMs: airtime,
        gatewayMs: 4,
        serialMs: 9,
        bridgeMs: 3,
        httpMs: 14,
        dbMs: 5,
        pushMs: 2,
      },
      gatewayJsonLine: gwJson,
      validationPassed: true,
      backendHttpStatus: 201,
      dbInserted: true,
    };

    this.packets.unshift(pkt);
    this.telemetryLog.unshift({
      bin_id: bin.id,
      fill_level: raw.fill_level,
      status: nextStatus,
      battery_pct: raw.battery_pct,
      sequence: raw.sequence,
      rssi_dbm: raw.rssi_dbm,
      snr_db: raw.snr_db,
      received_at: this.simTimeToIsoString(this.simTimeSec),
      provenance: 'LIVE_HARDWARE',
    });

    if (raw.isInitialSync) {
      return;
    }

    const evalRes = evaluateBinAlerts({
      binId: bin.id,
      binName: bin.name,
      newStatus: nextStatus,
      previousStatus: prevStatus,
      fillPct: raw.fill_level,
      suspectSensor: false,
      simTimeSec: this.simTimeSec,
      provenance: ((raw as any).provenance || 'LIVE_HARDWARE'), existingAlerts: this.alerts,
    });
    this.alerts = evalRes.updatedAlerts;
  }

  public triggerScriptedEventNow(eventId: string): void {
    if (this.systemMode === 'REALTIME') return;
    const evt = this.scriptedEvents.find((e) => e.id === eventId);
    if (!evt) return;
    evt.triggered = true;
    this.executeScriptedAction(evt.actionType);
  }

  public toggleScriptedEvent(eventId: string, enabled: boolean): void {
    const evt = this.scriptedEvents.find((e) => e.id === eventId);
    if (evt) {
      evt.enabled = enabled;
    }
  }

  public scrubToSimTime(targetSimTimeSec: number): void {
    const targetMinute = Math.floor(targetSimTimeSec / 60);
    const saved = this.stateSnapshotsByMinute.get(targetMinute);
    if (saved) {
      this.restoreFromSnapshot(saved);
      return;
    }
    // If scrubbing forward to a future time not yet simulated, fast-forward deterministically
    if (targetSimTimeSec > this.simTimeSec) {
      const remaining = targetSimTimeSec - this.simTimeSec;
      const stepSize = 30;
      const steps = Math.floor(remaining / stepSize);
      for (let i = 0; i < steps; i++) {
        this.stepBySeconds(stepSize);
      }
    }
  }

  public stepBySeconds(dtSec: number): void {
    // Subdivide large steps so scheduled events and packet collisions remain accurate
    const maxChunk = 15;
    let remaining = dtSec;
    while (remaining > 0) {
      const chunk = Math.min(remaining, maxChunk);
      this.internalStep(chunk);
      remaining -= chunk;
    }
  }

  private internalStep(dtSec: number): void {
    this.simTimeSec = Math.min(86400, this.simTimeSec + dtSec);
    const hourOfDay = (6 + this.simTimeSec / 3600) % 24;

    // Temperature diurnal curve
    if (this.weather === 'CLEAR') {
      this.ambientTempC = Number(
        (20 + 6 * Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI)).toFixed(1)
      );
    }

    // In REALTIME mode: time runs, but NO simulated/predefined packets or scripted alerts are generated
    if (this.systemMode === 'REALTIME') {
      // Advance collection trucks visually if any are on the road
      this.stepTrucks(dtSec);
      const currentMinute = Math.floor(this.simTimeSec / 60);
      if (currentMinute > this.lastMinuteRecorded) {
        this.lastMinuteRecorded = currentMinute;
        this.recordMinuteSnapshot(currentMinute);
      }
      return;
    }

    // 1. Check scripted timeline events
    for (const evt of this.scriptedEvents) {
      if (evt.enabled && !evt.triggered && this.simTimeSec >= evt.simTimeSec) {
        evt.triggered = true;
        this.executeScriptedAction(evt.actionType);
      }
    }

    // 2. Decay duty cycle counters every hour
    if (Math.floor((this.simTimeSec - dtSec) / 3600) < Math.floor(this.simTimeSec / 3600)) {
      for (const b of this.bins) {
        b.dutyCycleUsedSecInHour = 0;
      }
      for (const gw of this.gateways) {
        gw.airtimeUtilisation = Number((gw.airtimeUtilisation * 0.3).toFixed(4));
      }
    }

    // 3. Step bin fills and check if any bin needs to transmit
    const dueBins: Bin[] = [];
    for (const bin of this.bins) {
      if (bin.provenance === 'LIVE_HARDWARE' || bin.provenance === 'SIMULATED_DEMO') continue;

      const prevTrueFill = bin.trueFillPct;
      const mult = this.zoneCrowdMultipliers[bin.zoneId] ?? 1.0;
      bin.trueFillPct = stepBinTrueFill({
        currentFillPct: bin.trueFillPct,
        baseRatePctPerHr: bin.baseRate,
        zoneId: bin.zoneId,
        hourOfDay,
        eventMultiplier: mult,
        dtSec,
        prng: this.prng,
      });

      // Immediate transmit on status threshold crossing (Section 6.7)
      const prevHypotheticalStatus = classifyBinStatusWithHysteresis(prevTrueFill, bin.latestStatus);
      const currHypotheticalStatus = classifyBinStatusWithHysteresis(
        bin.trueFillPct,
        bin.latestStatus
      );
      if (
        currHypotheticalStatus !== prevHypotheticalStatus &&
        this.simTimeSec - bin.lastSeenSimTime >= 60
      ) {
        bin.nextTxSimTime = Math.min(bin.nextTxSimTime, this.simTimeSec);
      }

      // Accumulate baseline sleep current draw
      const sleepMah = (this.energyParams.sleepCurrentMa * (dtSec / 3600));
      bin.energyMahFixedToday = Number((bin.energyMahFixedToday + sleepMah).toFixed(4));
      bin.energyMahAdaptiveToday = Number((bin.energyMahAdaptiveToday + sleepMah).toFixed(4));

      if (this.simTimeSec >= bin.nextTxSimTime) {
        dueBins.push(bin);
      }

      // Check OFFLINE condition (no packet for > 3 expected intervals)
      const silenceSec = this.simTimeSec - bin.lastSeenSimTime;
      if (silenceSec > bin.expectedIntervalSec * 3.1 && bin.lastSeenSimTime > 0) {
        const existingOffline = this.alerts.find(
          (a) => a.binId === bin.id && a.type === 'OFFLINE' && !a.resolvedAt
        );
        if (!existingOffline) {
          this.alerts.unshift({
            id: `ALT-OFF-${bin.id}-${this.simTimeSec}`,
            binId: bin.id,
            type: 'OFFLINE',
            message: `${bin.id} (${bin.name}) OFFLINE — no telemetry for ${Math.round(
              silenceSec / 60
            )} min (>3 intervals)`,
            createdAt: this.simTimeSec,
            provenance: bin.provenance,
          });
        }
      }
    }

    // 4. Process transmissions (and check for simultaneous batch collisions)
    if (dueBins.length > 0) {
      this.processBatchTransmissions(dueBins, hourOfDay);
    }

    // 5. Move collection trucks along routes
    this.stepTrucks(dtSec);

    // 6. Record minute snapshot for scrubbing and timeline sparklines
    const currentMinute = Math.floor(this.simTimeSec / 60);
    if (currentMinute > this.lastMinuteRecorded) {
      this.lastMinuteRecorded = currentMinute;
      this.recordMinuteSnapshot(currentMinute);
    }
  }

  private processBatchTransmissions(dueBins: Bin[], hourOfDay: number): void {
    // If multiple bins transmit within the same step, check if any share SF & channel
    const channels = REGION_PRESETS[this.region].channelsMhz;

    for (let i = 0; i < dueBins.length; i++) {
      const bin = dueBins[i];
      const forceCollisionWith =
        i > 0 &&
        dueBins.length >= 2 &&
        (this.weather !== 'CLEAR' || dueBins.length >= 3) &&
        this.prng.next() < 0.35
          ? dueBins[0]
          : undefined;

      this.transmitFromBin(bin, 'SIMULATED', undefined, forceCollisionWith, channels, hourOfDay);
    }
  }

  private transmitFromBin(
    bin: Bin,
    provenance: Provenance,
    overrideFillPct?: number,
    collidingBin?: Bin,
    channels: number[] = REGION_PRESETS[this.region].channelsMhz,
    hourOfDay: number = (6 + this.simTimeSec / 3600) % 24
  ): void {
    // 1. Ultrasonic sensor measurement
    const sensorRes = measureUltrasonicSensor({
      trueFillPct: overrideFillPct ?? bin.trueFillPct,
      emptyDistanceCm: bin.emptyDistanceCm,
      ambientTempC: this.ambientTempC,
      fault: bin.sensorFault,
      previousMeasuredFillPct: bin.latestFillPct,
      previousLowDistCount: bin.consecutiveLowDistanceCount,
      prng: this.prng,
    });

    bin.lastSamplesCm = sensorRes.samplesCm;
    bin.lastMedianCm = sensorRes.medianDistanceCm;
    bin.lastEchoTimeUs = sensorRes.echoTimeUs;
    bin.lastTempC = this.ambientTempC;
    bin.consecutiveLowDistanceCount = sensorRes.consecutiveLowDistanceCount;

    const measuredFill = overrideFillPct !== undefined ? Math.round(overrideFillPct) : sensorRes.measuredFillPct;
    const prevStatus = bin.latestStatus;
    const nextStatus = classifyBinStatusWithHysteresis(measuredFill, prevStatus);

    // Sequence handling (check fault injection for duplicate sequence)
    if (this.pipelineFaults.duplicateNextSequence) {
      this.pipelineFaults.duplicateNextSequence = false;
      // Do not increment sequence so duplicate-sequence validator triggers
    } else {
      bin.sequence += 1;
      bin.lorawanFCntUp += 1;
    }

    // Schedule next transmission
    const mult = this.zoneCrowdMultipliers[bin.zoneId] ?? 1.0;
    const adaptiveSec = computeAdaptiveIntervalSec({
      zoneId: bin.zoneId,
      hourOfDay,
      fillPct: measuredFill,
      eventMultiplier: mult,
    });
    const fixedSec = this.energyParams.fixedIntervalMin * 60;
    bin.expectedIntervalSec = this.scheduleMode === 'ADAPTIVE' ? adaptiveSec : fixedSec;
    bin.nextTxSimTime = this.simTimeSec + bin.expectedIntervalSec + this.prng.intRange(-8, 12);

    // Construct CSV payload (Section 6.4)
    let payload = `V1,${bin.id},${measuredFill},${nextStatus},${Math.round(bin.batteryPct)},${bin.sequence}`;
    if (this.pipelineFaults.corruptNextPacket) {
      this.pipelineFaults.corruptNextPacket = false;
      payload = `V1,${bin.id},999,BAD_STATE,${Math.round(bin.batteryPct)},${bin.sequence}`;
    }

    const freqMhz = channels[bin.sequence % channels.length];
    const airtimeRes = calculateLoRaAirtime({
      payloadBytes: payload.length,
      sf: bin.sf,
      bwKhz: 125,
      cr: 5,
    });

    // Update energy counters
    const cycleMah = computeSingleCycleEnergyMah(
      this.energyParams,
      airtimeRes.airtimeMs,
      this.networkMode === 'LORAWAN_SIM'
    );
    bin.energyMahAdaptiveToday = Number((bin.energyMahAdaptiveToday + cycleMah).toFixed(4));
    bin.energyMahFixedToday = Number(
      (bin.energyMahFixedToday + cycleMah * (adaptiveSec / fixedSec)).toFixed(4)
    );
    bin.batteryPct = Number(
      Math.max(5, bin.batteryPct - (cycleMah / this.energyParams.batteryCapacityMah) * 100).toFixed(2)
    );

    // Duty cycle check (Section 6.5)
    const dutyLimitSecPerHr = REGION_PRESETS[this.region].dutyCycleLimit * 3600;
    const airtimeSec = airtimeRes.airtimeMs / 1000;
    if (bin.dutyCycleUsedSecInHour + airtimeSec > dutyLimitSecPerHr) {
      const deferredPkt: RadioPacket = {
        id: `PKT-${bin.id}-${bin.sequence}-${this.simTimeSec}`,
        binId: bin.id,
        sequence: bin.sequence,
        payload,
        sf: bin.sf,
        bwKhz: 125,
        cr: 5,
        freqMhz,
        txPowerDbm: bin.txPowerDbm,
        airtimeMs: airtimeRes.airtimeMs,
        sentAt: this.simTimeSec,
        receptions: [],
        outcome: 'DEFERRED_DUTY_CYCLE',
        provenance,
        hopLatency: {
          sensingMs: 38,
          airtimeMs: 0,
          gatewayMs: 0,
          serialMs: 0,
          bridgeMs: 0,
          httpMs: 0,
          dbMs: 0,
          pushMs: 0,
        },
        gatewayJsonLine: '',
        validationPassed: false,
        validationError: 'DEFERRED_DUTY_CYCLE_LIMIT',
        backendHttpStatus: 0,
        dbInserted: false,
      };
      this.packets.unshift(deferredPkt);
      return;
    }

    bin.dutyCycleUsedSecInHour += airtimeSec;
    bin.packetsSent += 1;
    this.pipelineCounters.binTx += 1;

    // Evaluate receptions across active gateways
    // In PROTOTYPE_P2P mode, bins transmit to their primary assigned gateway (or nearest online gateway if in range, though GW-02 outage creates a coverage hole for East stadium bins at SF7)
    const candidateGateways =
      this.networkMode === 'PROTOTYPE_P2P'
        ? this.gateways.filter((g) => g.online && g.id === (bin.lastGatewayId || 'GW-01'))
        : this.gateways.filter((g) => g.online);

    const receptions: Array<{
      gatewayId: string;
      rssiDbm: number;
      snrDb: number;
      distanceM: number;
    }> = [];

    for (const gw of candidateGateways) {
      const distanceM = mapDistanceToMeters(bin.position, gw.position);
      const staticShadow = bin.shadowingDb[gw.id] ?? 0;
      const fastFading = generateFastFading(this.prng);

      const link = computeLinkBudget({
        distanceM,
        txPowerDbm: bin.txPowerDbm,
        pathLossExponent: bin.pathLossExponent,
        staticShadowingDb: staticShadow,
        fastFadingDb: fastFading,
        region: this.region,
        weather: this.weather,
        bwKhz: 125,
        sf: bin.sf,
      });

      if (link.isReceived) {
        receptions.push({
          gatewayId: gw.id,
          rssiDbm: link.rssiDbm,
          snrDb: link.snrDb,
          distanceM: Math.round(distanceM),
        });
      }
    }

    // Check drop fault injection
    if (this.pipelineFaults.dropNextPacket) {
      this.pipelineFaults.dropNextPacket = false;
      receptions.length = 0;
    }

    // Check RF collision if collidingBin is present on same SF
    let outcome: RadioPacket['outcome'] = receptions.length > 0 ? 'DELIVERED' : 'LOST_RANGE';
    if (collidingBin && collidingBin.id !== bin.id && receptions.length > 0) {
      const primaryRx = receptions[0];
      const otherRssi = Number((primaryRx.rssiDbm + this.prng.gaussian(0, 5.5)).toFixed(1));
      const capture = resolveCaptureEffect(primaryRx.rssiDbm, otherRssi);
      const winnerBinId =
        capture === 'A' ? bin.id : capture === 'B' ? collidingBin.id : null;

      this.collisions.unshift({
        id: `COL-${this.simTimeSec}-${bin.id}-${collidingBin.id}`,
        simTime: this.simTimeSec,
        channelMhz: freqMhz,
        sf: bin.sf,
        packetAId: `PKT-${bin.id}-${bin.sequence}`,
        binAId: bin.id,
        rssiADbm: primaryRx.rssiDbm,
        packetBId: `PKT-${collidingBin.id}-${collidingBin.sequence}`,
        binBId: collidingBin.id,
        rssiBDbm: otherRssi,
        winnerBinId,
        gatewayId: primaryRx.gatewayId,
      });

      if (winnerBinId !== bin.id) {
        outcome = 'LOST_COLLISION';
        receptions.length = 0;
      }
    }

    if (outcome !== 'DELIVERED') {
      this.pipelineCounters.loraLost += 1;
      const lostPkt: RadioPacket = {
        id: `PKT-${bin.id}-${bin.sequence}-${this.simTimeSec}`,
        binId: bin.id,
        sequence: bin.sequence,
        payload,
        sf: bin.sf,
        bwKhz: 125,
        cr: 5,
        freqMhz,
        txPowerDbm: bin.txPowerDbm,
        airtimeMs: airtimeRes.airtimeMs,
        sentAt: this.simTimeSec,
        receptions: [],
        outcome,
        provenance,
        hopLatency: {
          sensingMs: 38,
          airtimeMs: airtimeRes.airtimeMs,
          gatewayMs: 0,
          serialMs: 0,
          bridgeMs: 0,
          httpMs: 0,
          dbMs: 0,
          pushMs: 0,
        },
        gatewayJsonLine: '',
        validationPassed: false,
        validationError: outcome === 'LOST_COLLISION' ? 'RF_COLLISION_LOST' : 'BELOW_SENSITIVITY_FLOOR',
        backendHttpStatus: 0,
        dbInserted: false,
      };
      this.packets.unshift(lostPkt);
      return;
    }

    // Packet reached at least one gateway
    this.pipelineCounters.loraDelivered += 1;
    this.pipelineCounters.gatewayRx += receptions.length;

    const { bestReception, deduplicatedCount } = deduplicateGatewayReceptions(receptions);
    const chosenRx = bestReception!;

    // Update gateway stats
    for (const rx of receptions) {
      const gw = this.gateways.find((g) => g.id === rx.gatewayId);
      if (gw) {
        gw.rxCount += 1;
        gw.meanRssiDbm = Number(((gw.meanRssiDbm * 0.9 + rx.rssiDbm * 0.1)).toFixed(1));
        gw.meanSnrDb = Number(((gw.meanSnrDb * 0.9 + rx.snrDb * 0.1)).toFixed(1));
        gw.airtimeUtilisation = Math.min(
          1,
          Number((gw.airtimeUtilisation + airtimeRes.airtimeMs / (3600 * 1000) * 18).toFixed(4))
        );
      }
    }

    // LoRaWAN network server layer (if enabled)
    let lorawanAdrCommand: string | undefined;
    if (this.networkMode === 'LORAWAN_SIM') {
      if (deduplicatedCount > 0) {
        this.pipelineCounters.nsDeduplicated += deduplicatedCount;
        this.lorawanLog.unshift({
          id: `LW-DEDUPE-${bin.id}-${bin.sequence}`,
          simTime: this.simTimeSec,
          binId: bin.id,
          type: 'UPLINK_DEDUPE',
          details: `Frame #${bin.lorawanFCntUp} received by ${receptions.length} gateways; merged (${deduplicatedCount} duplicate(s) discarded). Best SNR ${chosenRx.snrDb} dB at ${chosenRx.gatewayId}.`,
          gatewaysHeard: receptions.map((r) => r.gatewayId),
          bestGatewayId: chosenRx.gatewayId,
          bestSnrDb: chosenRx.snrDb,
        });
      }

      const adr = evaluateLoRaWanAdr({
        currentSf: bin.sf,
        currentTxPowerDbm: bin.txPowerDbm,
        bestSnrDb: chosenRx.snrDb,
        maxEirpDbm: REGION_PRESETS[this.region].maxEirpDbm,
      });

      if (adr.commandText && adr.newSf !== bin.sf) {
        bin.sf = adr.newSf;
        lorawanAdrCommand = adr.commandText;
        this.pipelineCounters.nsAdrCount += 1;
        this.lorawanLog.unshift({
          id: `LW-ADR-${bin.id}-${bin.sequence}`,
          simTime: this.simTimeSec,
          binId: bin.id,
          type: 'ADR_CMD',
          details: adr.commandText,
          gatewaysHeard: receptions.map((r) => r.gatewayId),
          bestGatewayId: chosenRx.gatewayId,
          bestSnrDb: chosenRx.snrDb,
        });
      }
    }

    // Parse CSV at gateway / bridge
    const parts = payload.split(',');
    const parsedFill = Number(parts[2]);
    const parsedStatus = parts[3] as BinStatus;
    const parsedBattery = Number(parts[4]);
    const parsedSeq = Number(parts[5]);

    const gatewayJsonLine = JSON.stringify({
      type: 'telemetry',
      bin_id: parts[1] || bin.id,
      fill_level: parsedFill,
      status: parsedStatus,
      battery_pct: parsedBattery,
      sequence: parsedSeq,
      rssi_dbm: chosenRx.rssiDbm,
      snr_db: chosenRx.snrDb,
    });

    // Check serial link fault
    if (this.pipelineFaults.serialLinkDead) {
      this.pipelineCounters.serialErrors += 1;
      this.addBridgeLog(
        'ERROR',
        `Serial link read timeout (COM4 disconnected). Reconnect backoff attempt in 2.0s — dropped frame seq ${bin.sequence} from ${bin.id}.`
      );
      const serialFailPkt: RadioPacket = {
        id: `PKT-${bin.id}-${bin.sequence}-${this.simTimeSec}`,
        binId: bin.id,
        sequence: bin.sequence,
        payload,
        sf: bin.sf,
        bwKhz: 125,
        cr: 5,
        freqMhz,
        txPowerDbm: bin.txPowerDbm,
        airtimeMs: airtimeRes.airtimeMs,
        sentAt: this.simTimeSec,
        receptions,
        outcome: 'DELIVERED',
        provenance,
        hopLatency: {
          sensingMs: 38,
          airtimeMs: airtimeRes.airtimeMs,
          gatewayMs: 5,
          serialMs: 0,
          bridgeMs: 0,
          httpMs: 0,
          dbMs: 0,
          pushMs: 0,
        },
        gatewayJsonLine,
        validationPassed: false,
        validationError: 'SERIAL_LINK_DISCONNECTED',
        backendHttpStatus: 0,
        dbInserted: false,
        lorawanDeduplicatedCount: deduplicatedCount,
        lorawanAdrCommand,
      };
      this.packets.unshift(serialFailPkt);
      return;
    }

    this.pipelineCounters.serialLines += 1;

    // Bridge validation (Section 6.4):
    // Reject malformed packets, invalid percentages, unknown status strings, and duplicate sequence numbers
    let validationPassed = true;
    let validationError: string | undefined;
    let duplicateRejected = false;

    const validStatuses: BinStatus[] = ['NORMAL', 'FILLING', 'HIGH', 'FULL'];
    const seenSet = this.seenSequencesByBin.get(bin.id) ?? new Set<number>();

    if (parts.length !== 6 || parts[0] !== 'V1') {
      validationPassed = false;
      validationError = 'ERR_MALFORMED_CSV_HEADER';
    } else if (Number.isNaN(parsedFill) || parsedFill < 0 || parsedFill > 100) {
      validationPassed = false;
      validationError = `ERR_FILL_OUT_OF_RANGE (${parsedFill}%)`;
    } else if (!validStatuses.includes(parsedStatus)) {
      validationPassed = false;
      validationError = `ERR_UNKNOWN_STATUS (${parsedStatus})`;
    } else if (seenSet.has(parsedSeq)) {
      validationPassed = false;
      duplicateRejected = true;
      validationError = `ERR_DUPLICATE_SEQUENCE (seq #${parsedSeq} already ingested)`;
    }

    if (!validationPassed) {
      this.pipelineCounters.bridgeRejected += 1;
      this.addBridgeLog(
        'WARN',
        `Bridge validator rejected frame from ${bin.id}: ${validationError} | Raw: ${payload}`
      );
      if (duplicateRejected && this.networkMode === 'LORAWAN_SIM') {
        this.lorawanLog.unshift({
          id: `LW-REPLAY-${bin.id}-${parsedSeq}-${this.simTimeSec}`,
          simTime: this.simTimeSec,
          binId: bin.id,
          type: 'REPLAY_REJECT',
          details: `Frame counter replay rejected: FCntUp #${parsedSeq} <= last seen counter.`,
          gatewaysHeard: receptions.map((r) => r.gatewayId),
          bestGatewayId: chosenRx.gatewayId,
          bestSnrDb: chosenRx.snrDb,
        });
      }

      const invalidPkt: RadioPacket = {
        id: `PKT-${bin.id}-${bin.sequence}-${this.simTimeSec}`,
        binId: bin.id,
        sequence: bin.sequence,
        payload,
        sf: bin.sf,
        bwKhz: 125,
        cr: 5,
        freqMhz,
        txPowerDbm: bin.txPowerDbm,
        airtimeMs: airtimeRes.airtimeMs,
        sentAt: this.simTimeSec,
        receptions,
        outcome: 'DELIVERED',
        provenance,
        hopLatency: {
          sensingMs: 38,
          airtimeMs: airtimeRes.airtimeMs,
          gatewayMs: 5,
          serialMs: 11,
          bridgeMs: 4,
          httpMs: 0,
          dbMs: 0,
          pushMs: 0,
        },
        gatewayJsonLine,
        validationPassed: false,
        validationError,
        duplicateRejected,
        backendHttpStatus: 0,
        dbInserted: false,
        lorawanDeduplicatedCount: deduplicatedCount,
        lorawanAdrCommand,
      };
      this.packets.unshift(invalidPkt);
      return;
    }

    seenSet.add(parsedSeq);
    this.seenSequencesByBin.set(bin.id, seenSet);
    this.pipelineCounters.bridgeValidated += 1;
    this.pipelineCounters.apiRequests += 1;

    // Check Backend 500 fault injection
    if (this.pipelineFaults.backendReturn500) {
      this.pipelineCounters.apiErrors += 1;
      this.addBridgeLog(
        'ERROR',
        `POST /api/v1/telemetry returned HTTP 500 Internal Server Error for ${bin.id} seq #${bin.sequence}. Queued for retry with backoff.`
      );
      const apiFailPkt: RadioPacket = {
        id: `PKT-${bin.id}-${bin.sequence}-${this.simTimeSec}`,
        binId: bin.id,
        sequence: bin.sequence,
        payload,
        sf: bin.sf,
        bwKhz: 125,
        cr: 5,
        freqMhz,
        txPowerDbm: bin.txPowerDbm,
        airtimeMs: airtimeRes.airtimeMs,
        sentAt: this.simTimeSec,
        receptions,
        outcome: 'DELIVERED',
        provenance,
        hopLatency: {
          sensingMs: 38,
          airtimeMs: airtimeRes.airtimeMs,
          gatewayMs: 5,
          serialMs: 12,
          bridgeMs: 4,
          httpMs: 42,
          dbMs: 0,
          pushMs: 0,
        },
        gatewayJsonLine,
        validationPassed: true,
        backendHttpStatus: 500,
        dbInserted: false,
        lorawanDeduplicatedCount: deduplicatedCount,
        lorawanAdrCommand,
      };
      this.packets.unshift(apiFailPkt);
      return;
    }

    // Full end-to-end delivery
    this.pipelineCounters.dbInserts += 1;
    this.pipelineCounters.uiUpdates += 1;
    bin.packetsDelivered += 1;
    bin.latestFillPct = measuredFill;
    bin.latestStatus = nextStatus;
    bin.lastSeenSimTime = this.simTimeSec;
    bin.suspectSensor = sensorRes.suspect;
    bin.provenance = provenance;
    bin.lastGatewayId = chosenRx.gatewayId;
    bin.lastRssiDbm = chosenRx.rssiDbm;
    bin.lastSnrDb = chosenRx.snrDb;

    const hopLatency = {
      sensingMs: this.prng.intRange(32, 46),
      airtimeMs: airtimeRes.airtimeMs,
      gatewayMs: this.prng.intRange(3, 7),
      serialMs: this.prng.intRange(7, 18),
      bridgeMs: this.prng.intRange(2, 6),
      httpMs: this.prng.intRange(11, 28),
      dbMs: this.prng.intRange(4, 11),
      pushMs: this.prng.intRange(2, 5),
    };

    const deliveredPkt: RadioPacket = {
      id: `PKT-${bin.id}-${bin.sequence}-${this.simTimeSec}`,
      binId: bin.id,
      sequence: bin.sequence,
      payload,
      sf: bin.sf,
      bwKhz: 125,
      cr: 5,
      freqMhz,
      txPowerDbm: bin.txPowerDbm,
      airtimeMs: airtimeRes.airtimeMs,
      sentAt: this.simTimeSec,
      receptions,
      outcome: 'DELIVERED',
      provenance,
      hopLatency,
      gatewayJsonLine,
      validationPassed: true,
      backendHttpStatus: 201,
      dbInserted: true,
      lorawanDeduplicatedCount: deduplicatedCount,
      lorawanAdrCommand,
      rx1WindowMs: this.networkMode === 'LORAWAN_SIM' ? 1000 : undefined,
      rx2WindowMs: this.networkMode === 'LORAWAN_SIM' ? 2000 : undefined,
    };

    this.packets.unshift(deliveredPkt);

    this.telemetryLog.unshift({
      bin_id: bin.id,
      fill_level: measuredFill,
      status: nextStatus,
      battery_pct: Math.round(bin.batteryPct),
      sequence: bin.sequence,
      rssi_dbm: chosenRx.rssiDbm,
      snr_db: chosenRx.snrDb,
      received_at: this.simTimeToIsoString(this.simTimeSec),
      provenance,
      suspect: sensorRes.suspect,
    });

    const alertEval = evaluateBinAlerts({
      binId: bin.id,
      binName: bin.name,
      newStatus: nextStatus,
      previousStatus: prevStatus,
      fillPct: measuredFill,
      suspectSensor: sensorRes.suspect,
      simTimeSec: this.simTimeSec,
      provenance,
      existingAlerts: this.alerts,
    });
    this.alerts = alertEval.updatedAlerts;

    if (alertEval.newAlerts.length > 0) {
      for (const na of alertEval.newAlerts) {
        this.addBridgeLog('WARN', `Alert raised: ${na.message}`);
      }
    }
  }

  private stepTrucks(dtSec: number): void {
    const speedUnitsPerSec = 0.42;
    for (const truck of this.trucks) {
      if (truck.status !== 'EN_ROUTE' && truck.status !== 'COLLECTING') continue;
      if (truck.assignedBinIds.length === 0) {
        truck.status = 'IDLE';
        truck.routePoints = [];
        truck.etaSimTime = undefined;
        continue;
      }

      const targetBinId = truck.assignedBinIds[0];
      const targetBin = this.bins.find((b) => b.id === targetBinId);
      if (!targetBin) {
        truck.assignedBinIds.shift();
        truck.routePoints.shift();
        continue;
      }

      const dx = targetBin.position.x - truck.position.x;
      const dy = targetBin.position.y - truck.position.y;
      const dist = Math.hypot(dx, dy);
      const maxMove = speedUnitsPerSec * dtSec;

      if (dist <= maxMove + 4) {
        // Arrived at bin: collect it!
        truck.position = { ...targetBin.position };
        truck.status = 'COLLECTING';
        const resetFill = collectBinFill(this.prng);
        targetBin.trueFillPct = resetFill;
        targetBin.sensorFault = 'NONE';
        this.transmitFromBin(targetBin, 'SIMULATED', resetFill);

        truck.collectedToday += 1;
        truck.loadPct = Math.min(100, truck.loadPct + 9);
        truck.assignedBinIds.shift();
        truck.routePoints.shift();

        this.addBridgeLog(
          'INFO',
          `${truck.id} collected ${targetBin.id} (${targetBin.name}) — fill reset to ${resetFill}%.`
        );

        if (truck.assignedBinIds.length === 0) {
          truck.status = 'IDLE';
          truck.etaSimTime = undefined;
        } else {
          truck.status = 'EN_ROUTE';
        }
      } else {
        truck.position = {
          x: Number((truck.position.x + (dx / dist) * maxMove).toFixed(1)),
          y: Number((truck.position.y + (dy / dist) * maxMove).toFixed(1)),
        };
      }
    }
  }

  private executeScriptedAction(action: ScriptedScenarioEvent['actionType']): void {
    switch (action) {
      case 'QUIET_START':
        this.addBridgeLog('INFO', '[06:00 Scenario] Quiet start across Northgate district.');
        break;

      case 'COMMUTER_RUSH':
        this.zoneCrowdMultipliers.terminal = 3.2;
        for (const b of this.bins.filter((x) => x.zoneId === 'terminal')) {
          b.trueFillPct = Math.max(b.trueFillPct, this.prng.range(64, 78));
          b.nextTxSimTime = this.simTimeSec + this.prng.intRange(2, 18);
        }
        this.addBridgeLog(
          'INFO',
          '[08:00 Scenario] Commuter rush at Bus Terminal — fill rates ramping, adaptive intervals tightening.'
        );
        break;

      case 'MARKET_SPIKE':
        this.zoneCrowdMultipliers.market = 3.5;
        for (const b of this.bins.filter((x) => x.zoneId === 'market')) {
          b.trueFillPct = Math.max(b.trueFillPct, this.prng.range(82, 91));
          b.nextTxSimTime = this.simTimeSec + this.prng.intRange(1, 12);
        }
        this.addBridgeLog(
          'WARN',
          '[12:30 Scenario] Market Street lunch spike — multiple market bins crossing 80% HIGH threshold.'
        );
        break;

      case 'SENSOR_FAULT_BIN07': {
        const bin07 = this.bins.find((b) => b.id === 'BIN-07');
        if (bin07) {
          bin07.sensorFault = 'BLOCKED';
          bin07.consecutiveLowDistanceCount = 2;
          this.transmitFromBin(bin07, 'SIMULATED');
        }
        this.addBridgeLog(
          'WARN',
          '[15:00 Scenario] Sensor obstruction on BIN-07 (reads ~1.0 cm in <2 cm blind zone). Plausibility flag raised.'
        );
        break;
      }

      case 'STADIUM_OVERFLOW':
        this.zoneCrowdMultipliers.stadium = 4.0;
        for (const b of this.bins.filter((x) => x.zoneId === 'stadium')) {
          b.trueFillPct = this.prng.range(95.5, 99.2);
          b.nextTxSimTime = this.simTimeSec + this.prng.intRange(1, 10);
        }
        this.addBridgeLog(
          'WARN',
          '[17:00 Scenario] Stadium event ended — spectator surge pushes BIN-14..BIN-17 to FULL.'
        );
        break;

      case 'GATEWAY2_POWER_LOSS':
        this.setGatewayOnline('GW-02', false);
        break;

      case 'HEAVY_RAIN':
        this.setWeather('STORM');
        // Force immediate burst so user sees SNR drop, ADR SF step-up, and collision
        for (const b of this.bins.slice(0, 8)) {
          b.nextTxSimTime = this.simTimeSec + 2;
        }
        break;

      case 'TRUCK1_STADIUM_COLLECT':
        this.dispatchTruck('TRK-01', ['BIN-14', 'BIN-15', 'BIN-16', 'BIN-17', 'BIN-06', 'BIN-08']);
        break;

      case 'NIGHT_LOW_USE':
        this.weather = 'CLEAR';
        for (const k of Object.keys(this.zoneCrowdMultipliers)) {
          this.zoneCrowdMultipliers[k] = 0.5;
        }
        this.addBridgeLog(
          'INFO',
          '[02:00 Scenario] Night low-use mode — adaptive sleep scheduler stretches intervals to 60 min.'
        );
        break;
    }
  }

  private recordMinuteSnapshot(minuteIndex: number): void {
    const activeAlertsCount = this.alerts.filter((a) => !a.resolvedAt).length;
    const meanAirtime =
      this.gateways.reduce((acc, g) => acc + g.airtimeUtilisation, 0) /
      Math.max(1, this.gateways.length);
    const meanFill =
      this.bins.reduce((acc, b) => acc + b.latestFillPct, 0) / Math.max(1, this.bins.length);

    const sfCounts: Record<7 | 8 | 9 | 10 | 11 | 12, number> = {
      7: 0,
      8: 0,
      9: 0,
      10: 0,
      11: 0,
      12: 0,
    };
    for (const b of this.bins) {
      sfCounts[b.sf] = (sfCounts[b.sf] ?? 0) + 1;
    }

    const snap: MinuteSnapshot = {
      minuteIndex,
      simTimeSec: this.simTimeSec,
      activeAlertsCount,
      airtimeUtilPct: Number((meanAirtime * 100).toFixed(2)),
      meanFillPct: Number(meanFill.toFixed(1)),
      sfCounts,
    };

    this.timelineHistory.push(snap);
    if (this.timelineHistory.length > 1445) {
      this.timelineHistory.shift();
    }

    // Store periodic full state snapshot for timeline scrubbing (every 5 minutes to keep memory light)
    if (minuteIndex % 5 === 0) {
      this.stateSnapshotsByMinute.set(minuteIndex, this.getSnapshot());
    }
  }

  private restoreFromSnapshot(snap: SimStateSnapshot): void {
    this.simTimeSec = snap.simTimeSec;
    this.weather = snap.weather;
    this.ambientTempC = snap.ambientTempC;
    this.zoneCrowdMultipliers = { ...snap.zoneCrowdMultipliers };
    this.bins = snap.bins.map((b) => ({ ...b, position: { ...b.position } }));
    this.gateways = snap.gateways.map((g) => ({ ...g, position: { ...g.position } }));
    this.trucks = snap.trucks.map((t) => ({
      ...t,
      position: { ...t.position },
      assignedBinIds: [...t.assignedBinIds],
      routePoints: t.routePoints.map((p) => ({ ...p })),
    }));
    this.packets = [...snap.packets];
    this.telemetryLog = [...snap.telemetryLog];
    this.alerts = [...snap.alerts];
    this.collisions = [...snap.collisions];
    this.lorawanLog = [...snap.lorawanLog];
    this.pipelineCounters = { ...snap.pipelineCounters };
  }

  private addBridgeLog(level: 'INFO' | 'WARN' | 'ERROR', text: string): void {
    this.bridgeLogs.unshift({
      id: `BLOG-${this.simTimeSec}-${Math.random().toString(36).slice(2, 6)}`,
      simTime: this.simTimeSec,
      level,
      text,
    });
    if (this.bridgeLogs.length > 100) {
      this.bridgeLogs.pop();
    }
  }

  private simTimeToIsoString(simTimeSec: number): string {
    const baseMs = Date.UTC(2026, 9, 21, 6, 0, 0);
    return new Date(baseMs + simTimeSec * 1000).toISOString();
  }
}





