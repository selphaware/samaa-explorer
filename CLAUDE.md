# Samaa Explorer — working agreement

Browser-only sky explorer (HTML5 / CSS / vanilla JS ES modules; no framework, no build, no CDN,
no backend). Full task spec: `spec.md`. Build procedure and failure table:
`.claude/skills/build-sky-explorer/SKILL.md`. Human run instructions: `README.md` and `serve.py`
at the repo root (the gate uses neither). The preset library `app/data/presets.json` is **generated**
by `tools/build_presets.py` from `tools/preset_catalogue.csv` (names only, resolved in SIMBAD); never
edit the JSON by hand — fix the CSV and re-run the tool.

## Definition of done

```
E:\CODE\samaa-explorer\.venv\Scripts\python.exe verify\smoke_test.py app\index.html
```

exits **0** and prints `GATE PASS`. Nothing else counts: not "it renders", not "no console
errors", not a screenshot that looks right. Run it yourself after every meaningful change; the
PostToolUse hook also runs it after every Write/Edit under `app/`.

Exit codes: `0` pass · `1` deliverable failure (read the `FAIL` lines; they say what and where) ·
`3` HARNESS ERROR (environment or network — **not your code; do not "fix" the app for it**) ·
`4` usage error.

A CDS service that answers 5xx, refuses the connection or does not answer during the run is exit 3
as well: before deciding, the gate sends its own known-good request to that service and replays
yours. Only when the service is healthy and your exact request keeps failing (unknown HiPS,
`width=0`, a bad ADQL expression) is it exit 1, and an `INFO  upstream diagnosis` line quotes what
the service said.

## The contract the gate enforces

