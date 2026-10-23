# Northgate Smart Bin System

This project is a smart waste bin monitoring system. It simulates waste bins, receives real sensor telemetry through LoRaWAN and serial hardware, encrypts data for security, and displays everything on a web dashboard in real time.

---

## What is in this project?

The project contains two main folders:

- **backend**:
  - Built with Python (FastAPI) and SQLite.
  - Receives bin sensor readings from USB serial or test input files.
  - Encrypts sensor data in transit and in the database using AES-128-CCM.
  - Provides two system modes: SIMULATION (for demonstrations) and REAL-TIME (for physical hardware).
  - Provides an Operator Alert Console web page at http://localhost:8765/console.

- **frontend**:
  - Built with React, TypeScript, and Vite.
  - Displays an interactive map of smart bins in Northgate.
  - Shows live fill levels, battery status, collection truck paths, and active alerts.
  - Connects to the backend using WebSockets to display incoming records immediately.

---

## How the system works

- **Sensor Hardware**: The Arduino gateway reads ultrasonic distance measurements and sends JSON lines over USB serial.
- **Serial Bridge**: Reads serial lines, validates the numbers, encrypts the record with AES-128-CCM, and sends it to the backend.
- **FastAPI Backend**: Verifies packet authenticity, prevents replay attacks using a persistent counter, and stores data in an encrypted SQLite database.
- **Frontend Dashboard**: Listens to the backend over WebSockets and updates bin statuses on the map in real time.

---

## Prerequisites

Before starting, ensure you have installed:
- Python 3.10 or newer
- Node.js 18 or newer
- PowerShell (on Windows) or a standard terminal (on Linux / macOS)

---

## How to set up and run

### Step 1: Set up and run the Backend

Open a PowerShell terminal and run the following commands:

```powershell
# Go to the backend folder
cd backend

# Create and activate a Python virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install required dependencies
pip install -r requirements.txt

# Start the backend server
python -m uvicorn app.main:app --port 8765
```

The backend is now accessible at:
- Interactive API Documentation: http://localhost:8765/docs
- Operator Alert Console: http://localhost:8765/console

---

### Step 2: Set up and run the Frontend

Open a second PowerShell terminal and run:

```powershell
# Go to the frontend folder
cd frontend

# Install dependencies
npm install

# Start the frontend development server
npm run dev
```

Open your browser and visit:
- Application URL: http://localhost:5173

The top right corner will show the connection indicator (BACKEND LIVE).

---

### Step 3: Send sensor readings to the system

Open a third PowerShell terminal to transmit readings into the backend:

- **Option A: Test without physical hardware (using sample data)**
  ```powershell
  cd backend
  .\.venv\Scripts\Activate.ps1
  Get-Content sample_lines.txt | python serial_bridge.py --stdin
  ```

- **Option B: Run with an Arduino connected via USB**
  ```powershell
  cd backend
  .\.venv\Scripts\Activate.ps1
  python serial_bridge.py --port COM5
  ```
  *(Replace COM5 with your actual serial port. Close the Arduino Serial Monitor before running this command).*

---

## System Modes

You can switch the active mode from the Alert Console (http://localhost:8765/console):

- **SIMULATION Mode**:
  - Intended for testing and synthetic traffic.
  - Automatically calculates simulated fill rates and plays scenario timelines.
  - Rejects real hardware packets to avoid mixing synthetic and physical readings.

- **REAL-TIME Mode**:
  - Intended for live demonstrations and physical hardware.
  - Accepts only real hardware records.
  - In the frontend simulator, the clock runs normally, but synthetic fill increments and fake alerts are suppressed.
  - Alerts are only generated when an actual high fill reading arrives.

---

## Security and Encryption Details

- **Encryption in Transit (Bridge to Backend)**:
  - Records are encrypted using AES-128-CCM authenticated encryption.
  - Every packet includes a unique, monotonically increasing counter stored in bridge_counter.json.
  - If a packet is tampered with or replayed, the backend rejects it with an authentication error.

- **Encryption at Rest (SQLite Database)**:
  - Measurement fields (fill_level, battery_pct, status, message) are encrypted in data/northgate.db with the prefix enc1:.
  - Inspecting the raw database file shows only encrypted ciphertext, protecting sensitive data.

---

## Verification and Tests

To verify that all components are working correctly:

- **Run backend tests (27 unit tests)**:
  ```powershell
  cd backend
  .\.venv\Scripts\Activate.ps1
  python -m unittest discover tests
  ```

- **Run frontend tests (8 vitest tests)**:
  ```powershell
  cd frontend
  npm test
  ```

Both test suites should finish with all tests passing.
