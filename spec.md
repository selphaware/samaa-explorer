# Samaa Explorer — task specification

Browser-only sky explorer. One static page (HTML5 / CSS / vanilla JavaScript ES modules), no
framework, no build step, no CDN, no backend. The user enters RA/Dec or picks a preset, chooses
a field of view and a survey, clicks **Explore**, and the page shows a REAL survey image cutout
from CDS hips2fits plus a table of REAL SIMBAD objects in that field.

Every endpoint, column name, number and quirk below was measured live from this machine on
**2026-10-17** (Phase 0, re-measured the same evening for revision 1 — notability ordering and the
field census — and again for revision 2 — the preset library, Custom positions and shareable URLs).
Where this spec and a live response disagree, the live response wins — but say so in your report.

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
| `app/js/presets.js` | **loader** for the preset library (section 3): `fetch('data/presets.json')`, validate the shape, expose the list in file order and a lookup by `id`. No DOM |
| `app/data/presets.json` | the preset library — **generated data** (section 3). Read by `presets.js`; never hand-edited, never replaced by a hard-coded list |
| `app/js/services/http.js` | shared fetch plumbing (added in slice 1): one `AbortController` timeout per request; every failure becomes a `ServiceError` carrying service name, kind and HTTP status. No DOM |
| `tools/preset_catalogue.csv`, `tools/build_presets.py` (repo root) | the curated list of **names** and the resolver that turns it into `app/data/presets.json` (section 3). Outside `app/`; the gate does not run them and the build agent does not edit them |
| `serve.py` (repo root) | static server for humans: serves `app/` on `http://localhost:8765` (port as first argument) with `.js` pinned to `text/javascript` and `.css` to `text/css`; standard library only. **The gate neither requires nor uses it** |
| `README.md` (repo root) | what the page is, how to run it, how to verify it, both acknowledgements, architecture notes, how to add a preset |

The six `app/` files above the `presets.json` row plus `app/data/presets.json` must exist and be
non-empty — the gate checks exactly those seven; `http.js` is part of the layout but not gate-checked.
Service adapters must be importable without touching the DOM, so a new provider can be added without
editing the UI. The page is served from `app/` as web root over `http://localhost:<port>/` (the gate
uses Python's `http.server` with pinned MIME types, `.json` as `application/json`; `serve.py` does the
same for a human); relative paths (`css/styles.css`, `js/main.js`, `data/presets.json`) must work from
that root. Add `<link rel="icon" href="data:,">` so Chromium does not log a favicon 404 as a console
error.

## 2. UI contract (ids are part of the contract — the gate looks for them first)

