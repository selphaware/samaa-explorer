# Samaa Explorer — task specification

Browser-only sky explorer. One static page (HTML5 / CSS / vanilla JavaScript ES modules), no
framework, no build step, no CDN, no backend. The user enters RA/Dec or picks a preset, chooses
a field of view and a survey, clicks **Explore**, and the page shows a REAL survey image cutout
from CDS hips2fits plus a table of REAL SIMBAD objects in that field.

Every endpoint, column name, number and quirk below was measured live from this machine on
**2026-10-17** (Phase 0). Where this spec and a live response disagree, the live response wins —
but say so in your report.

**Definition of done** (the only one):

```
E:\CODE\samaa-explorer\.venv\Scripts\python.exe verify\smoke_test.py app\index.html
```

exits 0 and prints `GATE PASS`.

---

## 1. Deliverable layout

| File | Role |
|---|---|
| `app/index.html` | markup + mount points only; **no inline data, no inline scripts** except `<script type="module" src="js/main.js">` |
| `app/css/styles.css` | light, clean, scientific / data-platform look |
| `app/js/main.js` | UI wiring, state, loading / error / empty states, rendering |
| `app/js/services/hips2fits.js` | image service adapter: builds the cutout URL (and nothing UI-related) |
| `app/js/services/simbad.js` | catalogue service adapter: builds ADQL, calls TAP, parses JSON, throws typed errors |
| `app/js/presets.js` | the preset list (section 3) |

