---
name: build-sky-explorer
description: Step-by-step procedure for building or fixing the Samaa Explorer page under app/ (hips2fits cutout + SIMBAD TAP table ordered by reference count + field census + client-side sort switch + the generated preset library with Custom positions, a filter box and shareable URL hashes, vanilla JS) so that verify/smoke_test.py passes, with a table of common gate failures and their real causes. Use whenever creating or editing anything in app/.
---

# Build the sky explorer so the gate passes

Read `spec.md` end to end first. Every id, column, endpoint and threshold there is a contract.
The only definition of done is:

```
E:\CODE\samaa-explorer\.venv\Scripts\python.exe verify\smoke_test.py app\index.html
```

## Order of work

1. **Skeleton first.** Create the files in `spec.md` §1 with the contract ids (`spec.md` §2) —
   `input#preset-filter` (`type="search"`, placeholder `Filter presets…`) directly above
   `select#preset`, `select#sort` (options `refs` = `Most studied`, selected; `sep` = `Nearest to
   centre`) in the table panel head, an empty `#field-census` container above the table — the footer
   acknowledgements, `<link rel="icon" href="data:,">`, and `<script type="module" src="js/main.js">`.
   `app/data/presets.json` already exists: it is generated, **do not touch it**. Run the gate: it
   should get past the structural check and fail on behaviour. That proves the server, module loading
   and ids work.
2. **`js/presets.js`** — a loader, not a list: `export async function loadPresets()` does
   `fetch('data/presets.json')`, checks `res.ok`, parses, checks that `presets` is a non-empty array
   whose entries carry `id`, `label`, `category`, `main_id`, `ra`, `dec`, `fov`, and returns
   `{ presets, byId }`. No DOM. In `main.js`, once it resolves: `select#preset` gets
   `<option value="custom">Custom</option>` first, then one `<optgroup label="<category>">` per
   category **in file order** holding `<option value="<id>">label</option>` for every entry (345 →
   346 options). Then decide the initial state in this order: URL hash (step 6c) → stored Custom
   (`localStorage['samaa.lastPreset'] === 'custom'` and a parsable `samaa.custom`) → `m31`; fill
   `#ra`, `#dec`, `#fov` accordingly. A failed fetch writes `Preset library could not be loaded:
   HTTP <status>` into `#form-error` — never an empty select, never a built-in fallback list.
   - **Custom semantics**: an `input` event on `#ra`/`#dec`/`#fov` sets the select to `custom`,
     stores `{ra, dec, fov}` (raw strings) in memory and in `localStorage['samaa.custom']`, and sets
     `samaa.lastPreset = 'custom'`. `change` to a named preset fills the inputs and stores
     `samaa.lastPreset = <id>`; `change` to `custom` restores the stored set (or leaves the inputs).
     Make the fill idempotent: Playwright's `select_option` fires `change` even for the current value.
   - **Filter**: on `input` in `#preset-filter`, trim and lower-case the query; for every named option
     set both `hidden` and `disabled` to "does not match label or `main_id` (substring,
     case-insensitive)"; set each `<optgroup>`'s `hidden` to "no visible option"; never touch the
     `custom` option or the select's value; an empty query clears everything.
3. **`js/services/http.js`** — `fetchFromService(url, {service, readBody, readErrorDetail, timeoutMs})`:
   one `AbortController` per request (30 s → `<service> timed out`), `!res.ok` → a `ServiceError`
   whose message is `<service> returned HTTP <status>`. No DOM access.
4. **`js/services/hips2fits.js`** — pure function `cutoutUrl({hips, ra, dec, fov, width, height})`
   using `URLSearchParams`; always `projection=TAN&coordsys=icrs&format=jpg`. `fetchCutout()` returns
   a Blob so the HTTP status can be shown. No DOM access.
5. **`js/services/simbad.js`** — `coneSearch({ra, dec, radiusDeg, limit})` (the rows query:
   `ORDER BY nbref DESC, sep_deg ASC` — **bare column names; `b.nbref` is an HTTP 400**) and
   `fieldCensus({ra, dec, radiusDeg})` (`GROUP BY od.description`, `TOP 500`), both copied from
   `spec.md` §5 verbatim. `FORMAT=json`; map `data` rows by `metadata` column order. `nbref` is an
   integer and never null; `otype_desc` can be null (some rows, one census group).