| # | Check | How it is measured |
|---|---|---|
| 1 | Seven files exist and are non-empty: `app/index.html`, `app/css/styles.css`, `app/js/main.js`, `app/js/presets.js`, `app/js/services/hips2fits.js`, `app/js/services/simbad.js`, `app/data/presets.json` (`app/js/services/http.js` and `serve.py` are part of the layout but not checked) | filesystem |
| 2 | Page loads over `http://localhost:8765/index.html` with no uncaught exception | headless Chromium |
| 3 | `select#preset`: first option `value="custom"` (text `Custom`); then ≥ 250 named options, each inside an `<optgroup>` whose label is one of the six categories and is the option's own category; option values and the JSON `id`s are the same set; `m31` is `Andromeda (M31)` and is selected on a plain first load with `#ra`/`#dec`/`#fov` filled and **no request** sent; `button#explore` exists | DOM + network |
| 4 | After Explore: ≥ 1 request to `alasky(bis).cds.unistra.fr/hips-image-services/hips2fits` with `ra`/`dec` within 0.01° of (10.68470833, +41.26875), `format=jpg|png`, full `hips` ID, `fov` in 0.1–10°, `width`/`height` ≥ 200, response `200 image/*` | intercepted network |
| 5 | `img#sky-image` shows that cutout: `naturalWidth ≥ 200`, visible, ≥ 200 CSS px wide | DOM |
| 6 | ≥ 1 request to `simbad.cds.unistra.fr`; **every** ADQL query carries `TOP n`, 1 ≤ n ≤ 500; one has `CIRCLE(` centred on M31 within 0.01° with radius 0.01–5°; one contains `GROUP BY` (the census); all responses 2xx | intercepted network |
| 7 | `table#objects-table` shows ≥ 50 rows; ≥ 50 rows carry an identifier found verbatim in the live SIMBAD response bytes (fixture data cannot pass) | DOM + response body |
| 8 | Visible text `Showing <shown> of <total>` where shown = rendered rows and total ≥ shown; total = `#field-census[data-total]` = the sum of every `[data-count]` entry under `#field-census` (hidden ones included) | DOM |
| 9 | A header matching `refs` / `nbref` / `references`; its column is numeric (thousands separators allowed) and **non-increasing on first load** (ties allowed); the failure text names the first out-of-order row | DOM |
| 10 | A header matching `Sep` / `separation` / `dist`; its column is numeric and non-empty on first load (its order is **not** checked on load) | DOM |
| 11 | `select#sort` exists with exactly the option values `refs` (selected on load) and `sep`; after `select_option('#sort', 'sep')` the separation column is ascending, the row set is unchanged, and **no new request** reached the catalogue host | DOM + intercepted network |
| 12 | `#field-census` is visible with ≥ 3 `[data-count]` entries, each an integer ≥ 1; when it has more than 8 entries its text contains `+ k more` with k = entries − visible entries | DOM |
| 13 | Visible text contains `hips2fits` and `CDS`, and `SIMBAD`; caption contains the centre coordinates | DOM |
| 14 | No console errors or page errors during the happy path and the sort switch (favicon 404 ignored) | console |
| 15 | RA `400` + Explore → **no** request to either host, and a visible message in a `role="alert"` element | network + DOM |
| 16 | SIMBAD forced to answer 503 → an alert names `503` and `SIMBAD`/`catalogue`; the page never shows `No catalogued objects` | route injection |
| 17 | hips2fits forced to answer 500 → an alert names the image service and an error | route injection |
| 18 | **Preset data.** `app/data/presets.json` parses; `presets` has ≥ 250 entries; every entry has `id` (unique slug), `label`, `category` (one of `Galaxies`, `Nebulae`, `Star clusters`, `Stars`, `Deep fields`, `Exotic & high-energy`), `main_id`, `ra` in [0, 360), `dec` in [−90, 90], `fov` in [0.05, 10], `otype`, `otype_desc` (null allowed), `resolved_by`, `resolved_at` (`YYYY-MM-DD`); no two entries within 0.001°. Then 5 entries chosen by `random.Random(20261017).sample(sorted(ids), 5)` are re-resolved **live** by `main_id` through the TAP `ident` query and must agree within 0.01°: SIMBAD down → exit 3 via the upstream-diagnosis path; an unknown `main_id` or a drift → exit 1 naming the preset. Skipped (with an INFO line) when `source` contains `SELFTEST FIXTURE` | filesystem + live TAP |
| 19 | **Custom round-trip** on a fresh page without hash, with **no request to either host** at any point: `fill('#ra', '83.82')` → `#preset` value is `custom`; `select_option('#preset', 'm31')` → `#ra` is M31's RA; `select_option('#preset', 'custom')` → `#ra` is `83.82`; `page.reload()` → `#preset` is `custom` and `#ra` is `83.82` | DOM + localStorage + network |
| 20 | **Filter.** `input#preset-filter` (`type="search"`) exists; `fill('#preset-filter', 'crab')` → the named options that are neither `hidden` nor `disabled` and whose `<optgroup>` is not hidden number between 1 and 5 and include `m1`; the `custom` option stays selectable and the select's value is unchanged; `fill('')` → every option selectable again, i.e. library size + 1. Measured by element **properties**, never geometry (options of a closed select have no client rects) | DOM |
| 21 | **Hash written.** After the M31 Explore settles, `location.hash` parses (`URLSearchParams`) to `ra`/`dec` within 0.001° of (10.68470833, +41.26875), `fov` = the requested FoV, `hips` = the full HiPS id of the request, `preset=m31` | DOM |
| 22 | **Hash read.** A fresh page opened at `index.html#ra=83.8201&dec=-5.3876&fov=1.0&hips=CDS%2FP%2FDSS2%2Fcolor` fills the three inputs, selects `custom` (matching coordinates never auto-select a preset; only `preset=<id>` does), and **both** hosts receive a request without any click, the ADQL cone centred on (83.8201, −5.3876). Then `#ra=400&dec=0&fov=1&hips=CDS%2FP%2FDSS2%2Fcolor` on another fresh page → no request to either host and a non-empty `#form-error` | DOM + network |
| 23 | After the M31 Explore, `#image-caption` names the active preset: its label (`Andromeda (M31)`) or its `main_id` (`M  31`) | DOM |

