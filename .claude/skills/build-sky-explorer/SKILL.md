---
name: build-sky-explorer
description: Step-by-step procedure for building or fixing the Samaa Explorer page under app/ (hips2fits cutout + SIMBAD TAP table, vanilla JS) so that verify/smoke_test.py passes, with a table of common gate failures and their real causes. Use whenever creating or editing anything in app/.
---

# Build the sky explorer so the gate passes

Read `spec.md` end to end first. Every id, column, endpoint and threshold there is a contract.
The only definition of done is:

```
E:\CODE\samaa-explorer\.venv\Scripts\python.exe verify\smoke_test.py app\index.html
```

## Order of work

1. **Skeleton first.** Create all six files (`spec.md` §1) with the contract ids (`spec.md` §2),
   the footer acknowledgements, `<link rel="icon" href="data:,">`, and
   `<script type="module" src="js/main.js">`. Run the gate: it should get past the structural
   check and fail on behaviour. That proves the server, module loading and ids work.
2. **`js/presets.js`** — export the eight presets from `spec.md` §3 (resolved coordinates, not the
   brief's). Populate `select#preset` from it; on load and on `change` fill `#ra`, `#dec`, `#fov`.
3. **`js/services/hips2fits.js`** — pure function `cutoutUrl({hips, ra, dec, fov, width, height})`
   using `URLSearchParams`; always `projection=TAN&coordsys=icrs&format=jpg`. No DOM access.
4. **`js/services/simbad.js`** — `coneSearch({ra, dec, radiusDeg, limit})` and
   `coneCount({ra, dec, radiusDeg})` using the two ADQL statements in `spec.md` §5 verbatim
   (with `TOP`). `fetch()` the TAP sync endpoint, `FORMAT=json`; on `!res.ok` throw an `Error`
   whose message includes `SIMBAD TAP` and `HTTP <status>`; use an `AbortController` (30 s) and
   throw `SIMBAD TAP timed out` on abort. Map `data` rows by `metadata` column order.
5. **`js/main.js`** — validation (`spec.md` §2) → messages into `#form-error`, no request;
   Explore handler: set loading state, `img.onload` / `img.onerror` before setting `src`,
   `Promise.all([coneSearch, coneCount])`, render rows sorted by `sep_deg` (already sorted by
   the server) with `sep_deg * 60` as arcminutes, write `Showing X of N objects within R°`,
   error branches write into `#image-error` / `#table-error`. Clear old content when a new
   Explore starts.
6. **`css/styles.css`** — light, calm, scientific: system font stack, generous whitespace,
   thin rules, monospace for coordinates, a two-column layout (controls + image left, table
   right) that collapses to one column under ~900 px. Keep the image ≥ 200 CSS px wide at all
   viewports (the gate renders at 1280×900).
7. Run the gate. Open `verify/artifacts/gate_run.png`. Fix. Repeat. When it passes, run once
   more to confirm it is stable.

## Common gate failures and their real causes

| Gate says | Real cause | Fix |
|---|---|---|
| `missing deliverable file` | wrong folder name or file not created yet | match `spec.md` §1 exactly |
| `no <select> option matching /andromeda\|m\s*31/i` | presets rendered after the gate looked (it waits 6 s), or option text lacks "M31"/"Andromeda" | populate synchronously at module load; label `Andromeda (M31)` |
| `uncaught exception while loading` + module 404 in console | bad relative import path (`/js/...` absolute, or missing `.js` extension) | imports are relative, end in `.js` |
| `RA AND DEC ARE SWAPPED` | argument order mixed up in `cutoutUrl` or `CIRCLE(...)` | pass named fields; `CIRCLE('ICRS', ra, dec, r)` |
| `format=None - must be jpg or png` | omitted `format`; service returned FITS, Chromium blocked it (`ERR_BLOCKED_BY_ORB`) | always `format=jpg` |
| `fov=... must be decimal DEGREES` | arcminutes, or FoV multiplied by 60 somewhere | keep degrees end to end |
| `image not decoded: naturalWidth=0` | broken URL, FITS bytes, `onerror` swallowing, or `src` set before handlers | wire `onload`/`onerror` first; check the URL in `gate_run_requests.json` |
| `image not visible or too small` | CSS hides the img until load, or width < 200 px | reserve the panel; `img { width: 100%; max-width: 800px }` |
| `0 requests to simbad.cds.unistra.fr` | table rendered from a local array/JSON | call TAP for real; delete fixtures |
| `ADQL without a valid TOP cap` | `SELECT main_id ...` or `TOP 1000` | `SELECT TOP 200 ...`; `TOP 1` on the COUNT query |
| `no ADQL query contains CIRCLE( centred on the selected preset` | radius passed as FoV, or centre taken from stale inputs | radius = FoV/2; read inputs at click time |
| `SIMBAD returned an error: HTTP 400 ... Incorrect ADQL` | missing `'ICRS'` in `POINT`/`CIRCLE`, unknown column, unbalanced quotes | copy the statements from `spec.md` §5 |
| `table shows N rows (need >= 50)` | rendering only part of `data`, or filtering nulls too aggressively | render every row; `sp_type` may be `null`, `ra`/`dec` never are inside the cone |
| `only k/N rendered rows carry an identifier found in the live response` | rows are from a fixture, or `main_id` text altered (trimmed internal spaces, truncated) | render `main_id` with `textContent` unchanged |
| `no row-count sentence like 'Showing 200 of ...'` | missing COUNT query, or wording changed | exact shape `Showing X of N objects within R°` |
| `separation column ... not sorted ascending` | client re-sort with string compare, or arcmin computed from the wrong centre | numeric sort; use server `ORDER BY sep_deg` |
| `visible text must include the hips2fits credit` | credit only in `title`/`alt` or hidden | put both acknowledgements in a visible footer |
| `console/page error(s)` | 404 for a module/CSS, `undefined` access when a field is null, favicon | fix the URL; null-check `sp_type`; `<link rel="icon" href="data:,">` |
| `RA=400 was sent upstream` | validation after building the URL, or only HTML5 `max=` attributes | validate in JS before any network code runs |
| `no visible validation message after RA=400` | message only in a browser tooltip / `setCustomValidity` | write text into `#form-error` (`role="alert"`) |
| `after SIMBAD answered 503 no alert text named the status code and the service` | `catch` renders the empty state, or message lacks the number | `Catalogue error: SIMBAD TAP returned HTTP 503` |
| `page shows 'No catalogued objects...' after a 503` | empty-state text written unconditionally before/after the fetch | empty state only on a 2xx response with zero rows |
| `after hips2fits answered 500 no alert text reported an image/hips2fits error` | `img.onerror` missing or no-op | `onerror` writes `Image error: hips2fits ... could not load the cutout` into `#image-error` |
| `HARNESS ERROR - ... unreachable` | network / CDS outage / Chromium not installed | not your code; retry later, report if persistent |

## Things that look like bugs but are not

- `COUNT(*)` for M31 at 0.75° is ~37,55x and drifts by a few rows between days; never hard-code it.
- `otype_txt` really is the same as `otype`; use `otypedef.description` for words.
- SIMBAD error bodies are XML even with `FORMAT=json`; the status code is what you surface.
- hips2fits accepts `ra=400`; only your validation stands between the user and nonsense.
- Selecting the already-selected preset fires no `change`; fill inputs on load too.