All six files must exist and be non-empty. Service adapters must be importable without touching
the DOM, so a new provider can be added without editing the UI. The page is served from `app/`
as web root over `http://localhost:<port>/` (the gate uses Python's `http.server`); relative
paths (`css/styles.css`, `js/main.js`) must work from that root. Add
`<link rel="icon" href="data:,">` so Chromium does not log a favicon 404 as a console error.

## 2. UI contract (ids are part of the contract — the gate looks for them first)

| Element | Requirement |
|---|---|
| `select#preset` | one `<option>` per preset in section 3, text like `Andromeda (M31)`. Changing it fills `#ra`, `#dec`, `#fov` (and may set the survey). It does **not** fetch by itself. |
| `input#ra`, `input#dec`, `input#fov` | decimal degrees, ICRS. Text or number inputs. |
| `select#survey` | option values are **full HiPS IDs** (section 4); labels human-readable. Default `CDS/P/DSS2/color`. |
| `button#explore` | the only trigger for network activity. Disabled (or ignored) while a request is in flight. |
| `img#sky-image` | the cutout. Rendered at least 200 CSS px wide. `alt` text set. |
| `#image-caption` | survey name, centre RA/Dec in decimal degrees (≥ 4 dp), FoV in degrees, and the hips2fits credit. |
| `#row-count` | exactly the shape `Showing 200 of 37554 objects within 0.75°` (shown, total, radius). |
| `table#objects-table` | `<thead>` + `<tbody>`. Columns, in order: `main_id`, `Type`, `RA (°)`, `Dec (°)`, `Sep (′)`. Rows sorted by separation ascending. |
| `[role="alert"]` elements | one for form validation (`#form-error`), one for the image panel (`#image-error`), one for the table panel (`#table-error`). Empty when there is no error. Error text names the **service** and, for `fetch()` calls, the **HTTP status** (e.g. `Catalogue error: SIMBAD TAP returned HTTP 503`). A timeout says `timed out`. |
| Loading state | while requests are in flight, the affected panel shows visible loading text (e.g. `Loading…`) and/or `aria-busy="true"`. |
| Footer | both acknowledgements (sections 4 and 5), always visible. |

Validation (client-side, before any URL is built; on failure show the message in `#form-error`
and make **no** request):

- RA: finite number, `0 ≤ RA < 360`
- Dec: finite number, `−90 ≤ Dec ≤ +90`
- FoV: finite number, `0.01 ≤ FoV ≤ 10` degrees

Cone radius for the catalogue = `FoV / 2` degrees (so FoV 1.5° → radius 0.75°).

## 3. Presets (ICRS J2000, decimal degrees — resolved via CDS Sesame and cross-checked in SIMBAD TAP, 2026-10-17)

| Label | SIMBAD main_id | RA | Dec | Default FoV (°) | Note |
|---|---|---|---|---|---|
| Andromeda (M31) | `M  31` | 10.68470833 | +41.26875 | 1.5 | otype `AGN` in SIMBAD. **The gate tests this one.** |
| Orion Nebula (M42) | `M  42` | 83.8201 | −5.3876 | 1.0 | brief said 83.8221 / −5.3911 |
| Sagittarius A* | `NAME Sgr A*` | 266.41681662 | −29.00782497 | 0.5 | dense field: 27,760 objects within 0.75° |
| M87 | `M  87` | 187.70593077 | +12.39112325 | 0.5 | |
| Hubble Ultra Deep Field | `NAME Hubble Ultra Deep Field` | 53.1625 | −27.79138889 | 0.2 | 61,280 objects within 0.75° (CDF-South) — densest preset |
| Crab Nebula (M1) | `M   1` | 83.6324 | +22.0174 | 0.3 | brief said 83.6331 / +22.0145 |
| Pleiades (M45) | `Cl Melotte   22` | 56.60083333 | +24.11388889 | 2.0 | **brief was off by 0.15° in RA** (56.75) |
| Betelgeuse | `* alf Ori` | 88.79293899 | +7.407064 | 0.5 | |

## 4. Image service — CDS hips2fits (verified live)

- Endpoint: `https://alasky.cds.unistra.fr/hips-image-services/hips2fits` (mirror with identical
  behaviour: `https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits`). GET only.
- Params: `hips` (full ID), `ra`, `dec` (decimal degrees ICRS), `fov` (decimal **degrees**,
  largest image dimension), `width`, `height` (pixels), `projection=TAN`, `coordsys=icrs`,
  `format=jpg` (or `png`). Optional for jpg/png: `stretch`, `min_cut`, `max_cut`, `cmap`.
- **Always pass `format=jpg|png`.** Without it the service returns `application/fits`
  (verified), which `<img>` cannot decode: the image stays blank and `onerror` fires.
- Verified HiPS IDs (all 200 `image/jpeg`, 400×400 in 0.7–1.1 s; 600×600 DSS2 colour takes a few seconds):
  `CDS/P/DSS2/color`, `CDS/P/PanSTARRS/DR1/color-z-zg-g`, `CDS/P/2MASS/color`.
- CORS: responds with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, OPTIONS`.
  So `<img src>` works, and so would `fetch()` + blob URL if you want the HTTP status.
- Errors: unknown HiPS → `400 application/json`
  `{"title": "Unknown HiPS", "description": "Could not find a HiPS matching ..."}`.
  **`ra=400` is NOT rejected** (200, an image of somewhere else) — only client-side validation
  protects the user. `fov=90` is accepted too (unit mistakes go unnoticed upstream).
- Recommended size: `width=height=800` for the main panel (service limit 50 Mpx).
- Credit (required by CDS, show in the UI):
  *This research made use of hips2fits, a service provided by CDS.*

Example (M31, verified): `…/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&ra=10.68470833&dec=41.26875&fov=1.5&width=800&height=800&projection=TAN&coordsys=icrs&format=jpg`

## 5. Catalogue service — SIMBAD TAP (verified live)

- Endpoint: `https://simbad.cds.unistra.fr/simbad/sim-tap/sync`
  with `REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=<url-encoded ADQL>`.
  GET and POST (`application/x-www-form-urlencoded`) both work. `FORMAT=csv` and `votable` also work.
- CORS: `Access-Control-Allow-Origin: *` on every response (200 and 400). **No proxy needed.**
- JSON shape: `{"metadata": [{"name","description","datatype","unit",...}], "data": [[...], ...]}`
  — `data` is an array of arrays in `metadata` column order. Nulls are JSON `null`.
- Table `basic`, verified columns and types:
  `oid` LONG · `main_id` CHAR · `ra` DOUBLE deg · `dec` DOUBLE deg · `otype` CHAR ·
  `otype_txt` CHAR · `sp_type` CHAR · `nbref` INT.
  **`otype_txt` is identical to `otype`** (short codes like `V*`, `HII`, `AGN`), contrary to the
  brief. For a human-readable type join `otypedef` (`otype`, `label`, `description`):
  `LEFT JOIN otypedef od ON od.otype = b.otype` → `od.description` = `Variable Star`, `HII Region`, …
- Geometry: `CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', <ra>, <dec>, <radius_deg>)) = 1`.
  **The `'ICRS'` literal is required** — `POINT(ra, dec)` / `CIRCLE(ra, dec, r)` without it is
  rejected with 400 (verified). `DISTANCE(POINT(...), POINT(...))` works and can be used in
  `ORDER BY` (returns degrees).
- **Every query must carry `TOP n`, n ≤ 500.** Without it SIMBAD silently truncates at 50,000 rows
  (OVERFLOW is flagged only in VOTable output, not JSON); an uncapped 0.75° M31 query is 3 MB /
  37,554 rows / 5.7 s and would freeze the tab when rendered. A 2° cone on Sgr A* holds 196,120
  objects. `MAXREC=n` as a request parameter also caps rows, but the gate requires `TOP` in the query text.
- Errors: HTTP **400** with `Content-Type: application/xml` (a VOTable), even when `FORMAT=json`:
  `<INFO name="QUERY_STATUS" value="ERROR">Incorrect ADQL query: …</INFO>`. Surface the status
  code; if you parse the body, pull that `INFO` text for the message.

Recommended rows query (verified: 200 rows, 20 KB, 0.9 s):

```sql
SELECT TOP 200 b.main_id, b.otype, od.description AS otype_desc, b.ra, b.dec,
       DISTANCE(POINT('ICRS', b.ra, b.dec), POINT('ICRS', {ra}, {dec})) AS sep_deg
FROM basic b LEFT JOIN otypedef od ON od.otype = b.otype
WHERE CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', {ra}, {dec}, {radius})) = 1
ORDER BY sep_deg ASC
```

Recommended count query (verified: `{"data":[[37554]]}`, 0.5 s):

```sql
SELECT TOP 1 COUNT(*) AS n FROM basic
WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius})) = 1
```

Separation in the table = `sep_deg × 60` arcminutes, 2 dp. Run both queries in parallel
(`Promise.all`), with an `AbortController` timeout (30 s) that reports `timed out`.

Acknowledgement (show in the UI):
*This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France.*
(Wenger et al. 2000, A&AS 143, 9)

## 6. Behaviour the user sees

1. Open page → presets populated, Andromeda selected by default, inputs filled, nothing fetched yet.
2. Click **Explore** → both panels show a loading state; Explore disabled.
3. Within a few seconds: DSS2 colour image of M31 (galaxy visibly in frame) with caption;
   table of the nearest 200 SIMBAD objects sorted by separation; `Showing 200 of 37554 objects within 0.75°`.
4. Change FoV or survey, click Explore → image and table replaced (old content cleared or
   visibly marked stale while loading).
5. RA `400` → inline message in `#form-error`, no request.
6. SIMBAD down (5xx / network error / timeout) → `#table-error` says so with service name and
   status; **never** the empty-state text. Empty state (`No catalogued objects in this field`)
   only when a 2xx response really has zero rows.
7. hips2fits failure → `#image-error` names the image service; the `<img>` is hidden or cleared
   rather than left as a broken icon or a stale image.

## 7. Known traps (each one was observed or verified in Phase 0)

| Trap | Reality |
|---|---|
| Missing `format` on hips2fits | FITS bytes come back; `<img>` fails silently unless `onerror` is wired |
| RA/Dec swapped | hips2fits happily returns an image of (41°, 10°); SIMBAD returns a different, sparser field. Gate checks both request URLs against M31 within 0.01° |
| FoV in arcminutes | `fov=90` is accepted and returns a 90° field. Keep FoV in degrees end to end |
| Radius = FoV instead of FoV/2 | doubles the cone area; gate tolerates 0.01–5° but the row-count sentence must state the radius you actually used |
| `otype_txt` as the "readable" type | it is the same code as `otype`; join `otypedef` for words |
| No `TOP` | 50,000-row silent truncation, multi-MB JSON, frozen tab |
| `CIRCLE(ra, dec, r)` without `'ICRS'` | HTTP 400 |
| Catalogue `catch` → empty state | indistinguishable from an empty sky; gate injects a 503 and expects to see `503` and `SIMBAD` in an alert |
| Windows + Python `http.server` serving `.js` as `text/plain` | module scripts refuse to run; the gate's server pins `text/javascript`; if you run your own server, do the same |
| `select_option` on an already-selected preset | fires no `change` event; fill inputs on load as well as on change |
| Favicon 404 | logs a console error; add `<link rel="icon" href="data:,">` |
| Main identifiers contain runs of spaces (`M  31`, `Cl Melotte   22`) | render with `textContent`; do not trim internal whitespace if you want exact matching |

## 8. Out of scope for this slice

Backend / proxy (CORS is open), authentication, canvas pixel manipulation, catalogue paging
beyond the first 200, browser support other than current Chromium.