| Element | Requirement |
|---|---|
| `select#preset` | **First option `value="custom"`, text `Custom`.** Then one `<optgroup label="<category>">` per category in library order (`Galaxies`, `Nebulae`, `Star clusters`, `Stars`, `Deep fields`, `Exotic & high-energy`), each holding one `<option value="<id>">` per preset of that category, text = the label, in file order. ≥ 250 named options (345 on 2026-10-17). Changing to a named preset fills `#ra`, `#dec`, `#fov` only — the survey is the user's choice and persists across presets — stores `localStorage['samaa.lastPreset'] = <id>` and does **not** fetch. **Custom semantics:** on `input` in any of `#ra`, `#dec`, `#fov` set the select to `custom`, keep `{ra, dec, fov}` (the raw strings as typed) as the Custom set in memory and in `localStorage['samaa.custom']` (JSON), and set `samaa.lastPreset` to `custom`. Selecting `custom` restores the stored set, or leaves the inputs as they are if nothing is stored. **On load**, in this order: a URL hash wins (see *Shareable URL* below); else if `samaa.lastPreset` is `custom` and a Custom set is stored, restore it and select Custom; else select `m31` and fill its values. Only Custom is remembered across reloads; a named last selection falls back to `m31`. Nothing is fetched on load unless a hash asks for it. Filtering (next row) never changes the selection. |
| `input#preset-filter` | `type="search"`, placeholder `Filter presets…`, directly above the select. On `input`: trim the query; case-insensitive substring match against each preset's label **and** `main_id`; a non-matching named option gets both the `hidden` and the `disabled` attribute; an `<optgroup>` with no matching option gets `hidden`; the `custom` option is never filtered. An empty query restores everything. The current selection never changes because of filtering, even when the selected option is filtered out. Playwright and the gate judge options by these properties, not by geometry (section 7). |
| `input#ra`, `input#dec`, `input#fov` | decimal degrees, ICRS. Text or number inputs. |
| `select#survey` | option values are **full HiPS IDs** (section 4); labels human-readable. Default `CDS/P/DSS2/color`. |
| `button#explore` | the only trigger for network activity. Disabled (or ignored) while a request is in flight. |
| `img#sky-image` | the cutout. Rendered at least 200 CSS px wide. `alt` text set. |
| `#image-caption` | survey human label **and** its full HiPS ID (the ID is what reproduces the image), centre RA/Dec in decimal degrees (≥ 4 dp), FoV in degrees, the hips2fits credit, **and the target**: the preset label and `main_id` (e.g. `Andromeda (M31) · M  31`) when a named preset was active at Explore time, `Custom position` when Custom was. |
| `#row-count` | exactly the shape `Showing 200 of <total> objects within 0.75°` (shown, total, radius). `<total>` is the **sum of the census counts** (`SUM(n)` over every group, section 5) at run time — 37,554 for M31 at 0.75° on 2026-10-17, identical to `COUNT(*)`; it drifts as SIMBAD grows, so **never hard-code it**. Thousands separators are fine (`37,554`). If the census query failed but rows succeeded: `Showing 200 objects within 0.75° (total unavailable)`. |
| `table#objects-table` | `<thead>` + `<tbody>`. Columns, in order: `main_id`, `Type`, `Refs`, `RA (°)`, `Dec (°)`, `Sep (′)`. `Type` shows `od.description` (falls back to the `otype` code when the join yields null); the raw `otype` code goes in the cell's `title`. `Refs` = `nbref` (SIMBAD's reference count), an integer, thousands-separated (`13,839`). **Default order: `Refs` descending, ties broken by `Sep` ascending** — exactly the order the server returns; the client does **not** re-sort on load. The active sort column's `<th>` carries `aria-sort` (`descending` on load, `ascending` after switching to separation). |
| `select#sort` | in the table panel head. Exactly two options: value `refs`, label `Most studied` (selected on load) and value `sep`, label `Nearest to centre`. Changing it re-sorts the 200 loaded rows **client-side** with a numeric compare (`"13,839"` as a string sorts wrong); **no network request**. |
| `#field-census` | the field census, rendered above the table once the census query returns. The container carries `data-total="<SUM(n)>"` and `data-groups="<number of groups>"` as plain integers (no separators). **One child element per group, every group rendered**, ordered by count descending, each carrying `data-count="<n>"` (plain integer) and showing the type description — `Unclassified` for the `null` group — and the thousands-separated count, e.g. `Star 4,728`. Children beyond the first 8 carry the `hidden` attribute; when more than 8 groups exist, append a visible `+ k more types` element (k = groups − 8). The gate sums every `[data-count]` (hidden or not) and requires it to equal `data-total` and the `#row-count` total. Cleared when a new Explore starts. |
| `[role="alert"]` elements | one for form validation (`#form-error`), one for the image panel (`#image-error`), one for the table panel (`#table-error`). Empty when there is no error. Error text names the **service** and, for `fetch()` calls, the **HTTP status** (e.g. `Catalogue error: SIMBAD TAP returned HTTP 503`). A timeout says `timed out`. |
| Loading state | while requests are in flight, the affected panel shows visible loading text (e.g. `Loading…`) and/or `aria-busy="true"`. |
| Footer | both acknowledgements (sections 4 and 5), always visible. |

