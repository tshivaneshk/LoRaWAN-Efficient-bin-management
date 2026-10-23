"""Pure business logic: validation, status classification, alert rules.
No web framework or database imports here, so it is easy to test."""
import math
import re
from datetime import datetime, timezone

STATUSES = ("NORMAL", "FILLING", "HIGH", "FULL")
PROVENANCES = ("LIVE_HARDWARE", "SIMULATED", "SIMULATED_DEMO")
BIN_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


class ValidationError(ValueError):
    pass


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(raw, key, lo, hi, required=False):
    v = raw.get(key)
    if v is None:
        if required:
            raise ValidationError(f"missing field: {key}")
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValidationError(f"{key} must be a number")
    if v < lo or v > hi:
        raise ValidationError(f"{key} out of range {lo}..{hi}: {v}")
    return v


def validate_record(raw: dict) -> dict:
    """Validate one telemetry record (gateway JSON shape). Returns a clean dict."""
    if not isinstance(raw, dict):
        raise ValidationError("record must be a JSON object")
    bin_id = raw.get("bin_id")
    if not isinstance(bin_id, str) or not BIN_ID_RE.match(bin_id):
        raise ValidationError("bin_id must be 1-32 chars of letters, digits, _ or -")
    fill = _num(raw, "fill_level", 0, 100, required=True)
    status = raw.get("status")
    if status is not None and status not in STATUSES:
        raise ValidationError(f"unknown status: {status!r}")
    seq = raw.get("sequence")
    if isinstance(seq, bool) or not isinstance(seq, int) or seq < 0:
        raise ValidationError("sequence must be a non-negative integer")
    battery = _num(raw, "battery_pct", 0, 100)
    rssi = _num(raw, "rssi_dbm", -170, 0)
    snr = _num(raw, "snr_db", -40, 40)
    prov = raw.get("provenance", "LIVE_HARDWARE")
    if prov not in ("LIVE_HARDWARE", "SIMULATED"):
        raise ValidationError("provenance must be LIVE_HARDWARE or SIMULATED")
    received_at = raw.get("received_at") or utcnow_iso()
    try:
        datetime.fromisoformat(str(received_at).replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError("received_at must be an ISO-8601 timestamp")
    return {
        "bin_id": bin_id, "fill_level": round(float(fill), 1), "reported_status": status,
        "battery_pct": battery, "sequence": seq, "rssi_dbm": rssi, "snr_db": snr,
        "provenance": prov, "received_at": str(received_at),
    }


def classify(fill: float, previous: str = "NORMAL") -> str:
    """Status with hysteresis (same rules as the simulator's alerts.ts).
    Raise HIGH at 80, FULL at 95. HIGH clears below 70, FULL drops below 85."""
    f = round(fill)
    if f >= 95:
        return "FULL"
    if previous == "FULL":
        if f >= 85:
            return "FULL"
        if f >= 70:
            return "HIGH"
        return "FILLING" if f >= 60 else "NORMAL"
    if f >= 80:
        return "HIGH"
    if previous == "HIGH":
        if f >= 70:
            return "HIGH"
        return "FILLING" if f >= 60 else "NORMAL"
    return "FILLING" if f >= 60 else "NORMAL"


def plan_alerts(new_status: str, active_types: set) -> tuple:
    """Return (types_to_raise, types_to_resolve). One alert per state change,
    never one per packet."""
    raise_, resolve = [], []
    if "OFFLINE" in active_types:
        resolve.append("OFFLINE")
    if new_status != "FULL" and "FULL" in active_types:
        resolve.append("FULL")
    if new_status not in ("HIGH", "FULL") and "HIGH" in active_types:
        resolve.append("HIGH")
    if new_status == "FULL" and "FULL" not in active_types:
        raise_.append("FULL")
    elif new_status == "HIGH" and "HIGH" not in active_types and "FULL" not in active_types:
        raise_.append("HIGH")
    return raise_, resolve


def alert_message(kind: str, bin_id: str, fill: float) -> str:
    if kind == "FULL":
        return f"{bin_id} is FULL ({fill:g}%). Collect now."
    if kind == "HIGH":
        return f"{bin_id} is HIGH ({fill:g}%). Plan a pickup soon."
    return f"{bin_id} has stopped reporting."
