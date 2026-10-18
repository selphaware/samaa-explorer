// UI wiring: preset library → form → validation → image + catalogue panels, with loading, error and
// empty states. A Custom position is remembered in localStorage; every view is mirrored in the URL hash.
// All network access goes through the service adapters; this module never builds a service URL itself.
import { loadPresets, DEFAULT_PRESET_ID } from './presets.js';
import { SURVEYS, DEFAULT_SURVEY, CREDIT as HIPS2FITS_CREDIT, fetchCutout } from './services/hips2fits.js';
import { coneSearch, fieldCensus } from './services/simbad.js';

const IMAGE_SIZE_PX = 800;
const TABLE_LIMIT = 200;
const CENSUS_INLINE = 8; // census groups shown before the "+ k more types" tail
const SIMBAD_OBJECT_PAGE = 'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=';
const CUSTOM = 'custom'; // value of select#preset's first option
const STORAGE_CUSTOM = 'samaa.custom'; // {ra, dec, fov}: the raw strings as typed
const STORAGE_LAST = 'samaa.lastPreset'; // 'custom' or a preset id; only 'custom' is restored on load
const LINK_KEYS = ['ra', 'dec', 'fov', 'hips'];

const $ = (selector) => document.querySelector(selector);
const ui = {
  form: $('#controls'),
  presetFilter: $('#preset-filter'),
  preset: $('#preset'),
  ra: $('#ra'),
  dec: $('#dec'),
  fov: $('#fov'),
  survey: $('#survey'),
  explore: $('#explore'),
  formError: $('#form-error'),
  imagePanel: $('#image-panel'),
  image: $('#sky-image'),
  imageStatus: $('#image-status'),
  caption: $('#image-caption'),
  imageError: $('#image-error'),
  tablePanel: $('#table-panel'),
  rowCount: $('#row-count'),
  sort: $('#sort'),
  census: $('#field-census'),
  tableError: $('#table-error'),
  tableStatus: $('#table-status'),
  refsHeader: $('#col-refs'),
  sepHeader: $('#col-sep'),
  tbody: $('#objects-table tbody'),
};

// Client-side limits, checked before any URL is built (typed values and link values alike).
const FIELDS = [
  { key: 'ra', name: 'RA', valid: (v) => v >= 0 && v < 360, rule: 'RA must be a number of degrees with 0 ≤ RA < 360' },
  { key: 'dec', name: 'Dec', valid: (v) => v >= -90 && v <= 90, rule: 'Dec must be a number of degrees between −90 and +90' },
  { key: 'fov', name: 'FoV', valid: (v) => v >= 0.01 && v <= 10, rule: 'Field of view must be between 0.01 and 10 degrees' },
];
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

// Row orders offered by #sort; both work on the loaded rows and never send a request.
// `refs` is the server's own order (nbref DESC, sep_deg ASC), so it is rendered as received.
const SORTS = {
  refs: { header: 'refsHeader', direction: 'descending', order: (objects) => objects },
  sep: { header: 'sepHeader', direction: 'ascending', order: (objects) => [...objects].sort(bySeparation) },
};
const DEFAULT_SORT = 'refs';

let busy = false;
let imageObjectUrl = null;
let loadedObjects = []; // rows of the last successful catalogue query, in server order
let library = { presets: [], byId: new Map(), categories: [] };
let libraryProblem = ''; // stays in #form-error next to any validation message
let presetSearchText = new Map(); // preset id → "label\nmain_id", lower-cased, for the filter
let customSet = readStoredCustom();

// ---- setup ----

for (const survey of SURVEYS) ui.survey.append(new Option(survey.label, survey.id));
ui.survey.value = DEFAULT_SURVEY;
ui.sort.value = DEFAULT_SORT;
markSortedColumn(currentSort());
ui.presetFilter.disabled = true; // until the library has loaded

