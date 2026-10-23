# Northgate Smart Bin Backend

Backend for the smart bin simulator (`frontend` Vite/React app) and the physical prototype hardware.
Matches the architecture: Gateway Arduino -> USB serial -> **serial_bridge.py** -> **API + SQLite** -> dashboard / simulator.

```
Arduino gateway --USB--> serial_bridge.py --Secure HTTP POST--> FastAPI (:8765) --WebSocket /live--> simulator UI
                                                                     |
                                                  Encrypted SQLite (bins, telemetry, alerts)
```

## Quick Start (PowerShell on Windows)
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --port 8765
```

In a second terminal, run the bridge:
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python serial_bridge.py --port COM5
```

No hardware connected? Replay sample lines with `--stdin`:
```powershell
Get-Content sample_lines.txt | python serial_bridge.py --stdin
```

## Modes: SIMULATION vs REAL-TIME
The backend is the single source of truth for the active system mode, stored in the `settings` table of SQLite (`mode = SIMULATION | REALTIME`):
- **SIMULATION (Default):** Accepts simulated provenance records. Rejects `LIVE_HARDWARE` records with HTTP 409 (`{"detail":"mode is SIMULATION"}`).
- **REALTIME:** Accepts only `LIVE_HARDWARE` records. Rejects `SIMULATED` and `SIMULATED_DEMO` on `/api/telemetry`, `/api/alert`, and `/api/demo/bins/{id}` with HTTP 409 (`{"detail":"mode is REALTIME"}`). The backend never generates packets of its own. In the frontend simulator, pressing Play is suppressed so no simulated/predefined packets or scenario events are injected.
- **serial_bridge.py** treats HTTP 409 as a definitive rejection (does not spool and does not retry).
- Mode changes are broadcast live to connected clients over `/live` via `{"type":"mode","mode":"..."}`.

### Mode Endpoints
- `GET /api/mode` -> `{"mode":"SIMULATION" | "REALTIME"}`
- `POST /api/mode` -> `{"mode":"SIMULATION" | "REALTIME"}` (protected by `X-API-Key` if configured)

## Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/api/mode` | Current mode (`SIMULATION` or `REALTIME`) |
| POST | `/api/mode` | Update mode and broadcast over `/live` |
| POST | `/api/telemetry/secure` | Monotonic replay-protected AES-128-CCM encrypted telemetry |
| POST | `/api/telemetry` | Plaintext telemetry (blocked in REALTIME when `ENFORCE_ENCRYPTION=1`) |
| POST | `/api/alert` | Ingest operator alert (`bin_id`, `fill_level`, `provenance`) |
| GET | `/api/bins` | Decrypted latest state of all bins |
| GET | `/api/bins/{id}` | Decrypted details of single bin |
| GET | `/api/bins/{id}/telemetry` | Decrypted telemetry history |
| GET | `/api/alerts?active=true` | Decrypted active alerts |
| POST | `/api/alerts/{id}/ack` | Acknowledge alert |
| POST | `/api/demo/bins/{id}` | Demo fill reading (SIMULATION mode only) |
| POST | `/api/admin/reset` | Truncate tables for a clean demo |
| GET | `/api/health` | System status, mode, and encryption metadata |
| GET | `/console` | Light-theme Operator Alert Console |
| WS | `/live` | Real-time WebSocket event feed |

## Encryption Design and Security Boundaries

### 1. Cryptography Package & Custom Format
Encryption uses AES-128-CCM (`cryptography.hazmat.primitives.ciphers.aead.AESCCM`).
- Packet format: `nonce (13 bytes) || ciphertext || tag (8 bytes)`.
- **Note:** This packet format is custom and **not** LoRaWAN-compatible.

### 2. Data in Transit (Sensor/Gateway to Backend)
- `serial_bridge.py` encrypts each validated telemetry payload with `TRANSPORT_KEY`.
- Nonce construction: `device_id (5 bytes) || counter (8 bytes big-endian)`.
- Persistent monotonic counter: Stored in `bridge_counter.json`. Counters never reset across restarts, guaranteeing nonce uniqueness.
- Associated Data (AAD): `device_id (5 bytes) || counter (8 bytes big-endian)`.
- Replay Protection: AES-CCM alone provides authenticated encryption but **no** replay protection. The backend provides replay protection by verifying and persisting the highest accepted counter per device in the `device_counters` SQLite table. If `counter <= last_counter`, the request is rejected with HTTP 401.
- Spooling: If the backend is unavailable, `bridge_spool.jsonl` saves already-encrypted payloads, never plaintext.

### 3. Data at Rest (SQLite)
- Field-level AES-128-CCM using `STORAGE_KEY`.
- Encrypted columns: `fill_level`, `battery_pct`, `rssi_dbm`, `snr_db`, `status`, `reported_status`, and `alert message`.
- Format: Base64 string prefixed with `enc1:`.
- Bound with AAD: `"table|column|primary-key-or-bin_id|received_at"`.
- Plaintext columns: `bin_id`, `sequence`, `received_at`, `provenance`, and `alert_type` remain unencrypted for fast SQLite indexing, deduplication, and range queries.
- Encryption occurs strictly within `Store` (`app/db.py`), keeping `logic.py` pure and all API endpoints returning standard JSON.

### 4. Outbound Leg (Backend to Clients)
- Browser Web Crypto API lacks native AES-CCM support. Therefore, `/live` and `/console` transmit clear JSON.
- In production, `/live` and `/console` must be deployed behind HTTPS / WSS reverse proxy (TLS) to secure the browser-to-backend leg.

## Key Management
Keys must be 16 bytes (32 hexadecimal characters):
- `TRANSPORT_KEY`: Shared secret between `serial_bridge.py` and `/api/telemetry/secure`.
- `STORAGE_KEY`: Backend secret for database at-rest encryption.

If not provided via environment variables, keys are generated once into `backend/data/keys.json` (never committed or printed).

Generate a sample `.env` file with fresh keys:
```powershell
python -m app.keytool generate .env
```

## Database Migration Script
To migrate an existing SQLite database to encrypted at-rest format:
```powershell
python scripts/encrypt_existing_db.py data/northgate.db
```
The script is idempotent, creates a timestamped backup in `data/backup/`, encrypts plaintext values, and executes `PRAGMA wal_checkpoint(TRUNCATE)`.

## Running Tests
Run backend tests:
```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest discover tests
```

Run frontend tests:
```powershell
cd frontend
npm test
```
