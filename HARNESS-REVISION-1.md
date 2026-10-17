# HARNESS REVISION 1 — notability ordering, field census, run instructions

You are revising the **harness** (`verify/smoke_test.py`, its `--selftest` fixtures, `CLAUDE.md`,
`spec.md`, the skill) and adding human run instructions. You are NOT building or editing the
application under `app/` — the build happens in a separate session against the revised `spec.md`.

Read this whole file, then `CLAUDE.md`, `spec.md` and `verify/smoke_test.py`, before changing anything.

---

## Why

Slice 1 passed the gate, and a human reviewed it. One product finding: the objects table sorts by
separation and takes `TOP 200`, so for M31 at FoV 1.5° every row lies within 0.77′ of the nucleus.
The table shows the galaxy's core; the image shows a 1.5° field. M32, M110 and NGC 206 never appear.
The spec asked for that ordering and the gate enforces it (separation column ascending, lines
~696–716), so this is a spec-and-gate change, not an app bug.

Decision (human): the table should answer "what has humanity actually studied in this field",
ordered by **notability** — SIMBAD's `nbref` (reference count) — with separation still shown. A
**field census** (object counts by type for the whole cone) sits above the table so the 200-row cap
no longer hides what is in the field.

---

## Phase 0 — measure before you change the contract (verify, don't assert)

Run these live against `https://simbad.cds.unistra.fr/simbad/sim-tap/sync` from this machine and
record timings and row counts in `spec.md`:

1. Rows query ordered by notability, M31 at radius 0.75°:
   ```sql
   SELECT TOP 200 b.main_id, b.otype, od.description AS otype_desc, b.nbref, b.ra, b.dec,
          DISTANCE(POINT('ICRS', b.ra, b.dec), POINT('ICRS', 10.68470833, 41.26875)) AS sep_deg
   FROM basic b LEFT JOIN otypedef od ON od.otype = b.otype
   WHERE CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', 10.68470833, 41.26875, 0.75)) = 1
   ORDER BY b.nbref DESC, sep_deg ASC
   ```
   Confirm M32 (`M  32`) and M110 (`M 110`) are now in the result. Note whether `nbref` is ever
   `null` and whether nulls sort last (if not, use `COALESCE(b.nbref, 0)` in the ORDER BY and say so).
2. Census query, same cone:
   ```sql
   SELECT TOP 500 od.description AS otype_desc, COUNT(*) AS n
   FROM basic b LEFT JOIN otypedef od ON od.otype = b.otype
   WHERE CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', 10.68470833, 41.26875, 0.75)) = 1
   GROUP BY od.description
   ORDER BY n DESC
   ```
   Confirm `SUM(n)` equals the `COUNT(*)` the old count query returns (37,554 on 2026-10-17, will
   drift). Confirm the number of groups is far below 500 (it is bounded by the `otypedef`
   vocabulary) so `TOP 500` never truncates. Note how a `null` description group appears.
3. **Worst case.** Both queries for Sagittarius A* (266.41681662, −29.00782497) at the spec's
   maximum FoV 10° → radius 5°, and at FoV 2° → radius 1°. Record wall time and whether either
   exceeds the app's 30 s timeout. If the 5° radius is unusable, **tell me** — the fix is a lower
   `FoV` maximum or a per-preset cap in `spec.md`, not a silent workaround.
4. Report Phase 0 results before editing any file.

---

## Phase 1 — contract changes (apply to `spec.md` §2, §5, §6, §7 and `CLAUDE.md`'s contract table)

### Objects table
- Columns, in order: `main_id`, `Type`, `Refs`, `RA (°)`, `Dec (°)`, `Sep (′)`.
  `Refs` = `b.nbref`, integer, thousands-separated. `Type` unchanged (description, code in `title`).
- **Default order: `Refs` descending**, ties broken by `Sep` ascending. This is the order the
  server returns; the client does not re-sort on load.
- `select#sort` with exactly two options: `refs` (label `Most studied`, default) and `sep`
  (label `Nearest to centre`). Changing it re-sorts the 200 rows **client-side** — no new request.
- The rows query becomes the Phase 0 query 1 (with `{ra}`, `{dec}`, `{radius}` substituted).

### Field census
- Element `#field-census`, rendered above the table once the census query returns. One entry per
  type: description (or `Unclassified` for the null group) and count, ordered by count descending.
  Show the top 8 inline; if more groups exist, append `+ k more types`.