ui.preset.addEventListener('change', applySelection);
ui.presetFilter.addEventListener('input', applyFilter);
// Enter in the filter box must not submit the form (Explore is for the coordinate inputs).
ui.presetFilter.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') event.preventDefault();
});
// Enter in any coordinate input submits the form; the disabled submit button blocks it while busy.
ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  explore();
});
for (const { key } of FIELDS) {
  ui[key].addEventListener('input', () => {
    ui[key].removeAttribute('aria-invalid');
    rememberCustom();
  });
}
ui.sort.addEventListener('change', renderObjects);

start();

// Load the library, then decide the initial state: URL hash → stored Custom set → the default preset.
async function start() {
  try {
    library = await loadPresets();
    renderPresetOptions(library);
    ui.presetFilter.disabled = false;
  } catch (err) {
    // Never a built-in fallback list: the select keeps only Custom and the problem is shown.
    libraryProblem = err.message;
    setFormError('');
  }

  const link = readLink();
  if (link?.view) {
    applyLink(link.view);
    explore();
    return;
  }
  applyDefaultSelection();
  if (link?.problems) setFormError(link.problems.join(' '));
}

// ---- presets, Custom and the filter ----

function renderPresetOptions({ presets, categories }) {
  const groups = new Map(categories.map((category) => {
    const group = document.createElement('optgroup');
    group.label = category;
    return [category, group];
  }));
  for (const preset of presets) groups.get(preset.category).append(new Option(preset.label, preset.id));
  presetSearchText = new Map(presets.map((p) => [p.id, `${p.label}\n${p.main_id}`.toLowerCase()]));
  ui.preset.append(...groups.values());
}

function applyDefaultSelection() {
  if (readStored(STORAGE_LAST) === CUSTOM && customSet) {
    ui.preset.value = CUSTOM;
  } else if (library.byId.has(DEFAULT_PRESET_ID)) {
    ui.preset.value = DEFAULT_PRESET_ID;
  } else {
    return;
  }
  applySelection();
}

// #preset change handler, also used on load. Idempotent: Playwright's select_option fires `change`
// even for the option already selected. Fills the inputs only; the survey is left alone.
function applySelection() {
  const value = ui.preset.value;
  if (value === CUSTOM) {
    if (customSet) fillInputs(customSet);
  } else {
    const preset = library.byId.get(value);
    if (!preset) return;
    fillInputs({ ra: String(preset.ra), dec: String(preset.dec), fov: String(preset.fov) });
  }
  store(STORAGE_LAST, value);
}

// Typing in a coordinate input makes the current values the Custom set.
function rememberCustom() {
  ui.preset.value = CUSTOM;
  customSet = { ra: ui.ra.value, dec: ui.dec.value, fov: ui.fov.value };
  store(STORAGE_CUSTOM, JSON.stringify(customSet));
  store(STORAGE_LAST, CUSTOM);
}

function fillInputs({ ra, dec, fov }) {
  ui.ra.value = ra;
  ui.dec.value = dec;
  ui.fov.value = fov;
  for (const { key } of FIELDS) ui[key].removeAttribute('aria-invalid');
}

// Non-matching named options get both `hidden` and `disabled`; an optgroup left without a match is
// hidden. The Custom option and the current selection are never touched.
function applyFilter() {
  const query = ui.presetFilter.value.trim().toLowerCase();
  for (const group of ui.preset.querySelectorAll('optgroup')) {
    let matches = 0;
    for (const option of group.querySelectorAll('option')) {
      const match = !query || (presetSearchText.get(option.value) ?? '').includes(query);
      option.hidden = !match;
      option.disabled = !match;
      if (match) matches += 1;
    }
    group.hidden = matches === 0;
  }
}

function readStoredCustom() {
  try {
    const set = JSON.parse(readStored(STORAGE_CUSTOM));
    if (set && FIELDS.every(({ key }) => typeof set[key] === 'string')) return { ra: set.ra, dec: set.dec, fov: set.fov };
  } catch {
    // not JSON: treat as nothing stored
  }
  return null;
}

// Storage can be unavailable (privacy settings); Custom is then simply not remembered across reloads.
function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // see readStored
  }
}

