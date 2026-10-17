// Catalogue service adapter: SIMBAD TAP (synchronous ADQL, JSON output).
// Builds the ADQL, calls TAP, parses the JSON and throws ServiceErrors. No DOM access.
import { fetchFromService, shorten } from './http.js';

export const SERVICE = 'SIMBAD TAP';
export const ENDPOINT = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
export const ACKNOWLEDGEMENT =
  'This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France.';

// Every query carries TOP n. Without it SIMBAD silently truncates at 50,000 rows.
export const MAX_ROWS = 500;

/** Nearest `limit` objects within `radiusDeg` of (ra, dec), sorted by separation ascending. */
export function coneRowsAdql({ ra, dec, radiusDeg, limit }) {
  const top = checkLimit(limit);
  const [a, d, r] = [ra, dec, radiusDeg].map(adqlNumber);
  return [
    `SELECT TOP ${top} b.main_id, b.otype, od.description AS otype_desc, b.ra, b.dec,`,
    `       DISTANCE(POINT('ICRS', b.ra, b.dec), POINT('ICRS', ${a}, ${d})) AS sep_deg`,
    'FROM basic b LEFT JOIN otypedef od ON od.otype = b.otype',
    `WHERE CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', ${a}, ${d}, ${r})) = 1`,
    'ORDER BY sep_deg ASC',
  ].join('\n');
}

/** Total number of objects in the same cone. */
export function coneCountAdql({ ra, dec, radiusDeg }) {
  const [a, d, r] = [ra, dec, radiusDeg].map(adqlNumber);
  return [
    'SELECT TOP 1 COUNT(*) AS n FROM basic',
    `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${a}, ${d}, ${r})) = 1`,
  ].join('\n');
}

/**
 * @returns {Promise<Array<{mainId: string, otype: string|null, otypeDesc: string|null,
 *   ra: number|null, dec: number|null, sepDeg: number|null}>>}
 */
export async function coneSearch({ ra, dec, radiusDeg, limit = 200, timeoutMs } = {}) {
  const records = await runAdql(coneRowsAdql({ ra, dec, radiusDeg, limit }), { timeoutMs });
  return records.map((r) => ({
    mainId: r.main_id ?? '',
    otype: r.otype ?? null,
    otypeDesc: r.otype_desc ?? null,
    ra: r.ra ?? null,
    dec: r.dec ?? null,
    sepDeg: r.sep_deg ?? null,
  }));
}

/** @returns {Promise<number>} */
export async function coneCount({ ra, dec, radiusDeg, timeoutMs } = {}) {
  const records = await runAdql(coneCountAdql({ ra, dec, radiusDeg }), { timeoutMs });
  const n = records.length ? Number(records[0].n) : NaN;
  if (!Number.isFinite(n)) throw new Error('count query returned no number');
  return n;
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