Validation (client-side, before any URL is built; on failure show the message in `#form-error`
and make **no** request):

- RA: finite number, `0 ≤ RA < 360`
- Dec: finite number, `−90 ≤ Dec ≤ +90`
- FoV: finite number, `0.01 ≤ FoV ≤ 10` degrees

Cone radius for the catalogue = `FoV / 2` degrees (so FoV 1.5° → radius 0.75°).

**Shareable URL.** A view is a URL. When Explore passes validation and the requests go out, write the
hash with `history.replaceState(null, '', '#ra=<n>&dec=<n>&fov=<n>&hips=<encodeURIComponent(hipsId)>[&preset=<id>]')`
— no navigation, no `hashchange`. `ra`/`dec`/`fov` are the validated numbers as sent to the services;
`preset` is the selected named preset's `id` and is **omitted when Custom is active**. (The hash is
written at request time rather than after the responses so that a failing service still leaves a
URL to retry; the gate reads it after a successful Explore.) On load with a non-empty hash: parse
`location.hash.slice(1)` with `URLSearchParams`; `ra`, `dec`, `fov`, `hips` are all required; validate
`ra`/`dec`/`fov` with the rules above and require `hips` to be one of the `select#survey` option
values; fill the three inputs; set the survey; if `preset` is present and is a known `id`, select it,
otherwise select `custom` **and** store the values as the Custom set (a shared custom view becomes the
user's current custom position); then run Explore automatically, with no click. **Matching coordinates
never auto-select a preset** — only `preset=<id>` does; the gate opens the M42 coordinates without
`preset` and expects `custom`. An invalid or incomplete hash → the usual message in `#form-error`
(e.g. `Link has an invalid RA: 400`), nothing fetched, the select left at the plain-load default. The
page parses the hash on load only; it does not listen to `hashchange`.

## 3. Presets — the library (`app/data/presets.json`, generated 2026-10-17)

The preset library is **data, not code**. `tools/preset_catalogue.csv` lists 345 named places — no
coordinates — in six categories, and `tools/build_presets.py` (standard library, pinned interpreter)
resolves every name through SIMBAD TAP (`ident` → `basic` → `otypedef`), falls back to CDS Sesame
for the rest, refuses to write anything if a single name stays unresolved or two entries land within
0.001° of each other, and writes `app/data/presets.json` with provenance. On 2026-10-17 all 345 names
resolved: 339 in four batch queries, 5 one by one (`Cyg X-1` → `HD 226868`, `Cyg X-3`, `Sco X-1`,
`GRS 1915+105`, `1E 0657-56`), 1 via Sesame (`SGR 1806-20` → `PSR J1808-2024`), 0 failed. The
build agent **reads** that file; it never edits it. If an entry looks wrong, report its `id` — the fix
is a CSV row and a re-run of the tool, both outside `app/`.

File shape (real first entry):

```json
{ "generated_at": "2026-10-17T22:51:06Z",
  "source": "SIMBAD TAP (basic/ident) via tools/build_presets.py",
  "catalogue": "tools/preset_catalogue.csv",
  "fov_rule": "fov_override, else clamp(1.5 x galdim_majaxis[arcmin] / 60, 0.1, 3.0) deg, else category default {...}",
  "count": 345,
  "presets": [
    { "id": "m31", "label": "Andromeda (M31)", "category": "Galaxies", "query_name": "M 31",
      "main_id": "M  31", "ra": 10.68470833, "dec": 41.26875, "fov": 1.5, "fov_source": "override",
      "size_arcmin": 199.53, "otype": "AGN", "otype_desc": "Active Galaxy Nucleus", "nbref": 13839,
      "resolved_by": "SIMBAD TAP", "resolved_via": "tap-batch", "resolved_at": "2026-10-17" },
    ... ] }
```

- `presets` is sorted by category in the order **Galaxies · Nebulae · Star clusters · Stars · Deep
  fields · Exotic & high-energy**, then by label in natural order (`M2` before `M10`). Render the
  select in exactly that order: one `<optgroup>` per category, options in file order.
- Fields the page relies on: `id` (stable slug = option value), `label` (option text), `category`
  (optgroup label), `main_id` (SIMBAD identifier **verbatim**, runs of spaces included — it is what
  the filter matches and the caption shows), `ra`/`dec` (ICRS J2000 degrees, 8 dp), `fov` (degrees,
  2 dp). Provenance fields: `query_name` (the CSV name), `fov_source` (`override` | `size` |
  `category`), `size_arcmin` (`galdim_majaxis`, null when SIMBAD has none), `otype`, `otype_desc`
  (null allowed — today none is), `nbref`, `resolved_by` (`SIMBAD TAP` or `CDS Sesame (...)`),
  `resolved_via`, `resolved_at` (`YYYY-MM-DD`).
- Counts on 2026-10-17: Galaxies 81 · Nebulae 50 · Star clusters 107 · Stars 47 · Deep fields 18 ·
  Exotic & high-energy 42 = **345** — all 110 Messier and all 109 Caldwell objects among them, the 25
  brightest stars and the famous nearby ones, 18 deep/survey fields, 42 high-energy and landmark
  objects. The gate's floor is **250**. FoVs: 35 from CSV overrides, 224 from SIMBAD's angular size,
  86 category defaults (Galaxies 0.5, Nebulae 1.0, Star clusters 1.0, Stars 0.5, Deep fields 0.2,
  Exotic 0.3); range 0.1–3.0°.
- `js/presets.js` loads the file: `fetch('data/presets.json')` relative to the page, parse, check that
  `presets` is a non-empty array whose entries carry `id`, `label`, `category`, `main_id`, `ra`, `dec`,
  `fov`, expose the list and a `byId` lookup. A failed or malformed fetch is an error in
  `#form-error` (`Preset library could not be loaded: HTTP 404`) — never an empty select, never a
  hard-coded fallback list. Populate the select as soon as the promise resolves (the gate waits up to
  6 s for the `Andromeda (M31)` option); the default selection, the stored Custom set and the URL hash
  are applied after the library has loaded.
- The eight original presets keep their labels and FoVs and remain the gate's anchors (M31 is the one
  the gate explores):

