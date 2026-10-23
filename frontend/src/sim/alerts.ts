import { Alert, BinStatus, Provenance } from './types';

/**
 * Section 6.3 Status classification and alert logic
 * - 0 to 59 NORMAL, 60 to 79 FILLING, 80 to 94 HIGH, 95 to 100 FULL.
 * - Alert raise at 80 (HIGH) and 95 (FULL).
 * - Hysteresis: HIGH resolves below 70, FULL downgrades below 85.
 *   Do not create a new alert per packet; one alert per state transition.
 */
export function classifyBinStatusWithHysteresis(
  fillPct: number,
  previousStatus: BinStatus
): BinStatus {
  const f = Math.round(fillPct);

  // Upward transitions
  if (f >= 95) return 'FULL';
  if (previousStatus === 'FULL') {
    // Hysteresis: FULL stays FULL until fill drops below 85
    if (f >= 85) return 'FULL';
    if (f >= 70) return 'HIGH';
    if (f >= 60) return 'FILLING';
    return 'NORMAL';
  }

  if (f >= 80) return 'HIGH';
  if (previousStatus === 'HIGH') {
    // Hysteresis: HIGH stays HIGH until fill drops below 70
    if (f >= 70) return 'HIGH';
    if (f >= 60) return 'FILLING';
    return 'NORMAL';
  }

  if (f >= 60) return 'FILLING';
  return 'NORMAL';
}

export function evaluateBinAlerts(params: {
  binId: string;
  binName: string;
  newStatus: BinStatus;
  previousStatus: BinStatus;
  fillPct: number;
  suspectSensor: boolean;
  simTimeSec: number;
  provenance: Provenance;
  existingAlerts: Alert[];
}): { updatedAlerts: Alert[]; newAlerts: Alert[] } {
  const {
    binId,
    binName,
    newStatus,
    fillPct,
    suspectSensor,
    simTimeSec,
    provenance,
    existingAlerts,
  } = params;

  const newAlerts: Alert[] = [];
  const updatedAlerts = existingAlerts.map((a) => ({ ...a }));

  // Check active unresolved alerts for this bin
  const activeHigh = updatedAlerts.find(
    (a) => a.binId === binId && a.type === 'HIGH' && a.resolvedAt === undefined
  );
  const activeFull = updatedAlerts.find(
    (a) =>
      a.binId === binId &&
      (a.type === 'FULL' || a.type === 'SENSOR_SUSPECT') &&
      a.resolvedAt === undefined
  );
  const activeOffline = updatedAlerts.find(
    (a) => a.binId === binId && a.type === 'OFFLINE' && a.resolvedAt === undefined
  );

  // Packet arrived, so resolve any OFFLINE alert
  if (activeOffline) {
    activeOffline.resolvedAt = simTimeSec;
  }

  // Resolution via hysteresis
  if (newStatus !== 'FULL' && activeFull) {
    activeFull.resolvedAt = simTimeSec;
  }
  if (newStatus !== 'HIGH' && newStatus !== 'FULL' && activeHigh) {
    activeHigh.resolvedAt = simTimeSec;
  }

  // Raise new alert only on transition if not already active
  if (newStatus === 'FULL' && !activeFull) {
    const alertType = suspectSensor ? 'SENSOR_SUSPECT' : 'FULL';
    const msg = suspectSensor
      ? `${binId} (${binName}) reported ${fillPct}% FULL — suspect sensor (<2 cm blind-zone rapid jump)`
      : `${binId} (${binName}) reached FULL capacity (${fillPct}%)`;
    const alert: Alert = {
      id: `ALT-${binId}-${simTimeSec}-${Math.random().toString(36).slice(2, 6)}`,
      binId,
      type: alertType,
      message: msg,
      createdAt: simTimeSec,
      provenance,
    };
    updatedAlerts.unshift(alert);
    newAlerts.push(alert);
  } else if (newStatus === 'HIGH' && !activeHigh && !activeFull) {
    const alert: Alert = {
      id: `ALT-${binId}-${simTimeSec}-${Math.random().toString(36).slice(2, 6)}`,
      binId,
      type: 'HIGH',
      message: `${binId} (${binName}) crossed HIGH threshold (${fillPct}%)`,
      createdAt: simTimeSec,
      provenance,
    };
    updatedAlerts.unshift(alert);
    newAlerts.push(alert);
  }

  return { updatedAlerts, newAlerts };
}
