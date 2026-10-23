# Northgate Smart Bin System

This project is a smart waste bin monitoring system. It simulates waste bins, receives real sensor telemetry through LoRaWAN/serial hardware, encrypts data for security, and displays everything on a web dashboard in real time.

---

## What is in this project?

The project has two main folders:

1. **`backend`**: 
   - Built with **Python (FastAPI)** and **SQLite**.
   - Receives bin sensor readings from USB serial or test files.
   - Encrypts sensor data in transit and in the database using **AES-128-CCM**.
   - Has two modes: **SIMULATION** (for demos) and **REAL-TIME** (for real sensor hardware).
   - Serves an **Alert Console** web page at `http://localhost:8765/console`.

2. **`frontend`**:
   - Built with **React**, **TypeScript**, and **Vite**.
   - Displays an interactive map of smart bins in Northgate.
   - Shows live fill levels, battery levels, collection truck routes, and alerts.
   - Connects to the backend using WebSockets to show new data immediately.

---

## How the system works

```
Sensors / Arduino Gateway
         │
         ▼ (USB Serial / Test Input)
   serial_bridge.py
         │
         ▼ (Encrypted HTTP POST with AES-128-CCM)
FastAPI Backend (:8765) ─── Encrypted SQLite Database
         │
         ▼ (Live WebSocket)
Frontend Simulator / Map (:5173) & Alert Console (:8765/console)
```

---

## How to set up and run

### Step 1: Install prerequisites
Make sure you have installed:
- **Python 3.10+**
- **Node.js 18+**

---

### Step 2: Set up and run the Backend

Open a PowerShell terminal and run:

```powershell
# 1. Go into the backend directory
cd backend

# 2. Create and activate a Python virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 3. Install required Python packages
pip install -r requirements.txt

# 4. Start the backend server
python -m uvicorn app.main:app --port 8765
```

The backend is now running at:
- **API Documentation**: [http://localhost:8765/docs](http://localhost:8765/docs)
- **Operator Alert Console**: [http://localhost:8765/console](http://localhost:8765/console)

---

### Step 3: Set up and run the Frontend

Open a **second** PowerShell terminal and run:

```powershell
# 1. Go into the frontend directory
cd frontend

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

Open your web browser and visit:
👉 **[http://localhost:5173](http://localhost:5173)**

You will see the map of bins. The indicator in the top right will show **`BACKEND LIVE`**.

---

### Step 4: Send sensor data to the system

Open a **third** PowerShell terminal to send data into the backend:

#### Option A: Without physical hardware (using sample data)
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
Get-Content sample_lines.txt | python serial_bridge.py --stdin
```

#### Option B: With an Arduino connected via USB
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python serial_bridge.py --port COM5
```
*(Replace `COM5` with your actual serial port name. Remember to close the Arduino Serial Monitor first.)*

---

## Two System Modes

You can switch the mode in the Alert Console ([http://localhost:8765/console](http://localhost:8765/console)):

1. **SIMULATION Mode**:
   - Used for testing and presentations.
   - Runs simulated bin fill rates and automated scenarios.
   - Rejects live hardware records to prevent mixing real and fake data.

2. **REAL-TIME Mode**:
   - Used for real hardware and live demonstrations.
   - Accepts only real hardware readings (`LIVE_HARDWARE`).
   - In the frontend, the clock runs normally, but no fake packets or fake alerts are generated.
   - Alerts appear only when an actual high fill reading arrives.

---

## How Security and Encryption Work

1. **In Transit (from Bridge to Backend)**:
   - Readings are encrypted using **AES-128-CCM** authenticated encryption.
   - Every transmission uses a unique monotonic counter (stored in `bridge_counter.json`).
   - If someone tries to replay an old packet or modify the data in transit, the backend rejects it with an authentication error.

2. **At Rest (in SQLite Database)**:
   - Sensitive measurements (`fill_level`, `battery_pct`, `status`, `message`) are encrypted in the database file (`data/northgate.db`) with the prefix `enc1:`.
   - Even if someone opens the database file directly, they cannot read the fill levels or sensor data without the storage key.

---

## Running the Tests

To check that everything is working properly:

### Run backend tests (27 tests):
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m unittest discover tests
```

### Run frontend tests (8 tests):
```powershell
cd frontend
npm test
```

All tests should pass with green checkmarks.