| `id` | Label | `main_id` | RA | Dec | FoV (°) |
|---|---|---|---|---|---|
| `m31` | Andromeda (M31) | `M  31` | 10.68470833 | +41.26875 | 1.5 |
| `m42` | Orion Nebula (M42) | `M  42` | 83.8201 | −5.3876 | 1.0 |
| `sgr-a-star` | Sagittarius A* | `NAME Sgr A*` | 266.41681662 | −29.00782497 | 0.5 |
| `m87` | M87 | `M  87` | 187.70593077 | +12.39112325 | 0.5 |
| `hudf` | Hubble Ultra Deep Field | `NAME Hubble Ultra Deep Field` | 53.1625 | −27.79138889 | 0.2 |
| `m1` | Crab Nebula (M1) | `M   1` | 83.6324 | +22.0174 | 0.3 |
| `m45` | Pleiades (M45) | `Cl Melotte   22` | 56.60083333 | +24.11388889 | 2.0 |
| `betelgeuse` | Betelgeuse | `* alf Ori` | 88.79293899 | +7.407064 | 0.5 |

- Live spot check: the gate picks five `id`s with `random.Random(20261017).sample(sorted(ids), 5)` and
  re-resolves their `main_id` through TAP; a drift above 0.01° or an unknown `main_id` means SIMBAD
  changed and the tool must be re-run — it is reported as a deliverable failure naming the preset.
- **No Solar System bodies** (they move) and **no proper-motion correction**: every position is
  SIMBAD's ICRS J2000 value on `resolved_at`. Barnard's Star moves 10″/yr; that is fine for a 0.5°
  field.