// ---- shareable URL: #ra=<deg>&dec=<deg>&fov=<deg>&hips=<HiPS id>[&preset=<id>] ----

// Parsed once on load; the page does not listen to `hashchange`.
function readLink() {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const values = Object.fromEntries(LINK_KEYS.map((key) => [key, (params.get(key) ?? '').trim()]));
  const missing = LINK_KEYS.filter((key) => !values[key]);
  if (missing.length) {
    return { problems: [`Link is incomplete: it needs ra, dec, fov and hips (missing ${missing.join(', ')}).`] };
  }
  const problems = FIELDS
    .filter((field) => Number.isNaN(parseField(field, values[field.key])))
    .map((field) => `Link has an invalid ${field.name}: ${values[field.key]} (${field.rule}).`);
  if (![...ui.survey.options].some((option) => option.value === values.hips)) {
    problems.push(`Link names a survey this page does not offer: ${values.hips}.`);
  }
  if (problems.length) return { problems };
  return { view: { ...values, preset: params.get('preset') } };
}

// Only `preset=<id>` selects a named preset; matching coordinates alone open as Custom, and a shared
// Custom view becomes the user's current Custom set.
function applyLink({ ra, dec, fov, hips, preset }) {
  fillInputs({ ra, dec, fov });
  ui.survey.value = hips;
  if (preset && library.byId.has(preset)) {
    ui.preset.value = preset;
    store(STORAGE_LAST, preset);
  } else {
    rememberCustom();
  }
}

// replaceState, never `location.hash =` (that would fire hashchange and add history entries).
function writeLink({ ra, dec, fov, survey, target }) {
  const params = new URLSearchParams({ ra: String(ra), dec: String(dec), fov: String(fov), hips: survey.id });
  if (target) params.set('preset', target.id);
  history.replaceState(null, '', `#${params}`);
}

// ---- explore ----

async function explore() {
  if (busy) return;
  const { values, problems } = readForm();
  if (problems.length) {
    setFormError(problems.map((p) => p.message).join(' '));
    problems[0].input.focus();
    return;
  }
  setFormError('');

  const survey = SURVEYS.find((s) => s.id === ui.survey.value) ?? { id: ui.survey.value, label: ui.survey.value };
  const view = { ...values, radius: values.fov / 2, survey, target: activeTarget() };
  // Written as the requests go out, so a failing service still leaves a URL to retry.
  writeLink(view);

  setBusy(true);
  try {
    await Promise.allSettled([showImage(view), showObjects(view)]);
  } finally {
    setBusy(false);
  }
}

function readForm() {
  const values = {};
  const problems = [];
  for (const field of FIELDS) {
    const input = ui[field.key];
    const raw = input.value.trim();
    const value = parseField(field, raw);
    if (Number.isNaN(value)) {
      input.setAttribute('aria-invalid', 'true');
      problems.push({ input, message: `${field.rule} (got “${raw || 'nothing'}”).` });
    } else {
      input.removeAttribute('aria-invalid');
      values[field.key] = value;
    }
  }
  return { values, problems };
}

// The value in degrees, or NaN when the text is not a plain decimal inside the field's limits.
function parseField(field, raw) {
  const text = raw.trim().replace(/^−/, '-'); // accept a typographic minus sign
  const value = DECIMAL.test(text) ? Number(text) : NaN;
  return Number.isFinite(value) && field.valid(value) ? value : NaN;
}

function setFormError(message) {
  ui.formError.textContent = [libraryProblem, message].filter(Boolean).join(' ');
}

function setBusy(on) {
  busy = on;
  ui.explore.disabled = on;
  ui.explore.textContent = on ? 'Loading…' : 'Explore';
}

// The named preset selected at Explore time, or null for a Custom position.
function activeTarget() {
  const preset = library.byId.get(ui.preset.value);
  return preset ? { id: preset.id, label: preset.label, mainId: preset.main_id } : null;
}

// ---- image panel ----

