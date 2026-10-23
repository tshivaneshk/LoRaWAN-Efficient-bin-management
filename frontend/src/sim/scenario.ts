import { Bin, Gateway, ScriptedScenarioEvent, Truck } from './types';
import { getZonePathLossExponent } from './radioModel';
import { SeededPRNG } from './prng';

/**
 * Scenario: "A Day in Northgate"
 * 24 bins, 3 gateways, 2 collection trucks, 1 control room.
 * Clock runs 06:00 (simTimeSec = 0) to 06:00 next day (simTimeSec = 86400).
 */

export const INITIAL_GATEWAYS: Gateway[] = [
  {
    id: 'GW-01',
    name: 'Northgate Central Tower (Control HQ)',
    position: { x: 485, y: 340 },
    online: true,
    rxCount: 0,
    airtimeUtilisation: 0,
    meanRssiDbm: -88,
    meanSnrDb: 7.5,
  },
  {
    id: 'GW-02',
    name: 'East Stadium & Market Mast',
    position: { x: 775, y: 275 },
    online: true,
    rxCount: 0,
    airtimeUtilisation: 0,
    meanRssiDbm: -91,
    meanSnrDb: 6.2,
  },
  {
    id: 'GW-03',
    name: 'West Campus & Terminal Rooftop',
    position: { x: 225, y: 410 },
    online: true,
    rxCount: 0,
    airtimeUtilisation: 0,
    meanRssiDbm: -89,
    meanSnrDb: 6.8,
  },
];

export const INITIAL_TRUCKS: Truck[] = [
  {
    id: 'TRK-01',
    name: 'Compactor Alpha-1',
    position: { x: 470, y: 360 },
    status: 'IDLE',
    assignedBinIds: [],
    routePoints: [],
    loadPct: 12,
    collectedToday: 0,
  },
  {
    id: 'TRK-02',
    name: 'Compactor Bravo-2',
    position: { x: 240, y: 430 },
    status: 'IDLE',
    assignedBinIds: [],
    routePoints: [],
    loadPct: 8,
    collectedToday: 0,
  },
];

const BIN_DEFINITIONS: Array<{
  id: string;
  name: string;
  zoneId: string;
  x: number;
  y: number;
  baseRate: number;
  emptyDistanceCm: number;
  initialFill: number;
}> = [
  // Bus Terminal (4 bins)
  { id: 'BIN-01', name: 'Terminal Concourse A', zoneId: 'terminal', x: 185, y: 465, baseRate: 5.2, emptyDistanceCm: 90, initialFill: 18 },
  { id: 'BIN-02', name: 'Terminal Bay 4 North', zoneId: 'terminal', x: 215, y: 490, baseRate: 4.8, emptyDistanceCm: 90, initialFill: 22 },
  { id: 'BIN-03', name: 'Terminal Ticket Plaza', zoneId: 'terminal', x: 245, y: 460, baseRate: 5.5, emptyDistanceCm: 90, initialFill: 25 },
  { id: 'BIN-04', name: 'Metro Feeder Exit', zoneId: 'terminal', x: 170, y: 515, baseRate: 4.2, emptyDistanceCm: 90, initialFill: 15 },

  // Market Street (5 bins)
  { id: 'BIN-05', name: 'Market Arcade West', zoneId: 'market', x: 540, y: 260, baseRate: 6.0, emptyDistanceCm: 90, initialFill: 24 },
  { id: 'BIN-06', name: 'Spice Court Central', zoneId: 'market', x: 585, y: 245, baseRate: 6.5, emptyDistanceCm: 90, initialFill: 28 },
  { id: 'BIN-07', name: 'Produce Hall South (Prototype Mini)', zoneId: 'market', x: 620, y: 280, baseRate: 5.8, emptyDistanceCm: 30, initialFill: 26 },
  { id: 'BIN-08', name: 'Butcher Row Corner', zoneId: 'market', x: 655, y: 255, baseRate: 6.2, emptyDistanceCm: 90, initialFill: 29 },
  { id: 'BIN-09', name: 'Market Clocktower', zoneId: 'market', x: 565, y: 295, baseRate: 5.4, emptyDistanceCm: 90, initialFill: 21 },

  // University Campus (4 bins)
  { id: 'BIN-10', name: 'Engineering Quad', zoneId: 'campus', x: 195, y: 215, baseRate: 3.8, emptyDistanceCm: 90, initialFill: 14 },
  { id: 'BIN-11', name: 'Student Union Steps', zoneId: 'campus', x: 255, y: 195, baseRate: 4.6, emptyDistanceCm: 90, initialFill: 19 },
  { id: 'BIN-12', name: 'Science Library Plaza', zoneId: 'campus', x: 300, y: 235, baseRate: 3.4, emptyDistanceCm: 90, initialFill: 12 },
  { id: 'BIN-13', name: 'Dormitory Walk West', zoneId: 'campus', x: 155, y: 265, baseRate: 3.9, emptyDistanceCm: 90, initialFill: 16 },

  // Stadium (4 bins)
  { id: 'BIN-14', name: 'Arena Gate A Turnstiles', zoneId: 'stadium', x: 780, y: 175, baseRate: 4.5, emptyDistanceCm: 90, initialFill: 20 },
  { id: 'BIN-15', name: 'Arena South Concourse', zoneId: 'stadium', x: 825, y: 220, baseRate: 4.9, emptyDistanceCm: 90, initialFill: 23 },
  { id: 'BIN-16', name: 'Supporters Fan Plaza', zoneId: 'stadium', x: 860, y: 185, baseRate: 5.1, emptyDistanceCm: 90, initialFill: 25 },
  { id: 'BIN-17', name: 'Stadium VIP Coach Park', zoneId: 'stadium', x: 750, y: 225, baseRate: 4.0, emptyDistanceCm: 90, initialFill: 17 },

  // Hospital (2 bins)
  { id: 'BIN-18', name: 'St. Jude Triage Entrance', zoneId: 'hospital', x: 415, y: 175, baseRate: 4.1, emptyDistanceCm: 90, initialFill: 27 },
  { id: 'BIN-19', name: 'Outpatient Pharmacy Court', zoneId: 'hospital', x: 465, y: 195, baseRate: 3.7, emptyDistanceCm: 90, initialFill: 22 },

  // Park (2 bins)
  { id: 'BIN-20', name: 'Northgate Botanical Walk', zoneId: 'park', x: 440, y: 510, baseRate: 2.9, emptyDistanceCm: 90, initialFill: 11 },
  { id: 'BIN-21', name: 'Lakefront Pavilion', zoneId: 'park', x: 525, y: 545, baseRate: 3.2, emptyDistanceCm: 90, initialFill: 14 },

  // Residential (3 bins)
  { id: 'BIN-22', name: 'Elm Terrace Block C', zoneId: 'residential', x: 725, y: 455, baseRate: 3.5, emptyDistanceCm: 90, initialFill: 19 },
  { id: 'BIN-23', name: 'Oakwood Crescent North', zoneId: 'residential', x: 795, y: 495, baseRate: 3.3, emptyDistanceCm: 90, initialFill: 16 },
  { id: 'BIN-24', name: 'Maple Court Recycling Point', zoneId: 'residential', x: 855, y: 440, baseRate: 3.6, emptyDistanceCm: 90, initialFill: 18 },
];

