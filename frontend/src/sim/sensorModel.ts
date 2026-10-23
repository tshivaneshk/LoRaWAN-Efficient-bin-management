import { SeededPRNG } from './prng';
import { SensorFaultType } from './types';

/**
 * Section 6.2 Ultrasonic sensor model (HC-SR04)
 * - True distance d = emptyDistanceCm * (1 - fill/100), floor at 2 cm (sensor blind zone).
 * - Echo time t = 2d / v, with v = 331.3 + 0.606 * T m/s using simulated ambient temperature T.
 * - Take 5 samples per cycle with Gaussian noise (sigma 0.3 cm), occasional outlier spikes (2% chance),
 *   and timeout readings (return 0).
 * - Apply median of 5, then compute fill = clamp((empty - d) / empty * 100, 0, 100).
 * - Plausibility checks: reject/flag if d < 2 for more than N cycles with a rapid jump from previous value
 *   (blocked sensor), flag suspect=true.
 */

export interface SensorMeasurementResult {
  trueDistanceCm: number;
  samplesCm: number[];
  medianDistanceCm: number;
  echoTimeUs: number;
  speedOfSoundMs: number;
  measuredFillPct: number;
  suspect: boolean;
  consecutiveLowDistanceCount: number;
  rejectedOutliersCount: number;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function measureUltrasonicSensor(params: {
  trueFillPct: number;
  emptyDistanceCm: number;
  ambientTempC: number;
  fault: SensorFaultType;
  previousMeasuredFillPct: number;
  previousLowDistCount: number;
  prng: SeededPRNG;
}): SensorMeasurementResult {
  const {
    trueFillPct,
    emptyDistanceCm,
    ambientTempC,
    fault,
    previousMeasuredFillPct,
    previousLowDistCount,
    prng,
  } = params;

  // True physical distance in cm, floored at 2.0 cm (HC-SR04 blind zone)
  const rawTrueDist = emptyDistanceCm * (1 - clamp(trueFillPct, 0, 100) / 100);
  const trueDistanceCm = Math.max(2.0, rawTrueDist);

  // Speed of sound v = 331.3 + 0.606 * T (m/s)
  const speedOfSoundMs = 331.3 + 0.606 * ambientTempC;

  const samplesCm: number[] = [];
  let rejectedOutliersCount = 0;

  for (let i = 0; i < 5; i++) {
    if (fault === 'BLOCKED') {
      // Blocked sensor (spiderweb/debris on transducer): reads ~1.0 cm (< 2 cm blind zone)
      const blockedSample = clamp(1.0 + prng.gaussian(0, 0.08), 0.8, 1.5);
      samplesCm.push(Number(blockedSample.toFixed(2)));
      continue;
    }

    if (fault === 'STUCK') {
      // Stuck reading at previous value
      const stuckDist = emptyDistanceCm * (1 - previousMeasuredFillPct / 100);
      samplesCm.push(Number(Math.max(2, stuckDist).toFixed(2)));
      continue;
    }

    if (fault === 'SPIKE' && i < 2) {
      samplesCm.push(1.2);
      rejectedOutliersCount++;
      continue;
    }

    const r = prng.next();
    if (r < 0.008) {
      // Occasional timeout reading (0 cm)
      samplesCm.push(0);
      rejectedOutliersCount++;
    } else if (r < 0.028) {
      // Occasional 2% outlier spike
      const spike = clamp(trueDistanceCm + (prng.next() < 0.5 ? -12 : 18), 1.0, emptyDistanceCm * 1.3);
      samplesCm.push(Number(spike.toFixed(2)));
      rejectedOutliersCount++;
    } else {
      const driftOffset = fault === 'DRIFT' ? -4.5 : 0;
      const noisy = Math.max(1.5, trueDistanceCm + driftOffset + prng.gaussian(0, 0.3));
      samplesCm.push(Number(noisy.toFixed(2)));
    }
  }

  // Filter out 0 (timeout) if valid samples exist before taking median, or median of 5 directly
  const validNonTimeout = samplesCm.filter((s) => s > 0);
  const medianDistanceCm = Number(
    (validNonTimeout.length > 0 ? computeMedian(validNonTimeout) : computeMedian(samplesCm)).toFixed(2)
  );

  // Echo time in microseconds: t = 2 * d / v
  // d is in cm (0.01 m), so t_sec = 2 * (d * 0.01) / v -> t_us = 2 * d * 10000 / v
  const echoTimeUs = Math.round((2 * medianDistanceCm * 10000) / speedOfSoundMs);

  // Compute fill percentage from median distance
  const rawFill = ((emptyDistanceCm - medianDistanceCm) / emptyDistanceCm) * 100;
  const measuredFillPct = Math.round(clamp(rawFill, 0, 100));

  // Plausibility check: d < 2 cm or sudden unphysical jump (> 35% in one cycle to >=95%)
  const isBelowBlindZone = medianDistanceCm < 2.0;
  const consecutiveLowDistanceCount = isBelowBlindZone ? previousLowDistCount + 1 : 0;
  const rapidJump = measuredFillPct - previousMeasuredFillPct >= 35 && measuredFillPct >= 95;

  const suspect =
    fault === 'BLOCKED' ||
    (isBelowBlindZone && (consecutiveLowDistanceCount >= 1 || rapidJump));

  return {
    trueDistanceCm: Number(trueDistanceCm.toFixed(2)),
    samplesCm,
    medianDistanceCm,
    echoTimeUs,
    speedOfSoundMs: Number(speedOfSoundMs.toFixed(2)),
    measuredFillPct,
    suspect,
    consecutiveLowDistanceCount,
    rejectedOutliersCount,
  };
}