async function showImage(view) {
  const { ra, dec, fov, survey } = view;
  ui.imagePanel.setAttribute('aria-busy', 'true');
  ui.imageError.textContent = '';
  ui.caption.replaceChildren();
  clearImage();
  setImageStatus(`Loading ${survey.label} cutout…`);
  try {
    const blob = await fetchCutout({ hips: survey.id, ra, dec, fov, width: IMAGE_SIZE_PX, height: IMAGE_SIZE_PX });
    imageObjectUrl = URL.createObjectURL(blob);
    await displayImage(imageObjectUrl, altText(view));
    setImageStatus('');
    renderCaption(view);
  } catch (err) {
    clearImage();
    setImageStatus('No image');
    ui.imageError.textContent = `Image error: ${err.message}`;
  } finally {
    ui.imagePanel.removeAttribute('aria-busy');
  }
}

function displayImage(src, alt) {
  const img = ui.image;
  return new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('hips2fits returned an image the browser could not decode'));
    img.alt = alt;
    img.src = src;
  }).then(() => {
    img.hidden = false;
  });
}

// Revokes the previous blob URL before a new one is assigned, so repeated Explores do not leak images.
function clearImage() {
  const img = ui.image;
  img.onload = null;
  img.onerror = null;
  img.hidden = true;
  img.removeAttribute('src');
  if (imageObjectUrl) {
    URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = null;
  }
}

function setImageStatus(text) {
  ui.imageStatus.textContent = text;
  ui.imageStatus.hidden = !text;
}

function altText({ ra, dec, fov, survey, target }) {
  const where = target ? `${target.label}, centred on` : 'Custom position, centred on';
  return `${survey.label} survey image: ${where} RA ${deg(ra, 4)}°, Dec ${signedDeg(dec, 4)}°, ${fov}° field of view`;
}

function renderCaption({ ra, dec, fov, survey, target }) {
  const targetLine = line('caption-target', target ? `${target.label} · ` : 'Custom position');
  if (target) {
    const mainId = document.createElement('code');
    mainId.className = 'simbad-id';
    mainId.textContent = target.mainId; // verbatim, runs of spaces included ("M  31")
    targetLine.append(mainId);
  }
  const surveyLine = line('caption-survey', `${survey.label} `);
  const hipsId = document.createElement('code');
  hipsId.textContent = survey.id;
  surveyLine.append(hipsId);
  ui.caption.replaceChildren(
    targetLine,
    surveyLine,
    line('caption-coords',
      `Centre RA ${deg(ra, 6)}°, Dec ${signedDeg(dec, 6)}° (ICRS) · FoV ${fov}° · ${IMAGE_SIZE_PX} × ${IMAGE_SIZE_PX} px, TAN`),
    line('caption-credit', HIPS2FITS_CREDIT),
  );
}