export function createInitialBins(prng: SeededPRNG): Bin[] {
  return BIN_DEFINITIONS.map((def, idx) => {
    const shadowingDb: Record<string, number> = {};
    for (const gw of INITIAL_GATEWAYS) {
      shadowingDb[gw.id] = Number(prng.gaussian(0, 4.8).toFixed(2));
    }

    // Stagger initial transmit times in the first 10 minutes
    const initialNextTx = 25 + idx * 18 + prng.intRange(0, 12);
    const trueDistanceCm = Number((def.emptyDistanceCm * (1 - def.initialFill / 100)).toFixed(2));

    return {
      id: def.id,
      name: def.name,
      zoneId: def.zoneId,
      position: { x: def.x, y: def.y },
      emptyDistanceCm: def.emptyDistanceCm,
      trueFillPct: def.initialFill,
      latestFillPct: def.initialFill,
      latestStatus: 'NORMAL',
      batteryPct: Number((98 - (idx % 7) * 1.4).toFixed(1)),
      lastSeenSimTime: 0,
      suspectSensor: false,
      provenance: 'SIMULATED',
      baseRate: def.baseRate,
      sequence: 1000 + idx * 10,
      expectedIntervalSec: 600,
      nextTxSimTime: initialNextTx,
      sf: idx % 5 === 0 ? 9 : idx % 3 === 0 ? 8 : 7,
      txPowerDbm: 14,
      pathLossExponent: getZonePathLossExponent(def.zoneId),
      shadowingDb,
      sensorFault: 'NONE',
      consecutiveLowDistanceCount: 0,
      lastSamplesCm: [
        trueDistanceCm - 0.2,
        trueDistanceCm + 0.1,
        trueDistanceCm,
        trueDistanceCm + 0.3,
        trueDistanceCm - 0.1,
      ],
      lastMedianCm: trueDistanceCm,
      lastEchoTimeUs: Math.round((2 * trueDistanceCm * 10000) / 344.6),
      lastTempC: 22.0,
      packetsSent: 1,
      packetsDelivered: 1,
      dutyCycleUsedSecInHour: 0,
      energyMahFixedToday: 0.02,
      energyMahAdaptiveToday: 0.015,
      lorawanJoined: true,
      lorawanDevAddr: `26011A${String(idx + 1).padStart(2, '0')}`,
      lorawanFCntUp: 1,
      lorawanFCntDown: 0,
      lastGatewayId: idx < 4 || (idx >= 9 && idx <= 12) ? 'GW-03' : idx >= 13 || idx >= 21 ? 'GW-02' : 'GW-01',
      lastRssiDbm: -86 - (idx % 12),
      lastSnrDb: 8.5 - (idx % 6) * 1.2,
    };
  });
}

