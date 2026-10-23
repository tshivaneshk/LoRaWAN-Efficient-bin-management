import { RegionCode } from '../sim/types';

export interface RegionPreset {
  code: RegionCode;
  name: string;
  bandRangeMhz: [number, number];
  channelsMhz: number[];
  maxEirpDbm: number;
  dutyCycleLimit: number; // 0..1 (e.g. 0.01 = 1%)
  dutyCycleNote: string;
  pl0DbAt1m: number; // Free-space path loss at 1m
}

export const REGION_PRESETS: Record<RegionCode, RegionPreset> = {
  IN865: {
    code: 'IN865',
    name: 'India (865–867 MHz)',
    bandRangeMhz: [865, 867],
    channelsMhz: [865.0625, 865.4025, 865.985],
    maxEirpDbm: 30,
    dutyCycleLimit: 0.01,
    dutyCycleNote: '1.0% configured channel limit (simulation assumption; IN865 regulatory framework does not mandate strict 1% sub-band duty cycle like EU868).',
    pl0DbAt1m: 31.2,
  },
  EU868: {
    code: 'EU868',
    name: 'Europe (863–870 MHz)',
    bandRangeMhz: [863, 870],
    channelsMhz: [868.1, 868.3, 868.5],
    maxEirpDbm: 14,
    dutyCycleLimit: 0.01,
    dutyCycleNote: '1.0% ETSI mandatory duty-cycle limit in g1 sub-band (36 sec/hour).',
    pl0DbAt1m: 31.25,
  },
  US915: {
    code: 'US915',
    name: 'North America (902–928 MHz)',
    bandRangeMhz: [902, 928],
    channelsMhz: [903.9, 904.1, 904.3, 904.5],
    maxEirpDbm: 30,
    dutyCycleLimit: 0.02,
    dutyCycleNote: '2.0% configured dwell/airtime budget (simulation assumption; FCC Part 15 uses 400 ms dwell-time limit rather than duty cycle).',
    pl0DbAt1m: 31.6,
  },
  AS923: {
    code: 'AS923',
    name: 'Asia-Pacific (920–925 MHz)',
    bandRangeMhz: [920, 925],
    channelsMhz: [923.2, 923.4],
    maxEirpDbm: 16,
    dutyCycleLimit: 0.01,
    dutyCycleNote: '1.0% configured duty-cycle limit (simulation assumption across AS923-1 sub-band).',
    pl0DbAt1m: 31.7,
  },
};