Library facts (2026-10-17): `tools/build_presets.py` resolved all 345 catalogue names (339 in four batch
queries, 5 one by one, 1 via Sesame, 0 failed) — Galaxies 81 · Nebulae 50 · Star clusters 107 · Stars 47 ·
Deep fields 18 · Exotic & high-energy 42; the closest pair is 0.003° apart (M 1 and the Crab pulsar); `crab`
matches exactly two named options. The gate's floor is 250 presets.

Thresholds come from live data (2026-10-17, re-measured the same day for revision 1): SIMBAD holds
37,554 objects within 0.75° of M31 in 96 type groups (census `SUM(n)` = `COUNT(*)`); ordered by
`nbref DESC` the cone starts `M  31` 13,839 → `M  32` 2,254 → `M 110` 1,378 and the 200th row has
35; the densest field the FoV limit allows (Sgr A*, radius 5°) has 154 groups, so `TOP 500` on the
census never truncates. The contract caps the table at `TOP 200`; the gate demands 50 rows and
3 census entries. The gate writes `verify/artifacts/gate_run.png` (what the user sees),
`gate_run_sorted.png` (after the sort switch) and `gate_run_requests.json` (what you sent). Look
at them when a check fails.

## Environment facts (verified 2026-10-17 — do not re-discover, do not change)

- Interpreter: `E:\CODE\samaa-explorer\.venv\Scripts\python.exe` (Python 3.12.13). The venv
  already exists. **Never create another venv. Never install packages** — the app needs none.
- Bare `python` on this machine is the Microsoft Store stub (`...\WindowsApps\python.exe`) and
  prints "Python was not found". Always use the absolute path above.
- Gate dependencies present: playwright 1.64.0, Chromium 156 (`ms-playwright/chromium-1248`).
- Node is installed but **not used**: no npm, no bundler, no CDN. Plain ES modules only.
- Project lives on a local NTFS volume (`E:`). Static server port 8765 (`--port` or
  `SAMAA_GATE_PORT` to change; the gate falls back to a free port automatically).
- Both services send `Access-Control-Allow-Origin: *`; **no proxy, no backend**.
- Shell: Git Bash is the Bash tool; PowerShell 7 also available. Quote paths with spaces.

## Guardrails

- **Write only under `app/`.** Never edit `verify/`, `.claude/`, `CLAUDE.md`, `spec.md`,
  `BOOTSTRAP.md`, `tools/` (settings deny it anyway). If you believe the gate is wrong, stop and say
  exactly which check and why — do not work around it.
- **`app/data/presets.json` is generated data, not code.** Do not edit it by hand and do not replace it
  with a hard-coded list. If an entry looks wrong, stop and report the `id`: the fix is a row in
  `tools/preset_catalogue.csv` plus a re-run of `tools/build_presets.py`, both outside your write scope.
- No secrets, no env vars, no API keys, no new dependencies, no build step, no `file://` testing.
- Never present fixture / hard-coded / cached data as live data. Upstream errors must surface as
  errors with service name and status, never as the empty state.
- Keep the CDS acknowledgements visible (`spec.md` sections 4–5).
- Run the gate with the absolute interpreter path, from the project root, exactly as in
  "Definition of done". Do not pass `--min-rows` or other knobs to make it pass.

## Autonomy

Work through gate failures on your own: read the `FAIL` lines, look at the screenshot, fix,
re-run. Do **not** ask for confirmation between iterations. Stop and report only when:

1. the **same** `FAIL` line repeats after 3 consecutive fixes, or
2. the gate reports `HARNESS ERROR` (a CDS service unreachable, Chromium broken) — wait, retry
   once after a minute, then report; it is not a code problem, or
3. the spec and the gate appear to contradict each other (quote both).

When the gate passes, run it once more to confirm it is stable, then stop and summarize what
was built, which checks pass, and anything in `spec.md` that the live services contradicted.

## Hook

`.claude/settings.json` registers `verify/hook_post_tool_use.py` on `PostToolUse` for
Write/Edit. It runs the gate only for edits under `app/` and only once `app/index.html` exists.
PASS → a short note in your context. FAIL → the gate output is returned to you (exit 2);
fix the deliverable. HARNESS ERROR → a note saying verification did not run; not your fault.
Full output of the last hook run: `verify/artifacts/last_gate.log`.
