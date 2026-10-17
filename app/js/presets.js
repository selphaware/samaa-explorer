// Preset targets (ICRS J2000, decimal degrees), resolved via CDS Sesame and cross-checked in
// SIMBAD TAP on 2026-10-17. `simbadId` is the SIMBAD main_id, kept verbatim (internal spaces
// included). `fov` is the default field of view in degrees.
export const PRESETS = [
  { id: 'm31', label: 'Andromeda (M31)', simbadId: 'M  31', ra: 10.68470833, dec: 41.26875, fov: 1.5 },
  { id: 'm42', label: 'Orion Nebula (M42)', simbadId: 'M  42', ra: 83.8201, dec: -5.3876, fov: 1.0 },
  { id: 'sgra', label: 'Sagittarius A*', simbadId: 'NAME Sgr A*', ra: 266.41681662, dec: -29.00782497, fov: 0.5 },
  { id: 'm87', label: 'M87', simbadId: 'M  87', ra: 187.70593077, dec: 12.39112325, fov: 0.5 },
  { id: 'hudf', label: 'Hubble Ultra Deep Field', simbadId: 'NAME Hubble Ultra Deep Field', ra: 53.1625, dec: -27.79138889, fov: 0.2 },
  { id: 'm1', label: 'Crab Nebula (M1)', simbadId: 'M   1', ra: 83.6324, dec: 22.0174, fov: 0.3 },
  { id: 'm45', label: 'Pleiades (M45)', simbadId: 'Cl Melotte   22', ra: 56.60083333, dec: 24.11388889, fov: 2.0 },
  { id: 'betelgeuse', label: 'Betelgeuse', simbadId: '* alf Ori', ra: 88.79293899, dec: 7.407064, fov: 0.5 },
];

export const DEFAULT_PRESET_ID = 'm31';