- Adding a preset: one CSV row (`id,label,category,query_name,fov_override`; `query_name` in SIMBAD's
  own form — `NGC 869`, not `C 14`, because Caldwell numbers are not SIMBAD identifiers, see section 7),
  run the tool, commit the JSON.

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
  So `<img src>` works, and so would `fetch()` + blob URL if you want the HTTP status (slice 1
  does this). With blob URLs, `URL.revokeObjectURL` the previous one **before** assigning a new
  `src`, or every Explore leaks an 800×800 image. The gate cannot see this; the reviewer checks it
  by reading the code.
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
  The join yields `null` for objects whose `otype` has no `otypedef` row: 2,714 objects in all of
  SIMBAD, none in the M31 cone, 17 within 1° of Sgr A*, 23 within 5°. Show them as `Unclassified`.
- `nbref` (reference count — the notability measure) is **never null**: `COUNT(*) … WHERE nbref IS NULL`
  is 0 over the whole table (verified), so no `COALESCE` is needed. It is 0 for unreferenced objects
  (66 of 37,554 in the M31 cone). In the M31 cone it runs from 13,839 (`M  31`) downwards; the 200th
  most-referenced object has 35, and there are only 58 distinct values in those 200 rows — ties are
  common, hence the secondary `sep_deg ASC`.
- **ADQL `ORDER BY` takes bare column names or ordinals only.** `ORDER BY b.nbref DESC` is rejected
  with HTTP 400 `Incorrect ADQL query: Encountered "."` (verified 2026-10-17). Write
  `ORDER BY nbref DESC, sep_deg ASC` (accepted) — or `ORDER BY 4 DESC, 7 ASC`.
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

The catalogue makes **exactly two requests per Explore**: the rows query and the census query,
in parallel. There is no separate `COUNT(*)` query any more — the census sum is the total.

Rows query — the 200 most-referenced objects in the cone (verified 2026-10-17: 200 rows, 19 KB,
0.4–1.0 s by GET; for M31 at 0.75° it returns `M  31` 13,839 refs / 0.00′, `M  32` 2,254 / 24.22′,
`M 110` 1,378 / 36.54′, `V* EG And` 310 / 41.28′, `V* S And` 191 / 0.24′, `Bol 225` 137 / 20.50′,
`NGC   206` 129 / 40.19′, … down to 35 refs; separations reach 44.98′, i.e. the whole cone):

```sql
SELECT TOP 200 b.main_id, b.otype, od.description AS otype_desc, b.nbref, b.ra, b.dec,
       DISTANCE(POINT('ICRS', b.ra, b.dec), POINT('ICRS', {ra}, {dec})) AS sep_deg
FROM basic b LEFT JOIN otypedef od ON od.otype = b.otype
WHERE CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', {ra}, {dec}, {radius})) = 1
ORDER BY nbref DESC, sep_deg ASC
```

(`ORDER BY b.nbref …`, the obvious spelling, is an HTTP 400 — see above.) Columns come back in this
order: `main_id, otype, otype_desc, nbref, ra, dec, sep_deg`.

Census query — object counts by type for the whole cone (verified: M31 at 0.75° → 96 groups,
2.8 KB, 0.7 s by GET; `SUM(n)` = 37,554 = the old `COUNT(*)`):

```sql
SELECT TOP 500 od.description AS otype_desc, COUNT(*) AS n
FROM basic b LEFT JOIN otypedef od ON od.otype = b.otype
WHERE CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', {ra}, {dec}, {radius})) = 1
GROUP BY od.description
ORDER BY n DESC
```

- The number of groups is bounded by the `otypedef` vocabulary: 96 for M31, 106 for Sgr A* at 1°,
  154 for Sgr A* at 5° (the densest field the FoV limit allows). `TOP 500` therefore never
  truncates; it is there because every query must carry `TOP`.