6. **`js/main.js`** — validation (`spec.md` §2) → messages into `#form-error`, no request.
   Explore handler: set loading state; clear image, census and table; revoke the previous blob URL
   before assigning a new one; `Promise.allSettled([coneSearch, fieldCensus])`; render rows **in
   server order** (Refs descending) with `nbref.toLocaleString('en-US')` and `sep_deg * 60` as
   arcminutes (2 dp); render the census — every group as a `[data-count]` child, `hidden` beyond the
   first 8, a `+ k more types` tail, `data-total` and `data-groups` on the container, `Unclassified`
   for the null description; write `Showing X of <SUM(n)> objects within R°`; error branches write
   into `#image-error` / `#table-error`. `#sort` `change` → re-sort the loaded rows **in memory**
   (numeric compare, `sepDeg` ascending or `nbref` descending with `sepDeg` tie-break), re-render,
   update `aria-sort`; **no request**.
   - 6a. **Caption target**: the caption names the active target — `<label> · <main_id>` for a named
     preset (`Andromeda (M31) · M  31`), `Custom position` for Custom — alongside survey, HiPS id,
     centre, FoV and the credit.
   - 6b. **Write the hash** as soon as validation passes and the requests go out:
     `history.replaceState(null, '', '#' + new URLSearchParams({ra, dec, fov, hips, ...(preset)}))`
     — `URLSearchParams` encodes `/` as `%2F`; add `preset=<id>` only when a named preset is selected.
     Never assign `location.hash` (that fires `hashchange`) and do not listen to `hashchange`.
   - 6c. **Read the hash on load** (after the library resolved): `new URLSearchParams(location.hash.slice(1))`;
     `ra`, `dec`, `fov`, `hips` all required; `hips` must be a `select#survey` option value; fill the
     inputs, set the survey, select `preset` if it is a known id else `custom` (storing the values as
     the Custom set), then call the same Explore function the button calls. Validation failures end up
     in `#form-error` with nothing fetched — RA `400` in a hash must behave exactly like RA `400` typed.
     Matching coordinates never select a preset; only `preset=` does.
7. **`css/styles.css`** — light, calm, scientific (`spec.md` §9): system font stack, monospace with
   tabular numerals for coordinates and counts, a two-column layout that collapses under ~900 px,
   census as one wrapped line of small text. Keep the image ≥ 200 CSS px wide at all viewports (the
   gate renders at 1280×900).
8. Run the gate. Open `verify/artifacts/gate_run.png` and `gate_run_sorted.png`. Fix. Repeat. When
   it passes, run once more to confirm it is stable.

## Common gate failures and their real causes

