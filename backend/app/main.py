"""FastAPI app for Northgate Smart Bin system.

Provides:
- Ingestion of live hardware and simulated packets
- Monotonic replay-protected AES-128-CCM secure telemetry endpoint
- Global system Mode (SIMULATION vs REALTIME)
- SQLite storage with at-rest field encryption
- Real-time WebSocket broadcasting (/live)
- Static operator Alert Console (/console)
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from contextlib import asynccontextmanager

from fastapi import Body, Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import aes_ccm
from . import logic
from .db import Store
from .keytool import get_key_from_env_or_file

DB_PATH = os.getenv("DB_PATH", "data/northgate.db")
API_KEY = os.getenv("API_KEY", "")                      # empty = no key required (dev only)
ENABLE_DEMO = os.getenv("ENABLE_DEMO", "1") == "1"      # set 0 in production
OFFLINE_AFTER_S = int(os.getenv("OFFLINE_AFTER_S", "900"))
ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
ENFORCE_ENCRYPTION = os.getenv("ENFORCE_ENCRYPTION", "1") == "1"
WS_ENCRYPT = os.getenv("WS_ENCRYPT", "0") == "1"

if DB_PATH != ":memory:":
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
store = Store(DB_PATH)
clients: set = set()

# Initialize keys
TRANSPORT_KEY = get_key_from_env_or_file("TRANSPORT_KEY", "TRANSPORT_KEY")


async def broadcast(msg: dict):
    dead = []
    for ws in list(clients):
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def offline_watcher():
    while True:
        await asyncio.sleep(60)
        for a in await run_in_threadpool(store.mark_offline, OFFLINE_AFTER_S):
            await broadcast({"type": "alert", **a})


async def heartbeat():
    """Send ping every 15s to keep connections alive and drop dead sockets immediately."""
    while True:
        await asyncio.sleep(15)
        dead = []
        for ws in list(clients):
            try:
                await ws.send_json({"type": "ping"})
            except Exception:
                dead.append(ws)
        for ws in dead:
            clients.discard(ws)


@asynccontextmanager
async def lifespan(_app):
    offline_task = asyncio.create_task(offline_watcher())
    heartbeat_task = asyncio.create_task(heartbeat())
    yield
    offline_task.cancel()
    heartbeat_task.cancel()


app = FastAPI(title="Northgate Smart Bin Backend", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])


def require_key(x_api_key: str = Header(default="")):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(401, "invalid or missing X-API-Key")


def check_mode_provenance(prov: str):
    """Enforce mode rules against record provenance.

    REALTIME: accept only LIVE_HARDWARE. Reject SIMULATED/SIMULATED_DEMO with 409.
    SIMULATION: accept only simulated provenance. Reject LIVE_HARDWARE with 409.
    """
    current_mode = store.get_mode()
    if current_mode == "REALTIME":
        if prov != "LIVE_HARDWARE":
            raise HTTPException(409, detail="mode is REALTIME")
    elif current_mode == "SIMULATION":
        if prov == "LIVE_HARDWARE":
            raise HTTPException(409, detail="mode is SIMULATION")


async def process(raw: dict) -> dict:
    try:
        rec = logic.validate_record(raw)
    except logic.ValidationError as e:
        raise HTTPException(422, str(e))

    check_mode_provenance(rec["provenance"])

    result = await run_in_threadpool(store.ingest, rec)
    if result["accepted"]:
        kind = "telemetry" if rec["provenance"] == "LIVE_HARDWARE" else "simulated_telemetry"
        await broadcast({"type": kind, "bin_id": rec["bin_id"], "fill_level": rec["fill_level"],
                         "status": result["status"], "battery_pct": rec["battery_pct"],
                         "sequence": rec["sequence"], "rssi_dbm": rec["rssi_dbm"], "snr_db": rec["snr_db"],
                         "received_at": rec["received_at"], "provenance": rec["provenance"]})
        for a in result["alerts_created"]:
            await broadcast({"type": "alert", "provenance": rec["provenance"], **a})
    return result


@app.get("/api/health")
def health():
    current_mode = store.get_mode()
    return {
        "ok": True,
        "mode": current_mode,
        "demo_enabled": ENABLE_DEMO,
        "auth": bool(API_KEY),
        "ws_clients": len(clients),
        "encryption": {
            "transport": True,
            "storage": True,
            "mode": current_mode
        }
    }


@app.get("/api/mode")
def get_mode():
    return {"mode": store.get_mode()}


@app.post("/api/mode", dependencies=[Depends(require_key)])
async def set_mode(payload: dict = Body(...)):
    new_mode = payload.get("mode")
    if new_mode not in ("SIMULATION", "REALTIME"):
        raise HTTPException(422, "mode must be SIMULATION or REALTIME")
    updated_mode = store.set_mode(new_mode)
    await broadcast({"type": "mode", "mode": updated_mode})
    return {"mode": updated_mode}


@app.post("/api/telemetry", dependencies=[Depends(require_key)])
async def post_telemetry(payload: dict = Body(...)):
    # Check mode rules first: in REALTIME, non-LIVE_HARDWARE is rejected with 409
    try:
        rec = logic.validate_record(payload)
    except logic.ValidationError as e:
        raise HTTPException(422, str(e))
    check_mode_provenance(rec["provenance"])

    # Plaintext telemetry accepts nothing in REALTIME mode when ENFORCE_ENCRYPTION is set
    current_mode = store.get_mode()
    if ENFORCE_ENCRYPTION and current_mode == "REALTIME":
        raise HTTPException(403, detail="mode is REALTIME; encrypted telemetry required on /api/telemetry/secure")
    return await process(payload)


@app.post("/api/telemetry/secure", dependencies=[Depends(require_key)])
async def post_telemetry_secure(payload: dict = Body(...)):
    """Decrypt authenticated payload, check monotonic replay counter, and ingest."""
    if not isinstance(payload, dict):
        raise HTTPException(400, "malformed request")

    device_id_hex = payload.get("device_id")
    counter = payload.get("counter")
    packet_b64 = payload.get("packet")

    if not isinstance(device_id_hex, str) or len(device_id_hex) != 10:
        raise HTTPException(400, "malformed request")
    try:
        device_id_bytes = bytes.fromhex(device_id_hex)
    except ValueError:
        raise HTTPException(400, "malformed request")

    if not isinstance(counter, int) or counter < 0 or counter >= (1 << 64):
        raise HTTPException(400, "malformed request")

    if not isinstance(packet_b64, str):
        raise HTTPException(400, "malformed request")
    try:
        packet_bytes = base64.b64decode(packet_b64)
    except Exception:
        raise HTTPException(400, "malformed request")

    # Reconstruct AAD: device_id (5 bytes) || counter (8 bytes big-endian)
    aad = device_id_bytes + counter.to_bytes(8, byteorder="big")

    try:
        plaintext = aes_ccm.decrypt(TRANSPORT_KEY, packet_bytes, aad)
    except aes_ccm.MalformedPacketError:
        raise HTTPException(400, "malformed request")
    except aes_ccm.AuthenticationError:
        raise HTTPException(401, "authentication failed")

    # Replay protection: counter must be strictly greater than last accepted counter
    counter_ok = await run_in_threadpool(store.check_and_update_device_counter, device_id_hex, counter)
    if not counter_ok:
        raise HTTPException(401, "authentication failed")

    try:
        raw_rec = json.loads(plaintext.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "malformed request")

    return await process(raw_rec)


@app.post("/api/alert", dependencies=[Depends(require_key)])
async def post_alert(payload: dict = Body(...)):
    """Post an alert / fill update from console or human. Accepts bin_id, fill_level, optional status/battery/note/provenance."""
    if not isinstance(payload, dict):
        raise HTTPException(422, "payload must be a JSON object")
    bin_id = payload.get("bin_id")
    fill_level = payload.get("fill_level")
    prov_in = payload.get("provenance", "SIMULATED_DEMO")
    if prov_in not in ("SIMULATED_DEMO", "LIVE_HARDWARE"):
        raise HTTPException(422, "provenance must be SIMULATED_DEMO or LIVE_HARDWARE")

    check_mode_provenance(prov_in)

    battery_pct = payload.get("battery_pct", 100)
    raw = {
        "bin_id": bin_id,
        "fill_level": fill_level,
        "status": payload.get("status"),
        "battery_pct": battery_pct,
        "sequence": int(time.time() * 1000) % 2147483647,
        "provenance": "LIVE_HARDWARE" if prov_in == "LIVE_HARDWARE" else "SIMULATED"
    }
    try:
        rec = logic.validate_record(raw)
    except logic.ValidationError as e:
        raise HTTPException(422, str(e))

    rec["provenance"] = prov_in
    result = await run_in_threadpool(store.ingest, rec)
    if result.get("accepted"):
        kind = "telemetry" if prov_in == "LIVE_HARDWARE" else "simulated_telemetry"
        await broadcast({"type": kind, "bin_id": rec["bin_id"], "fill_level": rec["fill_level"],
                         "status": result.get("status"), "battery_pct": rec["battery_pct"],
                         "sequence": rec["sequence"], "rssi_dbm": rec["rssi_dbm"], "snr_db": rec["snr_db"],
                         "received_at": rec["received_at"], "provenance": prov_in,
                         "note": payload.get("note")})
        for a in result.get("alerts_created", []):
            await broadcast({"type": "alert", "provenance": prov_in, **a})
    return result


@app.get("/api/bins")
def list_bins():
    return store.bins()


@app.get("/api/bins/{bin_id}")
def get_bin(bin_id: str):
    b = store.bin(bin_id)
    if not b:
        raise HTTPException(404, f"bin {bin_id} not found")
    return b


@app.get("/api/bins/{bin_id}/telemetry")
def bin_history(bin_id: str, limit: int = 200):
    return store.history(bin_id, max(1, min(limit, 2000)))


@app.get("/api/alerts")
def list_alerts(active: bool = False):
    return store.alerts(active_only=active)


@app.post("/api/alerts/{alert_id}/ack", dependencies=[Depends(require_key)])
def ack_alert(alert_id: int):
    if not store.acknowledge(alert_id):
        raise HTTPException(404, "alert not found or already acknowledged")
    return {"ok": True}


@app.post("/api/admin/reset", dependencies=[Depends(require_key)])
def admin_reset():
    if not ENABLE_DEMO:
        raise HTTPException(403, "admin reset disabled when ENABLE_DEMO is 0")
    store.reset()
    return {"ok": True, "message": "tables reset"}


@app.post("/api/demo/bins/{bin_id}", dependencies=[Depends(require_key)])
async def demo_fill(bin_id: str, payload: dict = Body(...)):
    """Simulated reading for presentations. Stored as SIMULATED_DEMO, never as live hardware."""
    if not ENABLE_DEMO:
        raise HTTPException(404, "demo mode is disabled")

    check_mode_provenance("SIMULATED_DEMO")

    raw = {"bin_id": bin_id, "fill_level": payload.get("fill_level"), "battery_pct": 100,
           "sequence": int(time.time() * 1000), "provenance": "SIMULATED"}
    try:
        rec = logic.validate_record(raw)
    except logic.ValidationError as e:
        raise HTTPException(422, str(e))
    rec["provenance"] = "SIMULATED_DEMO"
    result = await run_in_threadpool(store.ingest, rec)
    await broadcast({"type": "simulated_telemetry", "bin_id": bin_id, "fill_level": rec["fill_level"],
                     "status": result.get("status"), "provenance": "SIMULATED_DEMO"})
    for a in result.get("alerts_created", []):
        await broadcast({"type": "alert", "provenance": "SIMULATED_DEMO", **a})
    return result


@app.websocket("/live")
async def live(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        current_mode = store.get_mode()
        await ws.send_json({"type": "hello", "message": "northgate backend connected", "mode": current_mode})
        while True:
            await ws.receive_text()   # keeps socket open or receives client messages
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        clients.discard(ws)


# Serve Alert Console static folder and root redirect/index
if os.path.exists(STATIC_DIR):
    app.mount("/console/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/console")
def get_console():
    console_file = os.path.join(STATIC_DIR, "alert-console.html")
    if os.path.exists(console_file):
        return FileResponse(console_file)
    raise HTTPException(404, "console page not found")