- The `null`-description group arrives as a JSON `null` in column 0 (e.g. `[null, 23]`, ranked
  81st of 154 for Sgr A* at 5°). Render it as `Unclassified`; it counts towards the total.
- M31 top groups on 2026-10-17: `Star 4,728 · Red Supergiant Candidate 3,871 · Variable Star 3,072 ·
  Asymptotic Giant Branch Star Candidate 2,876 · HII Region 2,808 · RR Lyrae Variable 2,126 ·
  Cluster of Stars 2,077 · Emission Object 1,796` (then Pulsating Variable 1,610, Planetary
  Nebula 1,204, X-ray Source 1,186, Classical Cepheid Variable 1,133; the tail is groups of 1).

Worst case (verified 2026-10-17, GET, Sgr A*): radius 1° → rows 1.1–3.5 s, census 106 groups /
37,147 objects; radius 5° (FoV 10°, the maximum) → rows 3.5–4.6 s, census 154 groups / 927,141
objects in 4.2–8.2 s, the old `COUNT(*)` 8.5 s. Everything stays well inside the 30 s timeout, so
the FoV limit stands. SIMBAD had a slow spell that evening in which even `SELECT TOP 1 COUNT(*)`
took 5–11 s; twenty minutes later the same queries took 0.3–1.8 s. Keep the 30 s timeout and show
the loading state.

Separation in the table = `sep_deg × 60` arcminutes, 2 dp. Run both queries in parallel with
`Promise.allSettled` — **not** `Promise.all`, which would discard 200 good rows because the census
query failed — each with its own `AbortController` timeout (30 s) that reports `timed out`.
Outcomes:

| rows | census | render |
|---|---|---|
| ok | ok | census + table + `Showing 200 of <total> objects within 0.75°` (total = `SUM(n)`) |
| ok | failed | table + `Showing 200 objects within 0.75° (total unavailable)`; `#field-census` empty; `#table-error` carries the census query's service name and status |
| failed | any | error state in `#table-error`; table body and census cleared; `#row-count` empty |
| ok, 0 rows | ok, no groups | empty state `No catalogued objects in this field` |

Acknowledgement (show in the UI):
*This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France.*
(Wenger et al. 2000, A&AS 143, 9)

## 6. Behaviour the user sees

1. Open page → the library loads (345 presets in six groups behind a `Custom` first option),
   Andromeda (M31) selected by default, inputs filled, nothing fetched yet.
2. Click **Explore** → both panels show a loading state; Explore disabled.
3. Within a few seconds: DSS2 colour image of M31 (galaxy visibly in frame) with caption; the
   field census above the table (2026-10-17 values: `Star 4,728 · Red Supergiant Candidate 3,871 ·
   Variable Star 3,072 · Asymptotic Giant Branch Star Candidate 2,876 · HII Region 2,808 ·
   RR Lyrae Variable 2,126 · Cluster of Stars 2,077 · Emission Object 1,796 · + 88 more types`);
   the table of the 200 most-referenced SIMBAD objects — `M  31` first, `M  32` and `M 110` next,
   `NGC   206` on the first screen — with `Showing 200 of <total> objects within 0.75°`
   (`<total>` = the live census sum — 37,554 on 2026-10-17).
4. Switch `#sort` to `Nearest to centre` → the same 200 rows re-order by `Sep` ascending
   (`M  31` at 0.00′ first, then `V* S And` at 0.24′ …) with **no network request**; switch back →
   `Refs` descending again.
5. Change FoV or survey, click Explore → image, census and table replaced (old content cleared or
   visibly marked stale while loading).
6. RA `400` → inline message in `#form-error`, no request.
7. SIMBAD down (5xx / network error / timeout) → `#table-error` says so with service name and
   status; **never** the empty-state text. Empty state (`No catalogued objects in this field`)
   only when a 2xx response really has zero rows.
8. hips2fits failure → `#image-error` names the image service; the `<img>` is hidden or cleared
   rather than left as a broken icon or a stale image.
