// Catalogue service adapter: SIMBAD TAP (synchronous ADQL, JSON output).
// Builds the ADQL, calls TAP, parses the JSON and throws ServiceErrors. No DOM access.
import { ServiceError, fetchFromService, shorten } from './http.js';

export const SERVICE = 'SIMBAD TAP';
export const ENDPOINT = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
export const ACKNOWLEDGEMENT =
  'This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France.';

// Every query carries TOP n. Without it SIMBAD silently truncates at 50,000 rows.
export const MAX_ROWS = 500;
// One census row per object type: the otypedef vocabulary bounds it (154 groups in the densest
// field the FoV limit allows), so this cap never truncates.
const CENSUS_TOP = 500;

/**
 * The `limit` most-referenced objects within `radiusDeg` of (ra, dec): nbref descending, ties by
 * separation ascending. ADQL sort keys must be bare names; `ORDER BY b.nbref` is an HTTP 400.
 */
export function coneRowsAdql({ ra, dec, radiusDeg, limit }) {
  const top = checkLimit(limit);
  const [a, d, r] = [ra, dec, radiusDeg].map(adqlNumber);
  return [
    `SELECT TOP ${top} b.main_id, b.otype, od.description AS otype_desc, b.nbref, b.ra, b.dec,`,
    `       DISTANCE(POINT('ICRS', b.ra, b.dec), POINT('ICRS', ${a}, ${d})) AS sep_deg`,
    'FROM basic b LEFT JOIN otypedef od ON od.otype = b.otype',
    `WHERE ${inCone(a, d, r)}`,
    'ORDER BY nbref DESC, sep_deg ASC',
  ].join('\n');
}

/** Object counts by type description over the whole cone; SUM(n) is the field total. */
export function censusAdql({ ra, dec, radiusDeg }) {
  const [a, d, r] = [ra, dec, radiusDeg].map(adqlNumber);
  return [
    `SELECT TOP ${CENSUS_TOP} od.description AS otype_desc, COUNT(*) AS n`,
    'FROM basic b LEFT JOIN otypedef od ON od.otype = b.otype',
    `WHERE ${inCone(a, d, r)}`,
    'GROUP BY od.description',
    'ORDER BY n DESC',
  ].join('\n');
}

// The 'ICRS' literal is required: POINT(ra, dec) / CIRCLE(ra, dec, r) without it is an HTTP 400.
function inCone(a, d, r) {
  return `CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', ${a}, ${d}, ${r})) = 1`;
}

/**
 * Rows in server order (most referenced first). `nbref` is never null in SIMBAD (0 = unreferenced).
 * @returns {Promise<Array<{mainId: string, otype: string|null, otypeDesc: string|null,
 *   nbref: number|null, ra: number|null, dec: number|null, sepDeg: number|null}>>}
 */
export async function coneSearch({ ra, dec, radiusDeg, limit = 200, timeoutMs } = {}) {
  const records = await runAdql(coneRowsAdql({ ra, dec, radiusDeg, limit }), { timeoutMs });
  return records.map((r) => ({
    mainId: r.main_id ?? '',
    otype: r.otype ?? null,
    otypeDesc: r.otype_desc ?? null,
    nbref: r.nbref == null ? null : Number(r.nbref),
    ra: r.ra ?? null,
    dec: r.dec ?? null,
    sepDeg: r.sep_deg ?? null,
  }));
}

/**
 * Groups by count descending. `otypeDesc` is null for objects whose otype has no otypedef row;
 * that group is real and counts towards the total.
 * @returns {Promise<{groups: Array<{otypeDesc: string|null, n: number}>, total: number}>}
 */
export async function fieldCensus({ ra, dec, radiusDeg, timeoutMs } = {}) {
  const records = await runAdql(censusAdql({ ra, dec, radiusDeg }), { timeoutMs });
  const groups = records.map((r) => ({ otypeDesc: r.otype_desc ?? null, n: Number(r.n) }));
  if (groups.some((g) => !Number.isInteger(g.n) || g.n < 0)) {
    throw new ServiceError(SERVICE, 'response', `${SERVICE} returned a census without integer counts`);
  }
  return { groups, total: groups.reduce((sum, g) => sum + g.n, 0) };
}

/** Run one ADQL query; resolves with one plain object per row, keyed by column name. */
export function runAdql(adql, { timeoutMs } = {}) {
  const params = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: adql });
  return fetchFromService(`${ENDPOINT}?${params}`, {
    service: SERVICE,
    timeoutMs,
    readErrorDetail: errorDetail,
    async readBody(response) {
      const body = await response.json();
      if (!body || !Array.isArray(body.metadata) || !Array.isArray(body.data)) {
        throw new Error('JSON without metadata/data arrays');
      }
      // `data` rows are arrays in `metadata` column order.
      const names = body.metadata.map((column) => String(column.name).toLowerCase());
      return body.data.map((values) => Object.fromEntries(names.map((name, i) => [name, values[i]])));
    },
  });
}

function checkLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) {
    throw new RangeError(`row limit must be an integer between 1 and ${MAX_ROWS}, got ${limit}`);
  }
  return limit;
}

// Plain decimal for ADQL (never exponent notation), at most 10 decimal places.
function adqlNumber(value) {
  if (!Number.isFinite(value)) throw new RangeError(`not a finite number: ${value}`);
  return value.toFixed(10).replace(/\.?0+$/, '') || '0';
}

// Errors are VOTable XML even when FORMAT=json:
// <INFO name="QUERY_STATUS" value="ERROR">Incorrect ADQL query: ...</INFO>
function errorDetail(text) {
  const match = /<INFO[^>]*name="QUERY_STATUS"[^>]*value="ERROR"[^>]*>([\s\S]*?)<\/INFO>/i.exec(text);
  if (!match) return '';
  return shorten(match[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'));
}