function line(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// ---- catalogue panel ----

async function showObjects({ ra, dec, radius }) {
  ui.tablePanel.setAttribute('aria-busy', 'true');
  loadedObjects = [];
  renderObjects();
  clearCensus();
  ui.rowCount.textContent = '';
  ui.tableError.textContent = '';
  setTableStatus('Loading SIMBAD objects and field census…');

  const cone = { ra, dec, radiusDeg: radius };
  // allSettled, not all: a failed census must not throw away 200 good rows.
  const [rows, census] = await Promise.allSettled([coneSearch({ ...cone, limit: TABLE_LIMIT }), fieldCensus(cone)]);
  ui.tablePanel.removeAttribute('aria-busy');

  if (rows.status === 'rejected') {
    // An upstream failure is an error, never the empty state.
    setTableStatus('');
    ui.tableError.textContent = `Catalogue error: ${rows.reason.message}`;
    return;
  }

  loadedObjects = rows.value;
  renderObjects();
  if (census.status === 'fulfilled') {
    renderCensus(census.value);
  } else {
    ui.tableError.textContent = `Catalogue error: the field census query failed: ${census.reason.message}`;
  }

  const within = `within ${trimNumber(radius)}°`;
  if (loadedObjects.length === 0) {
    setTableStatus('No catalogued objects in this field');
  } else {
    setTableStatus('');
    ui.rowCount.textContent = census.status === 'fulfilled'
      ? `Showing ${loadedObjects.length} of ${census.value.total.toLocaleString('en-US')} objects ${within}`
      : `Showing ${loadedObjects.length} objects ${within} (total unavailable)`;
  }
}

function currentSort() {
  return SORTS[ui.sort.value] ?? SORTS[DEFAULT_SORT];
}

// Render the loaded rows in the order #sort asks for (also the #sort change handler).
function renderObjects() {
  const sort = currentSort();
  markSortedColumn(sort);
  const fragment = document.createDocumentFragment();
  for (const object of sort.order(loadedObjects)) fragment.append(objectRow(object));
  ui.tbody.replaceChildren(fragment);
}

function markSortedColumn(sort) {
  for (const { header } of Object.values(SORTS)) ui[header].removeAttribute('aria-sort');
  ui[sort.header].setAttribute('aria-sort', sort.direction);
}

// Numeric, never on the formatted text. Array#sort is stable, so equal separations keep Refs order.
function bySeparation(a, b) {
  return (a.sepDeg ?? Infinity) - (b.sepDeg ?? Infinity);
}

function objectRow(object) {
  const tr = document.createElement('tr');

  const idCell = document.createElement('td');
  idCell.className = 'col-id';
  const link = document.createElement('a');
  link.href = SIMBAD_OBJECT_PAGE + encodeURIComponent(object.mainId);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = object.mainId; // verbatim: SIMBAD ids keep runs of spaces ("M  31")
  idCell.append(link);

  const typeCell = cell(object.otypeDesc ?? object.otype ?? '—', 'col-type');
  if (object.otype) typeCell.title = object.otype;

  tr.append(
    idCell,
    typeCell,
    cell(object.nbref == null ? '—' : object.nbref.toLocaleString('en-US'), 'num'),
    cell(object.ra == null ? '—' : deg(object.ra, 5), 'num'),
    cell(object.dec == null ? '—' : signedDeg(object.dec, 5), 'num'),
    cell(object.sepDeg == null ? '—' : (object.sepDeg * 60).toFixed(2), 'num'),
  );
  return tr;
}

function cell(text, className) {
  const td = document.createElement('td');
  td.className = className;
  td.textContent = text;
  return td;
}

// Every group gets a [data-count] child (the gate and the total depend on all of them); only the
// top CENSUS_INLINE are visible, the rest are summarised by the "+ k more types" tail.
function renderCensus({ groups, total }) {
  const items = groups.map((group, i) => {
    const li = document.createElement('li');
    li.dataset.count = String(group.n);
    li.hidden = i >= CENSUS_INLINE;
    const type = document.createElement('span');
    type.className = 'census-type';
    type.textContent = group.otypeDesc ?? 'Unclassified';
    const count = document.createElement('span');
    count.className = 'census-count';
    count.textContent = group.n.toLocaleString('en-US');
    li.append(type, ' ', count);
    return li;
  });
  if (groups.length > CENSUS_INLINE) {
    const more = document.createElement('li');
    more.className = 'census-more';
    more.textContent = `+ ${groups.length - CENSUS_INLINE} more types`;
    items.push(more);
  }
  ui.census.dataset.total = String(total);
  ui.census.dataset.groups = String(groups.length);
  ui.census.replaceChildren(...items);
}

function clearCensus() {
  ui.census.replaceChildren();
  delete ui.census.dataset.total;
  delete ui.census.dataset.groups;
}

function setTableStatus(text) {
  ui.tableStatus.textContent = text;
  ui.tableStatus.hidden = !text;
}

// ---- formatting ----

function deg(value, digits) {
  return value.toFixed(digits);
}

function signedDeg(value, digits) {
  return `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(digits)}`;
}

function trimNumber(value) {
  return String(Number(value.toFixed(4)));
}
