/**
 * Format simulation seconds (where 0 = 06:00 AM) as HH:MM:SS or HH:MM
 */
export function formatSimClock(simTimeSec: number, includeSeconds = true): string {
  const totalSeconds = Math.floor(6 * 3600 + simTimeSec);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  if (!includeSeconds) {
    return `${hh}:${mm}`;
  }
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatRelativeAge(currentSimSec: number, lastSeenSimSec: number): string {
  const diffSec = Math.max(0, Math.round(currentSimSec - lastSeenSimSec));
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) {
    return `${mins} min ago`;
  }
  const hrs = (mins / 60).toFixed(1);
  return `${hrs} hr ago`;
}

export function stringToHexBytes(str: string): string {
  return Array.from(str)
    .map((ch) => ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}

export function isBinOffline(
  currentSimSec: number,
  lastSeenSimSec: number,
  expectedIntervalSec: number
): boolean {
  if (currentSimSec < 60) return false;
  return currentSimSec - lastSeenSimSec > expectedIntervalSec * 3.1;
}