| Gate says | Real cause | Fix |
|---|---|---|
| `missing deliverable file` | wrong folder name or file not created yet (`data/presets.json` counts) | match `spec.md` §1 exactly; never delete or rewrite `app/data/presets.json` |
| `app/data/presets.json has N presets (need >= 250)` / `invalid preset entries` / `presets on the same spot` | the generated file was edited, truncated or replaced by hand | restore it from git; it is the tool's output, not yours — report a wrong entry instead of fixing it |
| `live spot check ... failed` | `presets.json` disagrees with SIMBAD today | not your code: report it; the fix is re-running `tools/build_presets.py` outside `app/` |
| `no <select> option matching /andromeda\|m\s*31/i` | presets rendered after the gate looked (it waits 6 s for the fetch), or option text lacks "M31"/"Andromeda" | populate as soon as `loadPresets()` resolves; `m31`'s label is `Andromeda (M31)` |
| `select#preset first option must be value="custom"` | Custom missing or placed inside an optgroup / after the groups | `<option value="custom">Custom</option>` first, outside any `<optgroup>` |
| `select#preset offers N named option(s) (need >= 250)` / `option values and the ids in data/presets.json are the same set` | only part of the file rendered, a hard-coded list, or ids altered | one option per entry, `value = id`, text = `label`, under `<optgroup label = category>` |
| `option(s) under the wrong optgroup` / `options outside a category optgroup` | grouping by something other than `category`, or flat options | group by the entry's `category`, in file order |
| `a plain load ... must select 'm31'` / `plain load sent N request(s)` | default selection missing, or Explore fired on load without a hash | select `m31` and fill; fetch only on Explore or a hash |
| `after typing RA 83.82 select#preset is 'm31', not 'custom'` | no `input` listener, or it only runs on `change`/blur | listen to `input` on all three inputs; set the select to `custom` and store the set |
| `could not select 'custom'` | no `<option value="custom">` | see above |
| `after selecting 'custom' #ra is ...` | Custom restores nothing, or stores numbers that were re-formatted | keep the raw strings typed; restore them verbatim |
| `after page.reload() select#preset is 'm31'` | Custom not persisted, or load order wrong (default applied after the stored set) | persist `samaa.custom` + `samaa.lastPreset`; on load: hash → stored Custom → `m31` |
| `no input#preset-filter` / `must be type="search"` | control missing or a text input | `<input id="preset-filter" type="search">` above the select |
| `filter 'crab' leaves N selectable named option(s)` | options only hidden (not disabled) or vice versa, matching on label only (fine) but with a stale list, or the whole optgroup hidden while options stay enabled | set both `hidden` and `disabled`; selectable means neither, with the optgroup visible |
| `clearing the filter makes ... selectable ... expected N` | optgroups left hidden, or options left disabled | empty query resets every option and optgroup |
| `after Explore location.hash is ''` | hash never written, or written with `location.hash =`/after the responses only | `history.replaceState` when the requests go out; `ra`, `dec`, `fov`, `hips` (encoded), `preset` |
| `opening #ra=...&hips=... must fill #ra/#dec/#fov` / `must select 'custom'` / `must run Explore automatically` | hash parsed before the library loaded, `preset` guessed from coordinates, or no auto-Explore | parse after `loadPresets()`; `custom` unless `preset=` names a known id; call Explore |
| `invalid hash ... must leave a message in #form-error` | hash values bypass validation or the error goes elsewhere | run the same validation as the button; message into `#form-error` |
| `#image-caption must name the active preset` | caption lacks the label/main_id | append `<label> · <main_id>` (or `Custom position`) |
| `uncaught exception while loading` + module 404 in console | bad relative import path (`/js/...` absolute, or missing `.js` extension) | imports are relative, end in `.js` |
| `RA AND DEC ARE SWAPPED` | argument order mixed up in `cutoutUrl` or `CIRCLE(...)` | pass named fields; `CIRCLE('ICRS', ra, dec, r)` |
| `format=None - must be jpg or png` | omitted `format`; service returned FITS, Chromium blocked it (`ERR_BLOCKED_BY_ORB`) | always `format=jpg` |
| `fov=... must be decimal DEGREES` | arcminutes, or FoV multiplied by 60 somewhere | keep degrees end to end |
| `image not decoded: naturalWidth=0` | broken URL, FITS bytes, `onerror` swallowing, or `src` set before handlers | wire `onload`/`onerror` first; check the URL in `gate_run_requests.json` |
| `image not visible or too small` | CSS hides the img until load, or width < 200 px | reserve the panel; `img { width: 100%; max-width: 800px }` |
| `0 requests to simbad.cds.unistra.fr` | table rendered from a local array/JSON | call TAP for real; delete fixtures |
| `ADQL without a valid TOP cap` | `SELECT main_id ...` or `TOP 1000` | `SELECT TOP 200 ...` on the rows query; `TOP 500` on the census |
| `no ADQL query contains CIRCLE( centred on the selected preset` | radius passed as FoV, or centre taken from stale inputs | radius = FoV/2; read inputs at click time |
| `SIMBAD returned an error: HTTP 400 ... Incorrect ADQL` | missing `'ICRS'` in `POINT`/`CIRCLE`, unknown column, unbalanced quotes | copy the statements from `spec.md` §5 |
| `SIMBAD returned an error: HTTP 400 ... Encountered "."` | `ORDER BY b.nbref` — ADQL sort keys must be bare names or ordinals | `ORDER BY nbref DESC, sep_deg ASC` |
| `table shows N rows (need >= 50)` | rendering only part of `data`, or filtering nulls too aggressively | render every row; `otype_desc` may be `null`, `ra`/`dec`/`nbref` never are |
| `only k/N rendered rows carry an identifier found in the live SIMBAD response` | rows are from a fixture (even if a request was also sent), or `main_id` text altered (trimmed internal spaces, truncated) | render the response; `main_id` via `textContent` unchanged |
| `no row-count sentence like 'Showing 200 of ...'` | census not awaited, or wording changed | exact shape `Showing X of N objects within R°`, N = `SUM(n)` |
| `no table header matching /refs\|nbref\|references/i` | Refs column missing or named differently | header `Refs`; value = `nbref` |
| `Refs column ... has non-numeric cells` | `—`/`null` placeholders, or a formatted string the parser cannot read | `nbref` is never null; render `Number(nbref).toLocaleString('en-US')` |
| `Refs column ... is not sorted descending on first load (row i has ...)` | client re-sorted on load (by separation, or `"13,839"` as a string), or the ORDER BY lacks `nbref DESC` | render rows in the order received; sort only on `#sort` change, numerically |
| `no select#sort on the page` / `must have exactly two options` | control missing, different id, or extra options / wrong default | `<select id="sort">` with exactly `refs` (selected) and `sep` |
| `separation column ... is not sorted ascending after selecting 'Nearest to centre'` | `change` handler missing, sorts the wrong field, or compares strings | sort the loaded objects by `sepDeg` numerically and re-render |
| `sort switch sent N request(s) to simbad.cds.unistra.fr` | handler re-runs Explore or re-queries with a new ORDER BY | sort in memory |
| `row set changed after the sort switch` | re-rendered from a different array, or dropped rows | keep the 200 loaded objects; re-order only |
| `no #field-census element` / `needs >= 3 [data-count] entries` | census not rendered, rendered without `data-count`, or cleared after rendering | one child per group with `data-count="<n>"`; render when the census resolves |
| `no catalogue request contains GROUP BY` | census computed client-side from the 200 rows, or the old `COUNT(*)` query kept | send the census query from `spec.md` §5 |
| `census totals disagree: data-total=... row-count total=... sum of [data-count]` | only the top 8 rendered; `data-total` from a different number; `#row-count` from a `COUNT(*)` | render every group (`hidden` beyond 8); total = `SUM(n)` everywhere |
| `no honest '+ k more types' tail` | all groups visible, or k miscounted | top 8 visible, `+ (groups − 8) more types` |
| `visible text must include the hips2fits credit` | credit only in `title`/`alt` or hidden | put both acknowledgements in a visible footer |
| `console/page error(s)` | 404 for a module/CSS, `undefined` access when a field is null, favicon, an exception in the sort handler | fix the URL; null-check `otype_desc`; `<link rel="icon" href="data:,">` |
| `RA=400 was sent upstream` | validation after building the URL, or only HTML5 `max=` attributes | validate in JS before any network code runs |
| `no visible validation message after RA=400` | message only in a browser tooltip / `setCustomValidity` | write text into `#form-error` (`role="alert"`) |
| `after SIMBAD answered 503 no alert text named the status code and the service` | `catch` renders the empty state, or message lacks the number | `Catalogue error: SIMBAD TAP returned HTTP 503` |
| `page shows 'No catalogued objects...' after a 503` | empty-state text written unconditionally before/after the fetch | empty state only on a 2xx response with zero rows |
| `after hips2fits answered 500 no alert text reported an image/hips2fits error` | `img.onerror` missing or no-op, or the fetch error swallowed | write `Image error: hips2fits returned HTTP 500` into `#image-error` |
| `HARNESS ERROR - ...` (`unreachable`, `answered HTTP 5xx`, `connection refused`, `still unanswered`, `transient`, `slow spell`) | network / CDS outage / Chromium not installed — the gate probed the service with its own known-good request and replayed yours before saying so | not your code; wait a minute, retry, report if persistent |
| `INFO  upstream diagnosis: ... is up ... the request itself provokes the failure` followed by `FAIL` lines | a healthy service rejects your exact request with a real 400/500 (unknown HiPS, `width=0`, `1/0` in ADQL, `ORDER BY b.nbref`) | read "the service says: ..." in that line; fix the request |

