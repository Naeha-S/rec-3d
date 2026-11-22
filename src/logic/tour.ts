import type { Building, TourStop } from '../types';

const CURATED_TOUR: Omit<TourStop, 'index'>[] = [
  {
    buildingId: 'main-gate',
    title: 'Main Security Gate Arch',
    badge: 'Stop 1 · Arrival',
    summary:
      'Every morning starts under the REC Security Archway after the tree-lined avenue from NH-48. Collect visitor passes or head straight toward Aadhi Statue or the northern A-Block Fountain drive.',
    tip: 'College buses turn east along the northern avenue toward REC Transport & Faculty Quarters.',
    distance: 98,
    azimuthDeg: -36,
  },
  {
    buildingId: 'a-block',
    title: 'A Block · Main Block & Portico Fountain',
    badge: 'Stop 2 · Admin & CSE',
    summary:
      'Crowned by the iconic red "RAJALAKSHMI ENGINEERING COLLEGE" rooftop sign facing the north Fountain carriageway. Houses the Principal, Admissions, Purple Hall, Placement Cell, and CSE.',
    tip: 'Orbit to the north side (-Z) to see the circular Fountain loop right in front of A Block’s portico.',
    distance: 128,
    azimuthDeg: 165,
  },
  {
    buildingId: 'aadhi-statue',
    title: 'Aadhi Statue Roundabout',
    badge: 'Stop 3 · Campus Landmark',
    summary:
      'REC’s Blackbuck mascot monument in purple tracksuit at the roundabout between A Block and B Block, flanked by Domino’s Pizza.',
    tip: 'First-year campus tours and symposium volunteer desks meet right at Aadhi Statue.',
    distance: 38,
    azimuthDeg: -152,
  },
  {
    buildingId: 'b-block',
    title: 'B Block · ECE & EEE Courtyard',
    badge: 'Stop 4 · Core Electronics',
    summary:
      'Five-story (18 m) U-shaped courtyard block housing the ECE HoD, VLSI & Embedded Systems Labs, EEE Department, and Maggi Hotspot in the shaded quad.',
    tip: 'Type "ECE HoD" or "VLSI Lab" in search anytime for an A* walking route straight here.',
    distance: 138,
    azimuthDeg: -18,
  },
  {
    buildingId: 'i-block',
    title: 'I Block · First-Year & TIFAC',
    badge: 'Stop 5 · Freshers Wing',
    summary:
      'Five-story (20 m) western hub for Semester 1 & 2: First-Year Coordinator, Physics, Chemistry & English Labs, plus TIFAC-CORE in Machine Vision.',
    tip: 'Nearby sit the 30 m / 8-floor D Block, 15 m Idea Factory, and REC Cafe.',
    distance: 142,
    azimuthDeg: 34,
  },
  {
    buildingId: 'hut-cafe',
    title: 'Hut Cafe & Workshops 1 & 2',
    badge: 'Stop 6 · Break & Practice',
    summary:
      'Open-air pitched-roof Hut Cafe pavilion right beside Workshop Lab 1, Workshop Lab 2 (9 m high-bay halls), and C Block’s Fluid Mechanics Lab.',
    tip: 'Also check out the open-air Garden Cafe on the northeast road leading to Faculty Quarters.',
    distance: 108,
    azimuthDeg: 18,
  },
  {
    buildingId: 'j-block',
    title: 'J Block & Central Library',
    badge: 'Stop 7 · Study & Coding',
    summary:
      'Four-story (16 m) Central Library, digital journals, silent reading halls, and PG/MBA wings along the eastern tree-lined avenue south of TPT/EB Block & Garden Cafe.',
    tip: 'Tech Lounge’s coding & hackathon arena sits just northwest across the avenue.',
    distance: 122,
    azimuthDeg: -38,
  },
  {
    buildingId: 'indoor-auditorium',
    title: 'Indoor Auditorium, Pool & Grassy Ground',
    badge: 'Stop 8 · Sports & Events',
    summary:
      'High-bay 12 m Indoor Auditorium shed beside the enclosed Swimming Pool Complex, Gym, three-step White Stairs seating, and the 4 courts bordering the open grassy ground.',
    tip: 'Induction day ("Abhivyakti") and cultural fests ("Recharge") are hosted right here.',
    distance: 136,
    azimuthDeg: -45,
  },
  {
    buildingId: 'ruby-hostel',
    title: 'Hostel Promenade & Main Canteen',
    badge: 'Stop 9 · Residential Zone',
    summary:
      'Southern residential avenue linking Ruby (20 m), Emerald (25 m), Ladies Hostel 3 (24 m), Main Canteen, and Boys Hostel (26 m / 7 floors).',
    tip: 'Teachers Hostel (26 m / 7 floors) sits on the quiet northeastern woodland road.',
    distance: 148,
    azimuthDeg: -26,
  },
];

export function getTourStops(buildings: Building[]): TourStop[] {
  const validIds = new Set(buildings.map((b) => b.id));
  return CURATED_TOUR.filter((s) => validIds.has(s.buildingId)).map((s, idx) => ({
    ...s,
    index: idx,
  }));
}
