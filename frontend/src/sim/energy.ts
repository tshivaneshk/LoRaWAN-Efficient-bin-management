import { Bin, EnergyParams } from './types';
import { calculateLoRaAirtime } from './airtime';
import { getZoneHourProfile } from './binModel';

/**
 * Section 6.7 Energy and scheduling model
 * - Node states: SLEEP, WAKE, MEASURE, TX, RX.
 * - Energy is the integral of current over time. Report estimated mAh per day.
 * - Fixed schedule: measure and send every N minutes.
 * - Adaptive schedule: interval selected from time-of-day usage profile and current fill rate
 *   (short when rising fast or above 80%, long during low-use hours).
 */

export const DEFAULT_ENERGY_PARAMS: EnergyParams = {
  sleepCurrentMa: 0.05,
  wakeCurrentMa: 8.0,
  measureCurrentMa: 15.0,
  txCurrentMa: 95.0,
  rxCurrentMa: 12.0,
  wakeTimeMs: 120,
  measureTimeMs: 380,
  fixedIntervalMin: 10,
  batteryCapacityMah: 2400,
};

export function computeAdaptiveIntervalSec(params: {
  zoneId: string;
  hourOfDay: number;
  fillPct: number;
  eventMultiplier: number;
}): number {
  const { zoneId, hourOfDay, fillPct, eventMultiplier } = params;
  const profile = getZoneHourProfile(zoneId, hourOfDay) * eventMultiplier;

  // Urgent reporting when above 80% (HIGH / FULL)
  if (fillPct >= 80) {
    return 300; // 5 min
  }
  if (fillPct >= 60 || profile >= 2.0) {
    return 600; // 10 min
  }
  // Night low-use hours (00:00 - 06:00)
  const h = ((hourOfDay % 24) + 24) % 24;
  if (h >= 0 && h < 6) {
    return 3600; // 60 min stretch
  }
  return 1200; // 20 min normal daytime
}

export function computeSingleCycleEnergyMah(
  params: EnergyParams,
  airtimeMs: number,
  includeLoRaWanRxWindows: boolean
): number {
  const wakeAh = (params.wakeCurrentMa * (params.wakeTimeMs / 1000)) / 3600;
  const measureAh = (params.measureCurrentMa * (params.measureTimeMs / 1000)) / 3600;
  const txAh = (params.txCurrentMa * (airtimeMs / 1000)) / 3600;
  const rxWindowMs = includeLoRaWanRxWindows ? 160 : 0; // Class A RX1/RX2 check
  const rxAh = (params.rxCurrentMa * (rxWindowMs / 1000)) / 3600;
  return wakeAh + measureAh + txAh + rxAh;
}

export interface DailyEnergyComparison {
  fixedPacketsPerDay: number;
  adaptivePacketsPerDay: number;
  fixedMahPerDay: number;
  adaptiveMahPerDay: number;
  fixedBatteryDays: number;
  adaptiveBatteryDays: number;
  hourlyProfile: Array<{
    hour: number;
    timeLabel: string;
    fixedCurrentMeanMa: number;
    adaptiveCurrentMeanMa: number;
    fixedPackets: number;
    adaptivePackets: number;
  }>;
}

export function compareDailyEnergySchedules(
  params: EnergyParams,
  sf: 7 | 8 | 9 | 10 | 11 | 12 = 9,
  zoneId = 'market',
  includeLoRaWanRxWindows = false
): DailyEnergyComparison {
  const airtime = calculateLoRaAirtime({
    payloadBytes: 24,
    sf,
    bwKhz: 125,
    cr: 5,
  }).airtimeMs;

  const activeCycleMah = computeSingleCycleEnergyMah(params, airtime, includeLoRaWanRxWindows);
  const sleepMahPerHour = params.sleepCurrentMa * 1; // mA * 1h = mAh

  let fixedPacketsPerDay = 0;
  let adaptivePacketsPerDay = 0;
  let fixedMahPerDay = 0;
  let adaptiveMahPerDay = 0;

  const hourlyProfile: DailyEnergyComparison['hourlyProfile'] = [];
  let simulatedFill = 18;

  for (let i = 0; i < 24; i++) {
    const hour = (6 + i) % 24;
    const timeLabel = `${String(hour).padStart(2, '0')}:00`;
    const activity = getZoneHourProfile(zoneId, hour);
    simulatedFill = Math.min(95, simulatedFill + activity * 2.5);
    if (hour === 22) simulatedFill = 10; // collected

    const fixedPkts = 60 / Math.max(1, params.fixedIntervalMin);
    const adaptiveIntervalSec = computeAdaptiveIntervalSec({
      zoneId,
      hourOfDay: hour,
      fillPct: simulatedFill,
      eventMultiplier: 1.0,
    });
    const adaptivePkts = 3600 / adaptiveIntervalSec;

    const fixedHourMah = sleepMahPerHour + fixedPkts * activeCycleMah;
    const adaptiveHourMah = sleepMahPerHour + adaptivePkts * activeCycleMah;

    fixedPacketsPerDay += fixedPkts;
    adaptivePacketsPerDay += adaptivePkts;
    fixedMahPerDay += fixedHourMah;
    adaptiveMahPerDay += adaptiveHourMah;

    hourlyProfile.push({
      hour,
      timeLabel,
      fixedCurrentMeanMa: Number(fixedHourMah.toFixed(4)),
      adaptiveCurrentMeanMa: Number(adaptiveHourMah.toFixed(4)),
      fixedPackets: Math.round(fixedPkts),
      adaptivePackets: Number(adaptivePkts.toFixed(1)),
    });
  }

  return {
    fixedPacketsPerDay: Math.round(fixedPacketsPerDay),
    adaptivePacketsPerDay: Math.round(adaptivePacketsPerDay),
    fixedMahPerDay: Number(fixedMahPerDay.toFixed(3)),
    adaptiveMahPerDay: Number(adaptiveMahPerDay.toFixed(3)),
    fixedBatteryDays: Math.round(params.batteryCapacityMah / Math.max(0.001, fixedMahPerDay)),
    adaptiveBatteryDays: Math.round(params.batteryCapacityMah / Math.max(0.001, adaptiveMahPerDay)),
    hourlyProfile,
  };
}
