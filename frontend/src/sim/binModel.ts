import { SeededPRNG } from './prng';

/**
 * Section 6.1 Bin fill model
 * - Each bin has emptyDistanceCm (default 30 for mini bin; city bins configurable, e.g. 90),
 *   a zone, and a baseRate (percent per hour).
 * - Fill rate = baseRate * zoneHourProfile(hour) * eventMultiplier
 * - Stochastic "dump events": Poisson arrivals, each adds a random step of 1 to 6 percent.
 * - Collection sets fill to a random 2 to 6 percent.
 */
export function getZoneHourProfile(zoneId: string, hourOfDay: number): number {
  const h = ((hourOfDay % 24) + 24) % 24;

  // Low activity overnight (00:00 - 05:59)
  if (h >= 0 && h < 6) {
    return 0.15;
  }

  switch (zoneId) {
    case 'terminal': // Commuter peaks 07:30-09:30 and 17:00-19:00
      if (h >= 7 && h < 10) return 2.8;
      if (h >= 17 && h < 19.5) return 2.4;
      return 1.0;

    case 'market': // Lunch peak 11:30-14:30 and afternoon shopping
      if (h >= 11.5 && h < 14.5) return 3.4;
      if (h >= 14.5 && h < 19) return 1.8;
      return 0.8;

    case 'campus': // Daytime classes 09:00-17:00
      if (h >= 9 && h < 17) return 1.9;
      if (h >= 17 && h < 21) return 1.1;
      return 0.4;

    case 'stadium': // Event builds up 15:00-18:30
      if (h >= 15 && h < 18.5) return 3.8;
      return 0.5;

    case 'hospital': // Steady 24/7 with daytime elevation
      if (h >= 8 && h < 20) return 1.4;
      return 0.85;

    case 'park': // Morning joggers + afternoon leisure
      if (h >= 6.5 && h < 9) return 1.5;
      if (h >= 15 && h < 19) return 1.8;
      return 0.5;

    case 'residential':
    default: // Morning & evening disposal
      if (h >= 7 && h < 9.5) return 1.6;
      if (h >= 18.5 && h < 21.5) return 1.9;
      return 0.7;
  }
}

export function stepBinTrueFill(params: {
  currentFillPct: number;
  baseRatePctPerHr: number;
  zoneId: string;
  hourOfDay: number;
  eventMultiplier: number;
  dtSec: number;
  prng: SeededPRNG;
}): number {
  const { currentFillPct, baseRatePctPerHr, zoneId, hourOfDay, eventMultiplier, dtSec, prng } = params;
  const profile = getZoneHourProfile(zoneId, hourOfDay);
  const effectiveRatePerHr = baseRatePctPerHr * profile * eventMultiplier;

  const continuousIncrement = (effectiveRatePerHr * dtSec) / 3600;

  // Stochastic dump events: Poisson arrival rate proportional to activity
  // Mean arrival lambda per hour ~ 0.35 * profile * eventMultiplier
  const lambdaPerSec = (0.35 * profile * eventMultiplier) / 3600;
  const dumpProb = 1 - Math.exp(-lambdaPerSec * dtSec);
  let dumpStep = 0;
  if (prng.next() < dumpProb) {
    dumpStep = prng.range(1, 6);
  }

  return Math.min(100, Math.max(0, currentFillPct + continuousIncrement + dumpStep));
}

export function collectBinFill(prng: SeededPRNG): number {
  return Number(prng.range(2, 6).toFixed(1));
}
