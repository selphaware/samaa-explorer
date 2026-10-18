# Samaa Explorer

A browser-only sky explorer: pick one of 345 named places (every Messier and Caldwell object, the
brightest stars, deep fields, high-energy landmarks) or type RA/Dec and a field of view, press
**Explore**, and the page shows a real survey image cutout from CDS hips2fits together with the
most-studied SIMBAD objects in that field and a census of everything SIMBAD catalogues there. A
typed position is remembered as **Custom**, and every view is a URL you can share. It is one static
page in HTML / CSS / vanilla JavaScript modules — no framework, no build step, no backend.

## Run

```
E:\CODE\samaa-explorer\.venv\Scripts\python.exe serve.py
```

then open <http://localhost:8765/> (pass another port as the first argument). `serve.py` is a
standard-library static server for `app/` that pins `.js` to `text/javascript` and `.css` to
`text/css`; Python's stock server on Windows can serve modules as `text/plain`, which Chromium
refuses to run.

## Verify

```
E:\CODE\samaa-explorer\.venv\Scripts\python.exe verify\smoke_test.py app\index.html
```

exits 0 and prints `GATE PASS`. The gate serves `app/` itself, drives headless Chromium and checks
live responses from both services; the contract it enforces is in `CLAUDE.md`, the full spec in
`spec.md`.

## Shareable URLs

After Explore the address bar carries the view:

```
http://localhost:8765/index.html#ra=10.68470833&dec=41.26875&fov=1.5&hips=CDS%2FP%2FDSS2%2Fcolor&preset=m31
```

`ra`, `dec` (ICRS degrees), `fov` (degrees) and `hips` (the full HiPS id, URL-encoded) are required;
`preset` is present when a named preset was active and absent for a Custom position. Opening such a
link fills the form, selects the preset (or Custom) and runs Explore by itself; an invalid value shows
the usual validation message and fetches nothing.

## The preset library

`app/data/presets.json` is generated — never edit it by hand. The source of truth is
`tools/preset_catalogue.csv`, a list of **names** (`id,label,category,query_name,fov_override`) with
no coordinates in it; `tools/build_presets.py` resolves every name in SIMBAD TAP (table `ident`
joined to `basic`), falls back to CDS Sesame, derives a field of view from SIMBAD's angular size
(`clamp(1.5 × size/60, 0.1, 3.0)` degrees, or the category default, unless the CSV overrides it) and
writes the JSON with provenance (`main_id`, `resolved_by`, `resolved_at`). It refuses to write
anything if a name does not resolve or two entries land within 0.001° of each other.

To add a preset:

```
# 1. append a row to tools/preset_catalogue.csv, e.g.
#    ngc-7789,Caroline's Rose (NGC 7789),Star clusters,NGC 7789,
# 2. regenerate
E:\CODE\samaa-explorer\.venv\Scripts\python.exe tools\build_presets.py
# 3. commit tools/preset_catalogue.csv and app/data/presets.json together
```

`query_name` must be a name SIMBAD knows (`NGC 869`, `* alf Ori`, `NAME Sgr A*`); Caldwell numbers
(`C 14`) are not SIMBAD identifiers, so Caldwell rows carry their NGC/IC designation. Categories are
exactly `Galaxies`, `Nebulae`, `Star clusters`, `Stars`, `Deep fields`, `Exotic & high-energy`.
**No Solar System bodies** (they move) and **no proper-motion corrections**: positions are SIMBAD's
ICRS J2000 values on the day the tool ran. `--dry-run` resolves without writing, `--verbose` shows
every lookup.

## Acknowledgements

- This research made use of hips2fits, a service provided by CDS.
- This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France
  (Wenger et al. 2000, A&AS 143, 9).

## Architecture notes

- **Browser-only.** Both services answer with `Access-Control-Allow-Origin: *`, so the page calls
  them directly from `fetch()`; there is nothing to proxy and nothing to deploy.
- **Service adapters** live in `app/js/services/`: `hips2fits.js` builds cutout URLs and fetches
  the image bytes; `simbad.js` builds the ADQL and parses TAP JSON; `http.js` is the shared fetch
  plumbing (one 30 s timeout per request; every failure becomes an error naming the service and
  the HTTP status). None of them touches the DOM, so a new provider is a new module, not a UI change.
- **Image via `fetch()` + blob URL** rather than a bare `<img src>`: an HTTP error can then be
  reported with its status instead of a silent broken image. The previous blob URL is revoked
  before a new one is assigned.
- **Text inputs with native validation off** (`novalidate`): RA `400` produces a visible message in
  a `role="alert"` element and no request, rather than a browser tooltip that automation cannot see.
- **`TOP` on every ADQL query** (200 rows, 500 census groups): without it SIMBAD silently truncates
  at 50,000 rows, and a 5° cone on the Galactic centre holds about 927,000 objects.
- **Two catalogue queries per Explore**, in parallel: the 200 most-referenced objects
  (`ORDER BY nbref DESC`) and a `GROUP BY` type census whose sum is the field total shown above
  the table. Sorting the table by separation is done in the browser, with no new request.
- **Presets are data.** `js/presets.js` fetches `data/presets.json` and fills the select (one
  `<optgroup>` per category behind a `Custom` first option); typing in RA/Dec/FoV switches to Custom
  and stores the values in `localStorage` (`samaa.custom`, `samaa.lastPreset`), so they survive a
  reload. The filter box hides and disables non-matching options client-side.
