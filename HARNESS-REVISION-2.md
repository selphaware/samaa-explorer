# HARNESS REVISION 2 — Custom preset, shareable URL, preset library

You are revising the **harness** (`verify/smoke_test.py`, its `--selftest` fixtures, `CLAUDE.md`,
`spec.md`, the skill, `README.md`) and adding a **data-build tool** under `tools/`. You are NOT
building or editing the application under `app/` — the build happens in a separate session against
the revised `spec.md`. The one exception is `app/data/presets.json`, which is *data* produced by the
tool you write here; you generate it in this session so the build agent has real data to build
against, and the gate validates it.

Read this whole file, then `CLAUDE.md`, `spec.md`, `HARNESS-REVISION-1.md` and
`verify/smoke_test.py`, before changing anything.

---

## Why

Slice 1.1 passed and a human reviewed it. Two findings:

1. Typing bespoke RA/Dec/FoV leaves the preset select showing whatever was last chosen, and the
   typed values are lost the moment a preset is picked. A bespoke position should be a first-class
   thing: visible as **Custom** in the select, remembered, and shareable.
2. Eight presets is a demo. The product promise is "select a place in the sky → see what humanity
   has observed there", which needs a real library — hundreds of places — without anyone typing
   coordinates by hand.

Decisions (human):

- `Custom` is the first option in `select#preset`. Editing any of `#ra`, `#dec`, `#fov` switches
  the select to Custom and stores that set; it persists across reloads.
- A view is a URL: after Explore the hash carries `ra`, `dec`, `fov`, `hips`. Opening such a URL
  pre-fills, selects Custom (or the matching preset), and runs Explore automatically.
- The library is **data resolved from SIMBAD by a script**, with provenance, grouped by category.
  Nobody types a coordinate. Adding a preset later means adding a CSV row and re-running the script.

---

## Phase 0 — measure before you change the contract (verify, don't assert)

1. **Batch name resolution via SIMBAD TAP.** Confirm this shape works and how it behaves for
   misses, using 20 names from the categories below (include two deliberately wrong names):
   ```sql
   SELECT i.id, b.main_id, b.ra, b.dec, b.otype, od.description, b.galdim_majaxis, b.nbref
   FROM ident i JOIN basic b ON b.oid = i.oidref
   LEFT JOIN otypedef od ON od.otype = b.otype
   WHERE i.id IN ('M 31', 'M 42', 'NAME Sgr A*', 'C 14', 'Cyg X-1', ...)
   ```
   Record: exact `ident.id` spelling rules (SIMBAD's identifier whitespace, e.g. `M  31` vs
   `M 31` — test whether `ident` matches the normalised form), how many names per `IN` list is
   safe (try 50 and 110), timings, and whether `galdim_majaxis` is populated for Messier/Caldwell
   objects (it is an angular size in **arcmin**; confirm the unit from the TAP metadata).
   Fallback for misses: CDS Sesame (`https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?<name>`)
   — confirm it answers and what XML it returns.
2. **Playwright behaviour you will rely on**, proven in a scratch page, not assumed:
   `<option hidden disabled>` inside `<optgroup>` is skipped by keyboard navigation and reported
   as hidden; `page.select_option('#preset', 'm31')` works by value inside an `<optgroup>`;
   `localStorage` survives `page.reload()` in one context; `page.goto(url + '#ra=…')` delivers
   the hash to `location.hash`.
3. Report all of the above before editing any file.

---

## Phase 1 — the catalogue and the build tool (`tools/`)

### `tools/preset_catalogue.csv` — the human-curated list of NAMES (no coordinates)
Columns: `id,label,category,query_name,fov_override`.
- `id`: stable slug, lowercase, e.g. `m31`, `c14`, `sgr-a-star`, `cyg-x-1`.
- `label`: display text, e.g. `Andromeda Galaxy (M31)`, `Double Cluster (C14)`, `Cygnus X-1`.
- `category`: one of `Galaxies`, `Nebulae`, `Star clusters`, `Stars`, `Deep fields`,
  `Exotic & high-energy`. Nothing else.
- `query_name`: the name to resolve, in SIMBAD's preferred form (`M 31`, `C 14`, `NAME Sgr A*`,
  `* alf Ori`, `NAME Hubble Ultra Deep Field`).
- `fov_override`: blank, or a FoV in degrees that wins over the derived value.