9. Type RA `83.82` over a preset → the select shows **Custom**; pick Andromeda → the inputs change to
   M31's values; pick Custom → `83.82` is back. Reload → still Custom with `83.82`, nothing fetched.
10. Type `crab` in the filter → only `Crab Nebula (M1)` and `Crab Pulsar (PSR B0531+21)` (plus
    Custom) remain selectable and the empty groups disappear; clear the filter → all 345 are back;
    the selection never moved.
11. Explore → the URL becomes `…/index.html#ra=10.68470833&dec=41.26875&fov=1.5&hips=CDS%2FP%2FDSS2%2Fcolor&preset=m31`;
    paste it into a new tab → the same view loads and runs by itself (Andromeda selected). A link
    without `preset=` (e.g. `#ra=83.8201&dec=-5.3876&fov=1.0&hips=CDS%2FP%2FDSS2%2Fcolor`) opens as
    Custom and runs; a link with RA `400` shows the validation message and fetches nothing.
12. After Explore the caption names the target (`Andromeda (M31) · M  31`, or `Custom position`).

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
| `ORDER BY b.nbref DESC` (qualified sort key) | HTTP 400 `Encountered "."`; ADQL sort keys are bare names or ordinals: `ORDER BY nbref DESC, sep_deg ASC` |
| Client re-sort on load, or sorting `Refs` as strings | `"13,839" < "35"` lexically; the gate reports the first out-of-order row. Keep `nbref` a number and render the server order on load |
| `#sort` change triggers a new query | the gate counts catalogue requests after the switch; sort the loaded rows in memory |
| Census renders only the top 8 | the sum of `[data-count]` no longer equals `data-total` / `#row-count`; render every group, `hidden` beyond 8, plus `+ k more types` |
| `null` type description in the census or table | a real group (objects whose `otype` has no `otypedef` row); label it `Unclassified`, never drop it — it is part of the total |
| Catalogue `catch` → empty state | indistinguishable from an empty sky; gate injects a 503 and expects to see `503` and `SIMBAD` in an alert |
| Windows + Python `http.server` serving `.js` as `text/plain` | module scripts refuse to run; the gate's server pins `text/javascript`; if you run your own server, do the same |
| `select_option` on an already-selected preset | Playwright 1.64 dispatches `input` **and** `change` even when the value does not change (measured; an earlier version of this row said the opposite). A real user re-picking the same option fires nothing — so fill the inputs on load as well as on `change`, and make the handler idempotent |
| Favicon 404 | logs a console error; add `<link rel="icon" href="data:,">` |
| Main identifiers contain runs of spaces (`M  31`, `Cl Melotte   22`) | render with `textContent`; do not trim internal whitespace if you want exact matching |
| Caldwell numbers (`C 14`) as SIMBAD identifiers | they are **not** identifiers: all 109 of `C 1`…`C 109` miss in TAP and `C 14` is "Nothing found" in Sesame. The catalogue carries the NGC/IC/Melotte/Sharpless/NAME designation (`NGC 869` for C14, `Cl Melotte 25` for C41, `Sh 2-155` for C9, `NAME Coalsack` for C99) and keeps `(C14)` in the label |
| Attributing a batch `ident` answer by string equality | TAP matches `ident.id` ignoring case and whitespace (`M 31`, `M31`, `m  31` all hit) but returns the **canonical** spelling: `M  31`, `NGC   224`, `X Cyg X-1` for `Cyg X-1`. `UNION` is rejected (HTTP 400 "UNION is not supported in ADQL"), ADQL has no `CASE`/`VALUES`. The tool compares whitespace-free lower-case keys and re-asks the leftovers one at a time |
| Long `IN` lists via GET | 400 names (6.6 KB URL) answer in 0.7 s; 500 names (8.2 KB) → **HTTP 414** from Apache. POST takes 1000 names in 1.2 s. The tool uses POST, 100 per batch |
| `galdim_majaxis` | arcminutes (`TAP_SCHEMA`: unit `arcmin`, ucd `phys.angSize.smajAxis`). Null for 6 Messier (M 8, 40, 43, 73, 78, 82) and 13 Caldwell objects; some values are 10× off (M 36 and NGC 6231 = 120′, M 39 = 120.4′, NGC 2362 = 104′) → `fov_override` in the CSV; tiny values (0.1′ planetaries) hit the 0.1° floor |
| Sesame answers | HTTP 200 with **`Content-Type: text/plain`** whose body is XML; a hit has `<Resolver name="Sc=Simbad …">` with `<jradeg>`, `<jdedeg>`, `<otype>`, `<oname>` (= main_id), `<nrefs>`; a miss is **still HTTP 200** with `<INFO> *** Nothing found *** </INFO>` and no `<Resolver>`; bodies carry stray `<!--- … -->` comments, so parse with regexes, not an XML parser |
| Judging filtered options by visibility | every `<option>` of a closed `<select>` has zero client rects, `checkVisibility() === false` and Playwright `is_visible() === false` — selectable or not. Test the `hidden`/`disabled` properties and the optgroup's `hidden`; keyboard navigation does skip hidden/disabled options and hidden optgroups |
| `select_option` on a hidden/disabled option or a missing value | Playwright waits for it and **times out** (default 30 s) instead of failing fast — the gate never does it; your filter must not hide the selected option's value from the select itself |
| `page.goto` to the same page with a different hash | a same-document navigation: no reload, `hashchange` only, `goto` returns `None`. The gate opens a **fresh page** for the hash round-trip. `page.reload()` keeps the hash; `history.replaceState` changes `location.hash` without `hashchange`; assigning `location.hash` fires `hashchange` — the page uses `replaceState` and parses the hash on load only |
| `localStorage` and the host name | `http://localhost:8765` and `http://127.0.0.1:8765` are different origins with separate storage; the gate keeps one host for the whole run |
| Storing the preset library in `presets.js` | the gate counts options against `data/presets.json` and spot-checks five entries live; a hard-coded list that drifts from the JSON fails the set-equality check. Load the JSON |

