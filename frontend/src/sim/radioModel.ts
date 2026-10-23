import { REGION_PRESETS } from '../data/regions';
import { SeededPRNG } from './prng';
import { RegionCode, WeatherCondition } from './types';

/**
 * Section 6.5 Radio model
 * - Path loss (log-distance): PL(d) = PL0 + 10 * n * log10(d / d0) + X_sigma
 *   with d0 = 1 m, PL0 ~ 32 dB (adjusted per region freq), n per zone (open 2.7, urban 3.2, dense 3.8),
 *   X_sigma Gaussian shadowing (sigma 4..8 dB), static per link + small fast-fading term per packet.
 * - Rain / weather: extra attenuation (1..3 dB at rain/storm) and raise noise floor slightly.
 * - RSSI = TxPower + Gtx + Grx - PL
 * - Noise floor = -174 + 10*log10(BW) + NF (NF ~ 6 dB)
 * - SNR = RSSI - noise floor
 * - Receiver sensitivity by SF at 125 kHz:
 *   SF7 -123, SF8 -126, SF9 -129, SF10 -132, SF11 -134.5, SF12 -137 dBm
 * - Demod SNR floor:
 *   SF7 -7.5, SF8 -10, SF9 -12.5, SF10 -15, SF11 -17.5, SF12 -20 dB
 */

export const SF_SENSITIVITY_DBM: Record<7 | 8 | 9 | 10 | 11 | 12, number> = {
  7: -123,
  8: -126,
  9: -129,
  10: -132,
  11: -134.5,
  12: -137,
};

export const SF_DEMOD_FLOOR_DB: Record<7 | 8 | 9 | 10 | 11 | 12, number> = {
  7: -7.5,
  8: -10.0,
  9: -12.5,
  10: -15.0,
  11: -17.5,
  12: -20.0,
};

export function getZonePathLossExponent(zoneId: string): number {
  switch (zoneId) {
    case 'park':
    case 'stadium':
      return 2.7; // Open
    case 'market':
    case 'hospital':
      return 3.5; // Dense urban / indoor-adjacent
    case 'campus':
    case 'terminal':
    case 'residential':
    default:
      return 3.15; // Urban
  }
}

export function mapDistanceToMeters(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  // Map canvas is 1000 x 700 units representing ~2.0 km x 1.4 km (1 unit = 2 meters)
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const distUnits = Math.sqrt(dx * dx + dy * dy);
  return Math.max(5, distUnits * 2.0);
}

export function computeNoiseFloorDbm(bwKhz: number, weather: WeatherCondition): number {
  const bwHz = bwKhz * 1000;
  const nfDb = 6.0;
  const weatherNoiseRise = weather === 'STORM' ? 1.5 : weather === 'RAIN' ? 0.8 : 0;
  return -174 + 10 * Math.log10(bwHz) + nfDb + weatherNoiseRise;
}

export function computeLinkBudget(params: {
  distanceM: number;
  txPowerDbm: number;
  pathLossExponent: number;
  staticShadowingDb: number;
  fastFadingDb: number;
  region: RegionCode;
  weather: WeatherCondition;
  bwKhz: 125 | 250 | 500;
  sf: 7 | 8 | 9 | 10 | 11 | 12;
}): {
  pathLossDb: number;
  rssiDbm: number;
  noiseFloorDbm: number;
  snrDb: number;
  isReceived: boolean;
} {
  const {
    distanceM,
    txPowerDbm,
    pathLossExponent,
    staticShadowingDb,
    fastFadingDb,
    region,
    weather,
    bwKhz,
    sf,
  } = params;

  const preset = REGION_PRESETS[region];
  const pl0 = preset.pl0DbAt1m;
  const d = Math.max(1, distanceM);

  const weatherAttenuationDb =
    weather === 'STORM' ? 3.2 : weather === 'RAIN' ? 1.8 : 0;

  const pathLossDb =
    pl0 +
    10 * pathLossExponent * Math.log10(d) +
    staticShadowingDb +
    fastFadingDb +
    weatherAttenuationDb;

  const gTx = 2.0; // 2 dBi whip antenna
  const gRx = 3.0; // 3 dBi gateway collinear antenna
  const rssiDbm = Number((txPowerDbm + gTx + gRx - pathLossDb).toFixed(1));

  const noiseFloorDbm = computeNoiseFloorDbm(bwKhz, weather);
  const snrDb = Number((rssiDbm - noiseFloorDbm).toFixed(1));

  const sensThreshold = SF_SENSITIVITY_DBM[sf];
  const snrThreshold = SF_DEMOD_FLOOR_DB[sf];

  const isReceived = rssiDbm >= sensThreshold && snrDb >= snrThreshold;

  return {
    pathLossDb: Number(pathLossDb.toFixed(1)),
    rssiDbm,
    noiseFloorDbm: Number(noiseFloorDbm.toFixed(1)),
    snrDb,
    isReceived,
  };
}

/**
 * Capture effect collision resolution (Section 6.5):
 * Two packets overlapping in time on the same channel and SF collide;
 * the stronger one survives only if its power exceeds the other by at least 6 dB;
 * otherwise both are lost.
 */
export function resolveCaptureEffect(rssiADbm: number, rssiBDbm: number): 'A' | 'B' | 'BOTH_LOST' {
  const diff = rssiADbm - rssiBDbm;
  if (diff >= 6.0) return 'A';
  if (diff <= -6.0) return 'B';
  return 'BOTH_LOST';
}

export function generateFastFading(prng: SeededPRNG): number {
  return prng.gaussian(0, 0.9);
}
