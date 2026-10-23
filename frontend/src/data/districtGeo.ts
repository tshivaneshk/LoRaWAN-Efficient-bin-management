export interface DistrictZoneFeature {
  id: string;
  name: string;
  labelPos: { x: number; y: number };
  polygon: Array<[number, number]>;
  tintColor: string;
}

export interface DistrictBuilding {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zoneId: string;
}

export interface DistrictRoad {
  id: string;
  name: string;
  points: Array<[number, number]>;
  major?: boolean;
}

export const NORTHGATE_DISTRICT_GEO = {
  width: 1000,
  height: 700,
  controlRoomPos: { x: 485, y: 340 },
  waterPolygon: [
    [0, 585],
    [280, 560],
    [540, 595],
    [790, 575],
    [1000, 610],
    [1000, 700],
    [0, 700],
  ] as Array<[number, number]>,
  zones: [
    {
      id: 'campus',
      name: 'UNIVERSITY CAMPUS',
      labelPos: { x: 225, y: 155 },
      polygon: [
        [110, 120],
        [345, 120],
        [345, 310],
        [110, 310],
      ],
      tintColor: 'rgba(56, 189, 248, 0.06)',
    },
    {
      id: 'hospital',
      name: 'ST. JUDE HOSPITAL',
      labelPos: { x: 440, y: 135 },
      polygon: [
        [375, 115],
        [510, 115],
        [510, 245],
        [375, 245],
      ],
      tintColor: 'rgba(244, 63, 94, 0.05)',
    },
    {
      id: 'market',
      name: 'MARKET STREET DISTRICT',
      labelPos: { x: 600, y: 205 },
      polygon: [
        [520, 185],
        [695, 185],
        [695, 345],
        [520, 345],
      ],
      tintColor: 'rgba(251, 191, 36, 0.06)',
    },
    {
      id: 'stadium',
      name: 'NORTHGATE ARENA & PLAZA',
      labelPos: { x: 815, y: 125 },
      polygon: [
        [720, 105],
        [915, 105],
        [915, 305],
        [720, 305],
      ],
      tintColor: 'rgba(168, 85, 247, 0.06)',
    },
    {
      id: 'terminal',
      name: 'CENTRAL BUS TERMINAL',
      labelPos: { x: 205, y: 385 },
      polygon: [
        [120, 365],
        [310, 365],
        [310, 545],
        [120, 545],
      ],
      tintColor: 'rgba(34, 211, 238, 0.06)',
    },
    {
      id: 'park',
      name: 'BOTANICAL PARK',
      labelPos: { x: 485, y: 465 },
      polygon: [
        [375, 435],
        [615, 435],
        [615, 575],
        [375, 575],
      ],
      tintColor: 'rgba(52, 211, 153, 0.06)',
    },
    {
      id: 'residential',
      name: 'EASTWOOD RESIDENTIAL BLOCKS',
      labelPos: { x: 795, y: 395 },
      polygon: [
        [680, 375],
        [915, 375],
        [915, 550],
        [680, 550],
      ],
      tintColor: 'rgba(148, 163, 184, 0.05)',
    },
  ] as DistrictZoneFeature[],
  roads: [
    {
      id: 'RD-ARTERIAL-EW1',
      name: 'Northgate Arterial Way',
      major: true,
      points: [
        [40, 340],
        [340, 340],
        [485, 340],
        [705, 340],
        [960, 340],
      ],
    },
    {
      id: 'RD-ARTERIAL-EW2',
      name: 'Embankment Drive',
      major: true,
      points: [
        [60, 550],
        [340, 550],
        [650, 560],
        [950, 555],
      ],
    },
    {
      id: 'RD-ARTERIAL-NS1',
      name: 'University Boulevard',
      major: true,
      points: [
        [345, 70],
        [345, 340],
        [345, 565],
      ],
    },
    {
      id: 'RD-ARTERIAL-NS2',
      name: 'Market & Stadium Corridor',
      major: true,
      points: [
        [705, 70],
        [705, 340],
        [705, 565],
      ],
    },
    {
      id: 'RD-LOCAL-1',
      name: 'Campus Loop',
      points: [
        [150, 175],
        [310, 175],
        [310, 280],
        [150, 280],
        [150, 175],
      ],
    },
    {
      id: 'RD-LOCAL-2',
      name: 'Market Arcade Walk',
      points: [
        [510, 265],
        [705, 265],
      ],
    },
    {
      id: 'RD-LOCAL-3',
      name: 'Terminal Approach',
      points: [
        [145, 475],
        [345, 475],
      ],
    },
    {
      id: 'RD-LOCAL-4',
      name: 'Arena Ring Road',
      points: [
        [740, 155],
        [885, 155],
        [885, 265],
        [740, 265],
        [740, 155],
      ],
    },
    {
      id: 'RD-LOCAL-5',
      name: 'Oakwood Avenue',
      points: [
        [705, 465],
        [900, 465],
      ],
    },
  ] as DistrictRoad[],
  buildings: [
    // Campus buildings
    { id: 'B-01', x: 165, y: 185, w: 50, h: 26, zoneId: 'campus' },
    { id: 'B-02', x: 235, y: 170, w: 60, h: 24, zoneId: 'campus' },
    { id: 'B-03', x: 270, y: 215, w: 48, h: 35, zoneId: 'campus' },
    { id: 'B-04', x: 135, y: 240, w: 42, h: 45, zoneId: 'campus' },
    // Hospital
    { id: 'B-05', x: 395, y: 150, w: 90, h: 65, zoneId: 'hospital' },
    // Market stalls & halls
    { id: 'B-06', x: 535, y: 220, w: 44, h: 28, zoneId: 'market' },
    { id: 'B-07', x: 590, y: 215, w: 52, h: 26, zoneId: 'market' },
    { id: 'B-08', x: 605, y: 275, w: 65, h: 34, zoneId: 'market' },
    { id: 'B-09', x: 540, y: 285, w: 46, h: 30, zoneId: 'market' },
    // Stadium bowl
    { id: 'B-10', x: 765, y: 155, w: 105, h: 80, zoneId: 'stadium' },
    // Bus Terminal bays
    { id: 'B-11', x: 155, y: 425, w: 115, h: 32, zoneId: 'terminal' },
    { id: 'B-12', x: 155, y: 495, w: 95, h: 26, zoneId: 'terminal' },
    // Residential blocks
    { id: 'B-13', x: 710, y: 410, w: 45, h: 32, zoneId: 'residential' },
    { id: 'B-14', x: 775, y: 410, w: 50, h: 32, zoneId: 'residential' },
    { id: 'B-15', x: 840, y: 405, w: 48, h: 30, zoneId: 'residential' },
    { id: 'B-16', x: 735, y: 485, w: 52, h: 34, zoneId: 'residential' },
    { id: 'B-17', x: 810, y: 485, w: 58, h: 34, zoneId: 'residential' },
  ] as DistrictBuilding[],
};
