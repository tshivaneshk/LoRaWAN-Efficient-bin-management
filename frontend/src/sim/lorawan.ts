import { SF_DEMOD_FLOOR_DB } from './radioModel';
import { LoRaWANLogEntry } from './types';

/**
 * Section 6.6 LoRaWAN layer (simulated, optional)
 * Clearly labelled as simulation of concepts, not a certified stack:
 * - Join procedure (join-request, join-accept) when a node powers on
 * - Uplink frame counters and a replay rejection when counters regress
 * - Gateway diversity: a frame heard by two or three gateways is deduplicated at the network server,
 *   best SNR chosen, all receptions listed
 * - ADR: server tracks recent SNR margin and commands a lower SF or lower power to the node;
 *   the node's next uplink visibly changes SF
 * - Class A downlink windows after uplink (RX1 = 1000 ms, RX2 = 2000 ms)
 */

export interface AdrDecision {
  newSf: 7 | 8 | 9 | 10 | 11 | 12;
  newTxPowerDbm: number;
  commandText?: string;
}

export function evaluateLoRaWanAdr(params: {
  currentSf: 7 | 8 | 9 | 10 | 11 | 12;
  currentTxPowerDbm: number;
  bestSnrDb: number;
  maxEirpDbm: number;
}): AdrDecision {
  const { currentSf, currentTxPowerDbm, bestSnrDb } = params;
  const demodFloor = SF_DEMOD_FLOOR_DB[currentSf];
  const installationMarginDb = 10.0;
  const snrMarginDb = bestSnrDb - demodFloor - installationMarginDb;

  const sfs: Array<7 | 8 | 9 | 10 | 11 | 12> = [7, 8, 9, 10, 11, 12];
  let sfIdx = sfs.indexOf(currentSf);
  let newPower = currentTxPowerDbm;
  let commandText: string | undefined;

  // If margin is very high (> 4 dB), step down SF for shorter airtime
  if (snrMarginDb >= 4.0 && sfIdx > 0) {
    sfIdx -= 1;
    const nextSf = sfs[sfIdx];
    commandText = `LinkADRReq: DR${12 - nextSf} (SF${ currentSf } -> SF${nextSf}, margin +${snrMarginDb.toFixed(1)} dB)`;
    return { newSf: nextSf, newTxPowerDbm: newPower, commandText };
  }

  // If margin is negative (< -2.5 dB), step up SF to recover link reliability (e.g. during rain)
  if (snrMarginDb < -2.5 && sfIdx < sfs.length - 1) {
    sfIdx += 1;
    const nextSf = sfs[sfIdx];
    commandText = `ADR Backoff: DR${12 - nextSf} (SF${currentSf} -> SF${nextSf}, low SNR ${bestSnrDb.toFixed(1)} dB)`;
    return { newSf: nextSf, newTxPowerDbm: newPower, commandText };
  }

  return { newSf: currentSf, newTxPowerDbm: newPower };
}

export function deduplicateGatewayReceptions(
  receptions: Array<{ gatewayId: string; rssiDbm: number; snrDb: number; distanceM: number }>
): {
  bestReception: { gatewayId: string; rssiDbm: number; snrDb: number; distanceM: number } | null;
  deduplicatedCount: number;
} {
  if (receptions.length === 0) {
    return { bestReception: null, deduplicatedCount: 0 };
  }
  const sorted = [...receptions].sort((a, b) => b.snrDb - a.snrDb);
  return {
    bestReception: sorted[0],
    deduplicatedCount: Math.max(0, receptions.length - 1),
  };
}
