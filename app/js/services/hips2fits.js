// Image service adapter: CDS hips2fits. Builds cutout URLs and fetches the image bytes.
// Nothing UI-related lives here.
import { ServiceError, fetchFromService, shorten } from './http.js';

export const SERVICE = 'hips2fits';
export const ENDPOINT = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits';
export const CREDIT = 'This research made use of hips2fits, a service provided by CDS.';

// Option values are full HiPS IDs (the ID is what reproduces the image).
export const SURVEYS = [
  { id: 'CDS/P/DSS2/color', label: 'DSS2 colour' },
  { id: 'CDS/P/PanSTARRS/DR1/color-z-zg-g', label: 'Pan-STARRS DR1 colour' },
  { id: 'CDS/P/2MASS/color', label: '2MASS colour (near-infrared)' },
];
export const DEFAULT_SURVEY = 'CDS/P/DSS2/color';

/**
 * Cutout URL for a TAN-projected ICRS image. `fov` is in degrees (largest image dimension).
 * `format` is always set: without it the service answers with FITS, which <img> cannot show.
 */
export function cutoutUrl({ hips, ra, dec, fov, width = 800, height = 800, format = 'jpg' }) {
  const params = new URLSearchParams({
    hips,
    ra: String(ra),
    dec: String(dec),
    fov: String(fov),
    width: String(width),
    height: String(height),
    projection: 'TAN',
    coordsys: 'icrs',
    format,
  });
  return `${ENDPOINT}?${params}`;
}

/** Fetch the cutout and resolve with an image Blob; rejects with a ServiceError. */
export function fetchCutout(params, { timeoutMs } = {}) {
  return fetchFromService(cutoutUrl(params), {
    service: SERVICE,
    timeoutMs,
    readErrorDetail: errorDetail,
    async readBody(response) {
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (!type.startsWith('image/')) {
        throw new ServiceError(SERVICE, 'response',
          `${SERVICE} returned ${type || 'an untyped response'} instead of an image`, { status: response.status });
      }
      return response.blob();
    },
  });
}

// Errors come back as JSON: {"title": "Unknown HiPS", "description": "Could not find a HiPS matching ..."}
function errorDetail(text) {
  try {
    const body = JSON.parse(text);
    return shorten(body.description || body.title || '');
  } catch {
    return '';
  }
}