Contents (target ≈ 300 rows):
- All 110 Messier objects (`M 1` … `M 110`), categorised by type (SIMBAD `otype` tells you).
- All 109 Caldwell objects (`C 1` … `C 109`), likewise.
- ~40 famous stars: the 25 brightest plus the well-known names (Betelgeuse, Rigel, Vega, Sirius,
  Polaris, Antares, Deneb, Altair, Aldebaran, Mira, Algol, Proxima Centauri, Barnard's Star,
  Eta Carinae, Wolf 359, TRAPPIST-1, 61 Cygni, Tau Ceti, Epsilon Eridani, Kepler-186…).
- ~15 deep fields and survey regions: HDF-N, HUDF, CDF-S, GOODS-N, GOODS-S, COSMOS, Lockman Hole,
  Extended Groth Strip, Abell 2744 (Frontier Field), MACS J0416, SMACS 0723, Chandra Deep
  Field North…
- ~30 exotic / high-energy / landmark objects: Sgr A*, Cyg X-1, SS 433, Cas A, Tycho's SNR,
  Kepler's SNR, SN 1987A, Crab pulsar, Geminga, PSR B1919+21, 3C 273, 3C 48, Cen A, M87* (M 87
  already covered — use the galaxy), Hoag's Object, Einstein Cross, Bullet Cluster, Abell 1689,
  El Gordo, Perseus Cluster (NGC 1275), Hercules A, Cygnus A, Fornax A, Boomerang Nebula…
- The eight existing presets keep their current labels and `fov_override` = their current FoVs.
- No Solar System bodies (they move) and no proper motion corrections — state this in the README.

### `tools/build_presets.py` — resolves the catalogue into data
- Standard library only (`urllib`, `json`, `csv`). Runs with the pinned interpreter.
- Reads the CSV, resolves `query_name` in batches via the Phase 0 TAP query, falls back to Sesame
  per miss, and **fails loudly** (non-zero exit, list of unresolved names) rather than writing
  a partial file with guesses.
- Derived FoV when `fov_override` is blank: if `galdim_majaxis` present, `clamp(1.5 × majaxis/60,
  0.1, 3.0)` degrees; otherwise category default — Galaxies 0.5, Nebulae 1.0, Star clusters 1.0,
  Stars 0.5, Deep fields 0.2, Exotic 0.3. Round to 2 dp.
- Writes `app/data/presets.json`:
  ```json
  { "generated_at": "<ISO 8601 UTC>", "source": "SIMBAD TAP (basic/ident) via tools/build_presets.py",
    "presets": [ { "id": "m31", "label": "Andromeda Galaxy (M31)", "category": "Galaxies",
                   "main_id": "M  31", "ra": 10.68470833, "dec": 41.26875, "fov": 1.5,
                   "otype": "AGN", "otype_desc": "Active Galaxy Nucleus",
                   "resolved_by": "SIMBAD TAP", "resolved_at": "2026-10-17" }, ... ] }
  ```
  Sorted by category (in the order listed above), then label. `ra` in [0, 360), `dec` in
  [−90, 90], `fov` in [0.05, 10]. Duplicate `id`s or two entries within 0.001° of each other are
  errors.
- **Run it in this session** and commit the output. Report how many resolved via TAP, how many
  via Sesame, how many failed (fix the CSV spelling for failures; do not drop them silently).

---

## Phase 2 — contract changes (`spec.md` §1, §2, §3, §6, §7; `CLAUDE.md` contract table)

### Files
- `app/data/presets.json` joins the deliverable list (generated; the build agent must not edit it
  by hand — if a preset is wrong, fix the CSV and re-run the tool). `app/js/presets.js` becomes a
  loader: `fetch('data/presets.json')`, validates shape, exposes the list and a lookup by id.
- `tools/` is outside `app/`; the hook does not fire on it and the gate does not run it.

### `select#preset`
- First option: `value="custom"`, label `Custom`. Then one `<optgroup label="<category>">` per
  category in catalogue order, each `<option value="<id>">` with the label. ≥ 250 named options.
- Default on a plain load with no hash and no stored custom set: `m31`, inputs filled, nothing fetched.
- Changing to a named preset fills `#ra`, `#dec`, `#fov`; survey unchanged. No fetch.
- **Custom semantics:** on `input` in any of `#ra`, `#dec`, `#fov`, set the select to `custom`
  and store `{ra, dec, fov}` as the custom set (in memory and `localStorage` key `samaa.custom`).
  Selecting `custom` restores the stored set (or leaves inputs as they are if none stored). On
  load, if `localStorage` holds a custom set *and* the last selection (`samaa.lastPreset`) was
  `custom`, restore it and select Custom; nothing fetched.
- Preset label and `main_id` appear in `#image-caption` when a named preset is active;
  `Custom position` when Custom is.