## Things that look like bugs but are not

- The census sum for M31 at 0.75° is ~37,55x and drifts by a few rows between days; never hard-code it.
- `nbref` is never null anywhere in SIMBAD (verified), so `COALESCE` is unnecessary; 0 is a real value.
- A `null` type description is a real census group (objects whose `otype` has no `otypedef` row);
  label it `Unclassified` and keep its count in the total.
- Only 58 distinct `nbref` values among M31's top 200: long runs of equal `Refs` are expected; the
  `sep_deg ASC` tie-break orders them.
- `otype_txt` really is the same as `otype`; use `otypedef.description` for words.
- SIMBAD error bodies are XML even with `FORMAT=json`; the status code is what you surface.
- SIMBAD has slow spells (5–11 s for trivial queries, measured 2026-10-17); keep the 30 s timeout
  and a visible loading state rather than shortening it.
- hips2fits accepts `ra=400`; only your validation stands between the user and nonsense.
- A real user re-picking the selected preset fires no `change`, but Playwright's `select_option`
  **does** fire `change` (and `input`) even for the current value — fill inputs on load and keep the
  handler idempotent. For `#sort` the gate selects `sep` from a `refs` default, so `refs` must be the
  selected option.
- Every `<option>` of a closed `<select>` reports zero client rects and `is_visible() === false`,
  selectable or not; the gate judges the filter by the `hidden`/`disabled` properties and the
  optgroup's `hidden`. Do not try to "show" options with CSS.
- `data/presets.json` has 345 entries and `main_id`s with runs of spaces (`M  31`); match the filter
  against them verbatim (lower-cased), and show them verbatim in the caption.
- `page.goto` to the same page with a different hash is a same-document navigation; the gate opens a
  fresh page for the hash round-trip, so the hash must be handled at load time, not on `hashchange`.
- The filter leaves two named options for `crab` (`Crab Nebula (M1)`, `Crab Pulsar (PSR B0531+21)`);
  that is the data, not a bug.