- The census query (Phase 0 query 2) **replaces** the separate `COUNT(*)` query. The total in
  `#row-count` is `SUM(n)` over all groups. So the catalogue makes exactly **two** requests per
  Explore: rows and census, in parallel with `Promise.allSettled` (the existing outcome table in
  §5 stands — read "count" as "census").
- `#row-count` shape unchanged: `Showing 200 of <total> objects within 0.75°`, or
  `Showing 200 objects within 0.75° (total unavailable)` when the census failed but rows succeeded.

### Behaviour (§6)
- Step 3 now reads: image of M31 with caption; census (e.g. `Star 21,340 · X-ray source 4,112 ·
  Globular cluster 1,048 …` — use the live numbers you measured, marked as 2026-10-17 values);
  table of the 200 most-referenced objects, M32 and M110 among them; `#row-count` as above.
- New step: switch `#sort` to `Nearest to centre` → the same 200 rows re-order by `Sep` ascending
  with no network request.

### Run instructions (new; the Project brief requires accurate README/run instructions)
- `serve.py` at the repository root: serves `app/` on `http://localhost:8765` (port overridable by
  argument) with `.js` pinned to `text/javascript` and `.css` to `text/css`, using only the
  standard library. It exists because Windows' `http.server` can serve `.js` as `text/plain`,
  which makes module scripts refuse to run.
- `README.md` at the repository root: what Samaa Explorer is (two sentences), how to run
  (`E:\CODE\samaa-explorer\.venv\Scripts\python.exe serve.py` then open the URL), how to verify
  (the literal gate command), the two acknowledgements (hips2fits/CDS, SIMBAD), and a short
  "Architecture notes" section: browser-only and why (CORS open on both services), service
  adapters as separate modules, image fetched via `fetch()` + blob URL so HTTP status can be
  shown, text inputs with native validation off so RA 400 shows a visible error, `TOP` cap and
  why. Keep it to one screen.
- `spec.md` §1 and `CLAUDE.md` list `app/js/services/http.js` (added in slice 1) and
  `serve.py`; the gate does **not** require `serve.py` and does not use it.
- §5 note for the build agent: `URL.revokeObjectURL` the previous image blob before assigning a
  new one; verify this in review.

---

## Phase 2 — gate changes (`verify/smoke_test.py`)

Change as little as possible. Every assertion below replaces or extends an existing check; keep
the existing checks (file layout, hips2fits URL and status, `naturalWidth`, SIMBAD request with
`TOP` and `CIRCLE(`, forced 503/500 handling, RA 400 blocked, console errors) untouched unless a
column change requires it.

1. Header match: a column matching `/refs|nbref|references/i` must exist, be numeric, and be
   **non-increasing** on first load (ties allowed). Failure text names the first out-of-order row.
2. The separation column must still exist and be numeric and non-empty. **Drop** the ascending
   assertion on first load.
3. Then `select_option('#sort', 'sep')`, wait for the table body to settle, assert the separation
   column is now ascending **and** that no new request to the catalogue host was made.
4. `#field-census` exists with ≥ 3 entries, each with a numeric count ≥ 1, and the catalogue
   traffic includes a request whose query text contains `GROUP BY`.
5. `#row-count` total equals the sum of census counts when both are present (tolerate the
   `+ k more types` truncation by reading counts from a `data-` attribute or hidden full list — the
   build agent chooses; state the mechanism in the contract table so both sides agree).
6. Update the `--selftest` **known-good fixture** to the new contract (Refs column, nbref-desc
   order, `select#sort`, `#field-census`, census query) and the **known-broken fixture** to violate
   at least two of the new assertions (e.g. table still sorted by separation on load; census
   missing). Run `--selftest`; it must pass from both a temp dir and the project dir.

Threshold rule unchanged: derive numbers from Phase 0, never invent them.

---

## Phase 3 — tidy

- `verify/claude-settings.json` is a stale duplicate of `.claude/settings.json` (which is
  temporarily renamed `.claude/settings.json.off` during this session — do not create a new
  `settings.json`). If the two differ, tell me which one is right; otherwise delete the duplicate.
- Update `.claude/skills/build-sky-explorer/SKILL.md` for the new columns, census and sort control.
- Report: Phase 0 measurements, every file changed, the `--selftest` result, and anything in this
  brief that the live services contradicted. Then stop. Do not touch `app/`.