### `input#preset-filter`
- `type="search"`, placeholder `Filter presets…`, directly above the select. Case-insensitive
  substring match on label and `main_id`. Non-matching options get `hidden` and `disabled`;
  an `<optgroup>` with no visible options is hidden. Clearing the filter restores everything.
  The current selection never changes because of filtering.

### Shareable URL
- After a successful Explore, set `location.hash` to
  `ra=<n>&dec=<n>&fov=<n>&hips=<encoded id>[&preset=<id>]` (`history.replaceState`, no
  navigation). Omit `preset` when Custom.
- On load with a hash: parse, validate with the existing rules, fill inputs, set survey, select
  `preset` if present and valid else `custom`, then **run Explore automatically**. Invalid hash
  values → `#form-error` message, nothing fetched.

### Behaviour (§6) — add
- Type RA `83.82` over a preset → select shows Custom; pick Andromeda → inputs change; pick Custom
  → `83.82` is back. Reload → still Custom with `83.82`.
- Type `crab` in the filter → only Crab-related options remain selectable; clear → all back.
- Explore → the URL changes; copy it into a new tab → same view loads and runs by itself.

### Traps (§7) — add what Phase 0 found about `ident` spelling, `galdim_majaxis` units,
`IN` list size, Sesame XML, and anything Playwright did that you did not expect.

### README
- Document `tools/build_presets.py` (how to add a preset: CSV row → run → commit JSON), the
  no-Solar-System rule, and the URL hash format.

---

## Phase 3 — gate changes (`verify/smoke_test.py`)

Keep every existing check. Add, and keep each failure message specific:

1. **Preset data.** Parse `app/data/presets.json` from disk: ≥ 250 presets; every field present and
   in range; `id`s unique; categories from the fixed set; no two entries within 0.001°; every
   `id` has a `resolved_by` and `resolved_at`. Then, **live**, pick 5 entries deterministically
   (seeded PRNG, seed `20261017`, over the sorted id list) and resolve their `main_id` via the
   TAP `ident` query; each must agree with the JSON within 0.01°. SIMBAD unavailable → exit 3
   through the existing upstream-diagnosis path; a genuine mismatch → exit 1 naming the preset.
2. **Select structure.** `#preset` has first option `custom`; ≥ 250 other options; every option
   value exists in the JSON and vice-versa; options are inside `<optgroup>`s whose labels are the
   categories.
3. **Custom round-trip.** Load without hash. Fill `#ra` with `83.82` → `#preset` value is `custom`.
   `select_option('#preset', 'm31')` → `#ra` is M31's. `select_option('#preset', 'custom')` →
   `#ra` is `83.82`. `page.reload()` → `#preset` is `custom` and `#ra` is `83.82`. No network
   request to either astronomy host during any of this.
4. **Filter.** Fill `#preset-filter` with `crab` → the count of options that are neither hidden
   nor disabled is ≥ 1 and ≤ 5 and includes `m1`; clear it → count equals the full library + 1.
5. **Hash round-trip.** After the existing M31 Explore, `location.hash` contains `ra=`, `dec=`,
   `fov=`, `hips=` with M31's values within 0.001°. Then `goto(index#ra=83.8201&dec=-5.3876&fov=1.0&hips=<DSS2 id>)`
   in a fresh page → inputs filled, `#preset` is `custom` (or `m42` if you decide matching
   coordinates select the preset — state which in the contract), and both astronomy hosts
   receive a request without any click.
6. Update the `--selftest` **known-good fixture** (it needs a small `presets.json` with ≥ 250
   synthetic-but-valid entries *clearly marked as fixtures* in `generated_at`/`source`, Custom
   semantics, filter, hash) and the **known-broken fixture** to violate at least three of the new
   checks (e.g. 8 presets only; Custom not set on input; hash never written). The live spot-check
   must be skipped for fixture data and say so — fixtures carry `"source": "SELFTEST FIXTURE"`.
   Run `--selftest`; it must pass from a temp dir and the project dir.

Thresholds (≥ 250, 0.01°, ≤ 5 filter hits) are set above by the human; if Phase 0 or the real
library makes any of them wrong, say so rather than tuning silently.

---

## Phase 4 — tidy and report

- Update `.claude/skills/build-sky-explorer/SKILL.md` for presets.json, Custom, filter, hash.
- Confirm `app/data/presets.json` is the only thing under `app/` you created, and that the current
  app now fails the gate on **only** the new checks (list them) with no regressions.
- Report: Phase 0 findings, resolution counts (TAP / Sesame / failed), files changed, `--selftest`
  result, and anything in this brief the live services or Playwright contradicted. Then stop.
