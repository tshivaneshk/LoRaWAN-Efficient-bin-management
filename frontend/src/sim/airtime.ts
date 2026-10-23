/**
 * Standard Semtech LoRa Time-on-Air (ToA) calculation (Section 6.5)
 *
 * Tsym = 2^SF / BW
 * Tpreamble = (npreamble + 4.25) * Tsym
 * payloadSymbNb = 8 + max(ceil((8*PL - 4*SF + 28 + 16*CRC - 20*IH) / (4*(SF - 2*DE))) * (CR + 4), 0)
 * ToA = Tpreamble + payloadSymbNb * Tsym
 * DE = 1 when Tsym > 16 ms
 */
export interface LoRaAirtimeParams {
  payloadBytes: number;
  sf: 7 | 8 | 9 | 10 | 11 | 12;
  bwKhz: 125 | 250 | 500;
  cr: 5 | 6 | 7 | 8; // Coding Rate denominator (5 = 4/5, ..., 8 = 4/8)
  nPreamble?: number;
  crcEnabled?: boolean;
  implicitHeader?: boolean;
}

export interface LoRaAirtimeResult {
  tSymMs: number;
  tPreambleMs: number;
  payloadSymbNb: number;
  tPayloadMs: number;
  airtimeMs: number;
  lowDataRateOptimize: boolean;
}

export function calculateLoRaAirtime(params: LoRaAirtimeParams): LoRaAirtimeResult {
  const {
    payloadBytes: PL,
    sf: SF,
    bwKhz,
    cr,
    nPreamble = 8,
    crcEnabled = true,
    implicitHeader = false,
  } = params;

  const BW = bwKhz * 1000; // Hz
  const tSymSec = Math.pow(2, SF) / BW;
  const tSymMs = tSymSec * 1000;

  // DE = 1 when Tsym > 16 ms (e.g. SF11 and SF12 at 125 kHz -> 16.384 ms and 32.768 ms)
  const DE = tSymMs > 16 ? 1 : 0;
  const CRC = crcEnabled ? 1 : 0;
  const IH = implicitHeader ? 1 : 0;
  const crOffset = cr - 4; // where CR in formula is 1..4 for 4/5..4/8

  const tPreambleMs = (nPreamble + 4.25) * tSymMs;

  const numerator = 8 * PL - 4 * SF + 28 + 16 * CRC - 20 * IH;
  const denominator = 4 * (SF - 2 * DE);
  const payloadSymbNb = 8 + Math.max(Math.ceil(numerator / denominator) * (crOffset + 4), 0);

  const tPayloadMs = payloadSymbNb * tSymMs;
  const airtimeMs = Number((tPreambleMs + tPayloadMs).toFixed(2));

  return {
    tSymMs: Number(tSymMs.toFixed(3)),
    tPreambleMs: Number(tPreambleMs.toFixed(2)),
    payloadSymbNb,
    tPayloadMs: Number(tPayloadMs.toFixed(2)),
    airtimeMs,
    lowDataRateOptimize: DE === 1,
  };
}
