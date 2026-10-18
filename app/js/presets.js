// Loader for the preset library. The library itself is generated data (data/presets.json, written
// by tools/build_presets.py from tools/preset_catalogue.csv); this module only fetches it, checks its
// shape and exposes it. No DOM access, and no built-in fallback list.

export const LIBRARY_URL = 'data/presets.json';
export const DEFAULT_PRESET_ID = 'm31';

const STRING_FIELDS = ['id', 'label', 'category', 'main_id'];
const NUMBER_FIELDS = ['ra', 'dec', 'fov'];

export class PresetLibraryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PresetLibraryError';
  }
}

/**
 * Fetch the library (relative to the page) and resolve with
 * `{ presets, byId, categories }`: the entries in file order (category order, then natural label
 * order), a Map from `id` to entry, and the categories in the order they first appear.
 * Entries keep the file's field names; `main_id` is SIMBAD's identifier verbatim ("M  31").
 * Rejects with a PresetLibraryError whose message is fit for the UI.
 */
export async function loadPresets({ url = LIBRARY_URL } = {}) {
  const fail = (why) => new PresetLibraryError(`Preset library could not be loaded: ${why}`);
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw fail('network error');
  }
  if (!response.ok) throw fail(`HTTP ${response.status}`);
  let doc;
  try {
    doc = await response.json();
  } catch {
    throw fail(`${url} is not valid JSON`);
  }
  if (!doc || !Array.isArray(doc.presets) || doc.presets.length === 0) {
    throw fail(`${url} has no "presets" entries`);
  }

  const byId = new Map();
  const categories = [];
  doc.presets.forEach((entry, i) => {
    const problem = entryProblem(entry);
    if (problem) throw fail(`entry ${i + 1} ${problem}`);
    if (byId.has(entry.id)) throw fail(`entry ${i + 1} repeats the id "${entry.id}"`);
    byId.set(entry.id, Object.freeze(entry));
    if (!categories.includes(entry.category)) categories.push(entry.category);
  });
  return { presets: [...byId.values()], byId, categories };
}

function entryProblem(entry) {
  if (!entry || typeof entry !== 'object') return 'is not an object';
  for (const key of STRING_FIELDS) {
    if (typeof entry[key] !== 'string' || !entry[key].trim()) return `lacks a "${key}"`;
  }
  for (const key of NUMBER_FIELDS) {
    if (typeof entry[key] !== 'number' || !Number.isFinite(entry[key])) return `("${entry.id}") lacks a numeric "${key}"`;
  }
  return '';
}
