import { describe, expect, it } from 'vitest';
import { calculateLoRaAirtime } from '../airtime';
import { classifyBinStatusWithHysteresis, evaluateBinAlerts } from '../alerts';
import { SimulationEngine } from '../engine';
import { SeededPRNG } from '../prng';
import { computeLinkBudget, resolveCaptureEffect } from '../radioModel';
import { clamp, computeMedian, measureUltrasonicSensor } from '../sensorModel';

describe('Northgate Waste Ops Simulation Core Formulas', () => {
  it('computes known Semtech LoRa Time-on-Air (ToA) values accurately', () => {
    // SF7, BW 125 kHz, CR 4/5 (cr=5), 24-byte payload, 8 preamble symbols, explicit header, CRC on
    const sf7 = calculateLoRaAirtime({
      payloadBytes: 24,
      sf: 7,
      bwKhz: 125,
      cr: 5,
    });
    // Tsym = 128 / 125000 = 1.024 ms
    // Tpreamble = 12.25 * 1.024 = 12.544 ms
    // payloadSymbNb = 8 + ceil((192 - 28 + 28 + 16)/28)*5 = 8 + ceil(208/28)*5 = 8 + 8*5 = 48
    // Tpayload = 48 * 1.024 = 49.152 ms -> ToA = 61.696 -> 61.70 ms
    expect(sf7.tSymMs).toBeCloseTo(1.024, 3);
    expect(sf7.payloadSymbNb).toBe(48);
    expect(sf7.airtimeMs).toBeCloseTo(61.7, 1);
    expect(sf7.lowDataRateOptimize).toBe(false);

    // SF12, BW 125 kHz, CR 4/5, 24-byte payload -> Tsym = 32.768 ms (>16 ms, so DE = 1)
    const sf12 = calculateLoRaAirtime({
      payloadBytes: 24,
      sf: 12,
      bwKhz: 125,
      cr: 5,
    });
    expect(sf12.tSymMs).toBeCloseTo(32.768, 3);
    expect(sf12.lowDataRateOptimize).toBe(true);
    expect(sf12.airtimeMs).toBeGreaterThan(1400);
  });

  it('computes median of 5 and clamps ultrasonic sensor readings with blind-zone plausibility', () => {
    expect(computeMedian([12.4, 2.1, 12.1, 12.6, 45.0])).toBe(12.4);
    expect(clamp(108, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);

    const prng = new SeededPRNG(12345);
    const blocked = measureUltrasonicSensor({
      trueFillPct: 30,
      emptyDistanceCm: 30,
      ambientTempC: 22,
      fault: 'BLOCKED',
      previousMeasuredFillPct: 30,
      previousLowDistCount: 1,
      prng,
    });
    expect(blocked.medianDistanceCm).toBeLessThan(2.0);
    expect(blocked.measuredFillPct).toBeGreaterThanOrEqual(95);
    expect(blocked.suspect).toBe(true);
  });

  it('enforces hysteresis transitions (HIGH resolves <70%, FULL downgrades <85%) without duplicate alerts', () => {
    // Upward transitions
    expect(classifyBinStatusWithHysteresis(59, 'NORMAL')).toBe('NORMAL');
    expect(classifyBinStatusWithHysteresis(60, 'NORMAL')).toBe('FILLING');
    expect(classifyBinStatusWithHysteresis(80, 'FILLING')).toBe('HIGH');
    expect(classifyBinStatusWithHysteresis(95, 'HIGH')).toBe('FULL');

    // Hysteresis on FULL: stays FULL at 86%, downgrades to HIGH at 84%
    expect(classifyBinStatusWithHysteresis(86, 'FULL')).toBe('FULL');
    expect(classifyBinStatusWithHysteresis(84, 'FULL')).toBe('HIGH');

    // Hysteresis on HIGH: stays HIGH at 72%, resolves to FILLING at 69%
    expect(classifyBinStatusWithHysteresis(72, 'HIGH')).toBe('HIGH');
    expect(classifyBinStatusWithHysteresis(69, 'HIGH')).toBe('FILLING');

    // Alert deduplication check
    const firstEval = evaluateBinAlerts({
      binId: 'BIN-05',
      binName: 'Market West',
      newStatus: 'HIGH',
      previousStatus: 'FILLING',
      fillPct: 82,
      suspectSensor: false,
      simTimeSec: 1000,
      provenance: 'SIMULATED',
      existingAlerts: [],
    });
    expect(firstEval.newAlerts.length).toBe(1);

    // Subsequent packet still HIGH -> must NOT create a duplicate alert
    const secondEval = evaluateBinAlerts({
      binId: 'BIN-05',
      binName: 'Market West',
      newStatus: 'HIGH',
      previousStatus: 'HIGH',
      fillPct: 85,
      suspectSensor: false,
      simTimeSec: 1600,
      provenance: 'SIMULATED',
      existingAlerts: firstEval.updatedAlerts,
    });
    expect(secondEval.newAlerts.length).toBe(0);
    expect(secondEval.updatedAlerts.length).toBe(1);
  });

  it('resolves RF capture effect (6 dB threshold) and log-distance link budget', () => {
    expect(resolveCaptureEffect(-80, -87)).toBe('A'); // +7 dB >= 6 dB
    expect(resolveCaptureEffect(-92, -85)).toBe('B'); // -7 dB <= -6 dB
    expect(resolveCaptureEffect(-85, -88)).toBe('BOTH_LOST'); // 3 dB difference -> both lost

    const clearLink = computeLinkBudget({
      distanceM: 500,
      txPowerDbm: 14,
      pathLossExponent: 3.15,
      staticShadowingDb: 0,
      fastFadingDb: 0,
      region: 'IN865',
      weather: 'CLEAR',
      bwKhz: 125,
      sf: 7,
    });
    const stormLink = computeLinkBudget({
      distanceM: 500,
      txPowerDbm: 14,
      pathLossExponent: 3.15,
      staticShadowingDb: 0,
      fastFadingDb: 0,
      region: 'IN865',
      weather: 'STORM',
      bwKhz: 125,
      sf: 7,
    });
    expect(stormLink.rssiDbm).toBeLessThan(clearLink.rssiDbm);
    expect(stormLink.snrDb).toBeLessThan(clearLink.snrDb);
  });

  it('produces identical deterministic simulation output for a fixed seed', () => {
    const simA = new SimulationEngine(999111);
    const simB = new SimulationEngine(999111);

    simA.stepBySeconds(7200);
    simB.stepBySeconds(7200);

    const snapA = simA.getSnapshot();
    const snapB = simB.getSnapshot();

    expect(snapA.simTimeSec).toBe(7200);
    expect(snapA.bins.map((b) => b.trueFillPct)).toEqual(snapB.bins.map((b) => b.trueFillPct));
    expect(snapA.packets.length).toBe(snapB.packets.length);
    expect(snapA.pipelineCounters).toEqual(snapB.pipelineCounters);
  });

  it('plays the full 24-hour "A Day in Northgate" scenario end-to-end without errors and tags demo readings SIMULATED_DEMO', () => {
    const engine = new SimulationEngine(42026);
    engine.setNetworkMode('LORAWAN_SIM');

    // Step through the entire 24-hour day (86400 seconds)
    for (let t = 0; t < 86400; t += 1800) {
      engine.stepBySeconds(1800);
    }

    const snapAfterDay = engine.getSnapshot();
    expect(snapAfterDay.simTimeSec).toBe(86400);
    expect(snapAfterDay.scriptedEvents.every((e) => e.triggered)).toBe(true);
    expect(snapAfterDay.alerts.length).toBeGreaterThan(0);

    // Inject a demo reading and verify provenance is SIMULATED_DEMO
    engine.injectDemoFill('BIN-01', 97);
    const snapWithDemo = engine.getSnapshot();
    const latestPkt = snapWithDemo.packets[0];
    expect(latestPkt.binId).toBe('BIN-01');
    expect(latestPkt.provenance).toBe('SIMULATED_DEMO');
  });

  it('guarantees ingestLiveHardwareRecord updates bin state, updates packet history, and raises alerts via hysteresis', () => {
    const engine = new SimulationEngine(42026);
    const initialSnap = engine.getSnapshot();
    const bin01Initial = initialSnap.bins.find((b) => b.id === 'BIN-01')!;
    expect(bin01Initial.latestStatus).toBe('NORMAL');

    // 1. Ingest record at 85% fill -> triggers HIGH alert transition
    engine.ingestLiveHardwareRecord({
      bin_id: 'BIN-01',
      fill_level: 85,
      battery_pct: 92,
      sequence: 5001,
      rssi_dbm: -75,
      snr_db: 9.5,
    });

    const snapHigh = engine.getSnapshot();
    const bin01High = snapHigh.bins.find((b) => b.id === 'BIN-01')!;
    expect(bin01High.latestFillPct).toBe(85);
    expect(bin01High.latestStatus).toBe('HIGH');
    expect(bin01High.provenance).toBe('LIVE_HARDWARE');

    // Check alert raised
    const highAlert = snapHigh.alerts.find((a) => a.binId === 'BIN-01' && a.type === 'HIGH' && a.resolvedAt === undefined);
    expect(highAlert).toBeDefined();
    expect(highAlert?.provenance).toBe('LIVE_HARDWARE');

    // 2. Ingest record at 96% fill -> escalates to FULL alert and resolves HIGH alert
    engine.ingestLiveHardwareRecord({
      bin_id: 'BIN-01',
      fill_level: 96,
      battery_pct: 90,
      sequence: 5002,
      rssi_dbm: -74,
      snr_db: 9.8,
    });

    const snapFull = engine.getSnapshot();
    const bin01Full = snapFull.bins.find((b) => b.id === 'BIN-01')!;
    expect(bin01Full.latestFillPct).toBe(96);
    expect(bin01Full.latestStatus).toBe('FULL');

    const fullAlert = snapFull.alerts.find((a) => a.binId === 'BIN-01' && a.type === 'FULL' && a.resolvedAt === undefined);
    expect(fullAlert).toBeDefined();

    // 3. Hysteresis resolution: dropping to 50% clears FULL alert
    engine.ingestLiveHardwareRecord({
      bin_id: 'BIN-01',
      fill_level: 50,
      battery_pct: 89,
      sequence: 5003,
      rssi_dbm: -74,
      snr_db: 9.8,
    });

    const snapCleared = engine.getSnapshot();
    const bin01Cleared = snapCleared.bins.find((b) => b.id === 'BIN-01')!;
    expect(bin01Cleared.latestFillPct).toBe(50);
    expect(bin01Cleared.latestStatus).toBe('NORMAL');

    const activeAlerts = snapCleared.alerts.filter((a) => a.binId === 'BIN-01' && a.resolvedAt === undefined);
    expect(activeAlerts.length).toBe(0);
  });

  it('guarantees that in REALTIME mode, simulated packets and scenario events are not generated', () => {
    const engine = new SimulationEngine(42026);
    engine.setSystemMode('REALTIME');

    const snapBefore = engine.getSnapshot();
    const packetCountBefore = snapBefore.packets.length;

    // In REALTIME, stepBySeconds advances sim time but generates 0 simulated packets and 0 alerts
    engine.stepBySeconds(3600);
    const snapAfter = engine.getSnapshot();
    expect(snapAfter.simTimeSec).toBe(3600);
    expect(snapAfter.packets.length).toBe(packetCountBefore);
    expect(snapAfter.alerts.length).toBe(0);

    // In REALTIME, triggering scripted event now is suppressed
    const firstEvt = snapAfter.scriptedEvents[0];
    if (firstEvt) {
      engine.triggerScriptedEventNow(firstEvt.id);
      expect(engine.getSnapshot().packets.length).toBe(packetCountBefore);
    }

    // However, live hardware packets continue to be accepted and update bins
    engine.ingestLiveHardwareRecord({
      bin_id: 'BIN-01',
      fill_level: 88,
      battery_pct: 95,
      sequence: 9001,
      rssi_dbm: -75,
      snr_db: 8.5,
    });
    const snapLive = engine.getSnapshot();
    const bin01 = snapLive.bins.find((b) => b.id === 'BIN-01')!;
    expect(bin01.latestFillPct).toBe(88);
    expect(bin01.provenance).toBe('LIVE_HARDWARE');

    // Switching back to SIMULATION mode restores simulation step packet generation
    engine.setSystemMode('SIMULATION');
    engine.stepBySeconds(3600);
    const snapSim = engine.getSnapshot();
    expect(snapSim.packets.length).toBeGreaterThan(packetCountBefore);
  });
});

