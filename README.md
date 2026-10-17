# Samaa Explorer

A browser-only sky explorer: pick a preset or enter RA/Dec and a field of view, press **Explore**,
and the page shows a real survey image cutout from CDS hips2fits together with the most-studied
SIMBAD objects in that field and a census of everything SIMBAD catalogues there. It is one static
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