/**
 * Scripted event timeline (Section 1):
 * Sim time starts at 06:00 (0 sec):
 * - 06:00 (0s): Quiet start, all bins low
 * - 08:00 (7200s): Commuter rush at bus terminal
 * - 12:30 (23400s): Market lunch spike
 * - 15:00 (32400s): Sensor fault on one bin (blocked sensor, reads 1 cm)
 * - 17:00 (39600s): Stadium event ends
 * - 19:00 (46800s): Gateway 2 loses power
 * - 21:00 (54000s): Heavy rain
 * - 22:30 (59400s): Truck 1 collects stadium bins
 * - 02:00 (72000s): Night low-use
 */
export function createScriptedEvents(): ScriptedScenarioEvent[] {
  return [
    {
      id: 'EVT-0600',
      simTimeSec: 0,
      timeLabel: '06:00',
      title: 'Quiet Start (Baseline)',
      description: 'All 24 district bins start low across Northgate. Sparse LoRa telemetry with long sleep intervals.',
      demonstrates: 'Baseline link budget, sparse traffic, long sleep intervals',
      enabled: true,
      triggered: true,
      actionType: 'QUIET_START',
    },
    {
      id: 'EVT-0800',
      simTimeSec: 2 * 3600, // 08:00
      timeLabel: '08:00',
      title: 'Commuter Rush at Bus Terminal',
      description: 'Morning transit surge drives rapid disposal across BIN-01 to BIN-04.',
      demonstrates: 'Fill-rate ramp, adaptive reporting interval tightening',
      enabled: true,
      triggered: false,
      actionType: 'COMMUTER_RUSH',
    },
    {
      id: 'EVT-1230',
      simTimeSec: 6.5 * 3600, // 12:30
      timeLabel: '12:30',
      title: 'Market Street Lunch Spike',
      description: 'Food stalls and lunch crowds push BIN-05 through BIN-09 past 80% HIGH within minutes.',
      demonstrates: 'Multiple bins crossing HIGH within minutes, burst radio traffic',
      enabled: true,
      triggered: false,
      actionType: 'MARKET_SPIKE',
    },
    {
      id: 'EVT-1500',
      simTimeSec: 9 * 3600, // 15:00
      timeLabel: '15:00',
      title: 'Sensor Obstruction on BIN-07',
      description: 'Debris blocks HC-SR04 transducer on BIN-07 (Market Prototype Mini), reading ~1.0 cm in blind zone.',
      demonstrates: 'False FULL reading, <2 cm blind-zone validation & suspect telemetry flag',
      enabled: true,
      triggered: false,
      actionType: 'SENSOR_FAULT_BIN07',
    },
    {
      id: 'EVT-1700',
      simTimeSec: 11 * 3600, // 17:00
      timeLabel: '17:00',
      title: 'Stadium Event Ends',
      description: '25,000 spectators exit Northgate Arena; BIN-14 to BIN-17 surge to FULL.',
      demonstrates: 'Overflow cluster, FULL alerts, collection dispatch priority',
      enabled: true,
      triggered: false,
      actionType: 'STADIUM_OVERFLOW',
    },
    {
      id: 'EVT-1900',
      simTimeSec: 13 * 3600, // 19:00
      timeLabel: '19:00',
      title: 'Gateway 2 Loses Power',
      description: 'GW-02 (East Stadium & Market Mast) goes offline due to feeder breaker trip.',
      demonstrates: 'Coverage hole, last-seen ageing & OFFLINE detection vs LoRaWAN gateway diversity',
      enabled: true,
      triggered: false,
      actionType: 'GATEWAY2_POWER_LOSS',
    },
    {
      id: 'EVT-2100',
      simTimeSec: 15 * 3600, // 21:00
      timeLabel: '21:00',
      title: 'Heavy Rain Front',
      description: 'Storm cell passes over Northgate adding path loss and raising noise floor.',
      demonstrates: 'Extra path loss, SNR drop, ADR spreading factor increase, longer airtime & collisions',
      enabled: true,
      triggered: false,
      actionType: 'HEAVY_RAIN',
    },
    {
      id: 'EVT-2230',
      simTimeSec: 16.5 * 3600, // 22:30
      timeLabel: '22:30',
      title: 'Truck 1 Collects Stadium & Market Bins',
      description: 'Compactor Alpha-1 services overflow cluster; bins empty to 2-6%.',
      demonstrates: 'Fill resets, automatic alert resolution via hysteresis (<85% and <70%)',
      enabled: true,
      triggered: false,
      actionType: 'TRUCK1_STADIUM_COLLECT',
    },
    {
      id: 'EVT-0200',
      simTimeSec: 20 * 3600, // 02:00
      timeLabel: '02:00',
      title: 'Night Low-Use Period',
      description: 'District quiet hours; adaptive scheduler stretches reporting intervals to 60 min.',
      demonstrates: 'Sleep scheduler stretches intervals, mAh savings in Energy Lab',
      enabled: true,
      triggered: false,
      actionType: 'NIGHT_LOW_USE',
    },
  ];
}
