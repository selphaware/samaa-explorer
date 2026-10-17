// UI wiring: form → validation → image + catalogue panels, with loading, error and empty states.
// All network access goes through the service adapters; this module never builds a URL itself.
import { PRESETS, DEFAULT_PRESET_ID } from './presets.js';
import { SURVEYS, DEFAULT_SURVEY, CREDIT as HIPS2FITS_CREDIT, fetchCutout } from './services/hips2fits.js';
import { coneSearch, fieldCensus } from './services/simbad.js';

const IMAGE_SIZE_PX = 800;
const TABLE_LIMIT = 200;
const CENSUS_INLINE = 8; // census groups shown before the "+ k more types" tail
const SIMBAD_OBJECT_PAGE = 'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=';

const $ = (selector) => document.querySelector(selector);
const ui = {
  form: $('#controls'),
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

// Client-side limits, checked before any URL is built.
const FIELDS = [
  { key: 'ra', valid: (v) => v >= 0 && v < 360, rule: 'RA must be a number of degrees with 0 ≤ RA < 360' },
  { key: 'dec', valid: (v) => v >= -90 && v <= 90, rule: 'Dec must be a number of degrees between −90 and +90' },
  { key: 'fov', valid: (v) => v >= 0.01 && v <= 10, rule: 'Field of view must be between 0.01 and 10 degrees' },
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

// ---- setup (synchronous, so the presets exist as soon as the module has run) ----

for (const preset of PRESETS) ui.preset.append(new Option(preset.label, preset.id));
for (const survey of SURVEYS) ui.survey.append(new Option(survey.label, survey.id));
ui.preset.value = DEFAULT_PRESET_ID;
ui.survey.value = DEFAULT_SURVEY;
ui.sort.value = DEFAULT_SORT;
markSortedColumn(currentSort());
applyPreset();

// Re-selecting the current preset fires no `change`, hence the fill on load above as well.
ui.preset.addEventListener('change', applyPreset);
// Enter in any input submits the form; the disabled submit button blocks it while busy.
ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  explore();
});
for (const key of ['ra', 'dec', 'fov']) {
  ui[key].addEventListener('input', () => ui[key].removeAttribute('aria-invalid'));
}
ui.sort.addEventListener('change', renderObjects);

function applyPreset() {
  const preset = PRESETS.find((p) => p.id === ui.preset.value);
  if (!preset) return;
  ui.ra.value = String(preset.ra);
  ui.dec.value = String(preset.dec);
  ui.fov.value = String(preset.fov);
  for (const { key } of FIELDS) ui[key].removeAttribute('aria-invalid');
}

// ---- explore ----

async function explore() {
  if (busy) return;
  const { values, problems } = readForm();
  if (problems.length) {
    ui.formError.textContent = problems.map((p) => p.message).join(' ');
    problems[0].input.focus();
    return;
  }
  ui.formError.textContent = '';

  const survey = SURVEYS.find((s) => s.id === ui.survey.value) ?? { id: ui.survey.value, label: ui.survey.value };
  const view = { ...values, radius: values.fov / 2, survey, target: presetAt(values.ra, values.dec) };

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
    const text = raw.replace(/^−/, '-'); // accept a typographic minus sign
    const value = DECIMAL.test(text) ? Number(text) : NaN;
    if (Number.isFinite(value) && field.valid(value)) {
      input.removeAttribute('aria-invalid');
      values[field.key] = value;
    } else {
      input.setAttribute('aria-invalid', 'true');
      problems.push({ input, message: `${field.rule} (got “${raw || 'nothing'}”).` });
    }
  }
  return { values, problems };
}

function setBusy(on) {
  busy = on;
  ui.explore.disabled = on;
  ui.explore.textContent = on ? 'Loading…' : 'Explore';
}

function presetAt(ra, dec) {
  return PRESETS.find((p) => Math.abs(p.ra - ra) < 1e-9 && Math.abs(p.dec - dec) < 1e-9)?.label ?? null;
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
  const where = target ? `${target}, centred on` : 'Sky centred on';
  return `${survey.label} survey image: ${where} RA ${deg(ra, 4)}°, Dec ${signedDeg(dec, 4)}°, ${fov}° field of view`;
}

function renderCaption({ ra, dec, fov, survey, target }) {
  const surveyLine = line('caption-survey', `${survey.label} `);
  const hipsId = document.createElement('code');
  hipsId.textContent = survey.id;
  surveyLine.append(hipsId);
  if (target) surveyLine.append(` · ${target}`);
  ui.caption.replaceChildren(
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