## 8. Out of scope for this slice

Backend / proxy (CORS is open), authentication, canvas pixel manipulation, catalogue paging
beyond the first 200, browser support other than current Chromium.

## 9. Look and layout (the gate cannot judge this — the human reviews it)

- Light theme. Near-white page background, one dark neutral for text, one muted accent
  (a desaturated blue) for the Explore button, links and focus rings. No gradients, no
  shadows heavier than a 1 px border, no decorative astronomy imagery or starfield backgrounds.
- Typography: a system sans-serif stack for UI text; a monospace stack for RA, Dec, FoV and
  the table's coordinate and separation columns so digits align. Tabular numerals
  (`font-variant-numeric: tabular-nums`) where supported.
- Layout ≥ 1100 px: controls in a single row across the top (preset with its filter box stacked
  directly above it, RA, Dec, FoV, survey, Explore); below it the image panel on the left (800 px
  square, scaling down to fit) and the objects table on the right filling the remaining width.
  Below ~900 px everything stacks vertically, image first. The preset select shows its six
  `<optgroup>` labels natively; `Custom` is the first option and reads like one.
- Table: sticky header, very-low-contrast zebra rows, right-aligned numeric columns,
  `main_id` links to `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=<url-encoded main_id>`
  opening in a new tab (`rel="noopener"`).
- `select#sort` sits in the table panel head beside `#row-count`, styled like the other controls.
  The census is one wrapped line of small text under the panel head — `Star 4,728 · Red Supergiant
  Candidate 3,871 · …` — with the `+ 88 more types` tail in the lower-contrast caption colour.
- Caption and footer in a smaller, lower-contrast size. Credits are plain text, not badges.
- Pressing Enter in any of the three numeric inputs triggers Explore.
- Visible keyboard focus states on every control; the Explore button's disabled state is
  obvious without relying on colour alone.