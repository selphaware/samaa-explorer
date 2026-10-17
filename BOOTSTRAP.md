# BOOTSTRAP — generate a build-loop harness for this project

You are going to build a **harness**: the deterministic scaffolding that lets an
agent build this project autonomously and verifiably. You are NOT building the
application yet. You are building the thing that will judge the application.

Read this whole file before doing anything.

---

## The project

**What it is:**
> **Samaa Explorer** — a browser-only sky explorer: one static page in HTML5 /
> CSS / vanilla JavaScript, no framework, no build step. The user enters RA/Dec
> or picks a preset (Andromeda M31, Orion Nebula M42, Sagittarius A*, M87,
> Hubble Ultra Deep Field…), chooses a field of view, and the page fetches and
> renders a REAL survey image cutout for that position plus a table of REAL
> catalogued objects in that field. Light, clean, scientific/data-platform look.
> A Python 3.12 / FastAPI backend is introduced only if Phase 0 proves it
> necessary (see the CORS note below) — it is not part of this slice by default.

**Data source:**
> Public astronomy web services. No authentication, no API keys. Two services,
> both to be verified live in Phase 0 — request each from this machine, print
> the raw response and the response headers, and treat what comes back as the
> truth, not this brief.
>
> 1. **Image cutouts — CDS hips2fits** (verified against its documentation on
>    2026-10-17; re-verify by calling it):
>    `https://alasky.cds.unistra.fr/hips-image-services/hips2fits`
>    GET params: `hips` (full HiPS ID), `width`, `height` (pixels; width×height
>    ≤ 50 Mpx), `fov` (decimal degrees, largest image dimension), `ra`, `dec`
>    (decimal degrees, ICRS), `projection` (use `TAN`), `coordsys=icrs`,
>    `format` (`jpg` | `png` | `fits`; default is `fits`, so always pass it),
>    optional `stretch`, `min_cut`, `max_cut`, `cmap` for jpg/png.
>    Example: `…/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&ra=10.6847&dec=41.2687&fov=1.5&width=800&height=800&projection=TAN&coordsys=icrs&format=jpg`
>    Candidate HiPS IDs: `CDS/P/DSS2/color`, `CDS/P/PanSTARRS/DR1/color-z-zg-g`,
>    `CDS/P/2MASS/color`. Confirm each ID returns an image; always pass the full
>    ID, never a keyword — when a keyword matches several surveys the service
>    picks one at random. A second independent host exists at
>    `alaskybis.cds.unistra.fr` (same path). The service asks to be acknowledged
>    ("This research made use of hips2fits … a service provided by CDS") — put
>    that credit in the UI.
>
> 2. **Object catalogue — SIMBAD TAP** (ADQL over HTTP; verified column names
>    `oid`, `main_id`, `ra`, `dec`, `otype`, `otype_txt`, `sp_type`, `nbref` on
>    table `basic`; re-verify the endpoint and output formats by calling it):
>    `https://simbad.cds.unistra.fr/simbad/sim-tap/sync`
>    with `REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=<url-encoded ADQL>`
>    (also try `FORMAT=csv` / `votable` if json is not accepted).
>    Cone search shape (documented CDS example, M13, 0.1°):
>    `SELECT TOP 50 oid, main_id, ra, dec FROM basic WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', 250.423475, 36.4613194, 0.1)) = 1`
>    Every query the app sends MUST carry a `TOP n` cap (n ≤ 500) — a 2° cone on
>    the Galactic plane returns tens of thousands of rows otherwise.
>    Alternatives if SIMBAD TAP is unusable from the browser: VizieR cone search,
>    or the CDS Sesame name resolver for presets.
>
> **CORS — the most important Phase 0 check.** Neither service documents CORS.
> An `<img src>` pointing at hips2fits renders without CORS, so the image half is
> safe; drawing it to a canvas and reading pixels is not. The catalogue half is a
> `fetch()` and needs `Access-Control-Allow-Origin` on sim-tap. Send a request
> with an `Origin: http://localhost:8765` header and record the exact CORS
> headers returned. If sim-tap does not allow it, **this brief is wrong**: say so,
> and the fallback is a minimal FastAPI proxy in Python 3.12 for the catalogue
> call only — never fixture data presented as live.
>
> **Preset coordinates (ICRS, decimal degrees — resolve each via Sesame or
> SIMBAD in Phase 0 and use the resolved values, not mine):**
> Andromeda M31 (10.6847, +41.2687) · Orion Nebula M42 (83.8221, −5.3911) ·
> Sagittarius A* (266.4168, −29.0078) · M87 (187.7059, +12.3911) ·
> Hubble Ultra Deep Field (53.1625, −27.7914) · Crab Nebula M1 (83.6331, +22.0145) ·
> Pleiades M45 (56.75, +24.1167) · Betelgeuse (88.7929, +7.4071).

**The deliverable:**
> - `app/index.html` — the page (markup + mount points; no inline data)
> - `app/css/styles.css` — light scientific aesthetic
> - `app/js/main.js` — UI wiring, state, loading/error/empty states
> - `app/js/services/hips2fits.js` — image service adapter
> - `app/js/services/simbad.js` — catalogue service adapter
> - `app/js/presets.js` — the preset list
> Service adapters are separate modules so a new provider can be added without
> touching the UI. **Gate argument: `app/index.html`.** The gate must serve `app/`
> over `http://localhost:<port>` (Python stdlib `http.server` is fine) rather than
> open it as `file://`, so `fetch()`, CORS and relative paths behave as they will
> for a real user.

**What "working" looks like to a user:**
> They open the page, pick **Andromeda (M31)** from the preset dropdown (or type
> RA `10.6847`, Dec `41.2687`, FoV `1.5`), and click **Explore**. Within a few
> seconds a real DSS2 colour image of M31 appears — the galaxy visibly in frame —
> with a caption showing the survey name, centre RA/Dec, FoV in degrees, and the
> hips2fits/CDS credit. Below it, a table lists real SIMBAD objects in that field:
> `main_id`, object type (`otype_txt`), RA, Dec, and angular separation from the
> centre in arcminutes, sorted by separation, with a row count ("Showing 200 of
> N objects within 0.75°"). Changing FoV or survey and clicking Explore replaces
> the image and re-queries the table. Typing RA `400` shows an inline validation
> error and makes no request. While requests are in flight there is a visible
> loading state; if a service returns an error or times out, the panel says so
> plainly (status code and service name), not "no objects found".

**What "broken but passes tests" looks like:**
> 1. The page renders perfectly — inputs, dropdown, layout, zero console errors —
>    but the image panel is a grey box, a broken `<img>`, a 1×1 pixel, or a
>    `loading.gif` that never gets replaced, because the hips2fits URL was built
>    wrong (missing `format=jpg` so FITS bytes came back, `fov` in arcminutes,
>    `width`/`height` omitted) and the `onerror` handler is a no-op.
> 2. The image loads and looks like a real galaxy — **but it is the wrong
>    place**: RA and Dec got swapped, or the request used the service default, so
>    every preset shows the same field. Any "image has non-zero naturalWidth"
>    check passes. The gate must read the outgoing request URL and assert its
>    `ra`/`dec` match the selected preset within 0.01°.
> 3. The objects table is populated and looks fine — from an inline fixture array
>    or a hard-coded JSON file, and no request to `simbad.cds.unistra.fr` was ever
>    made. The gate must observe a real network request to the catalogue host and
>    a non-error response before counting rows.
> 4. The catalogue call fails (CORS block, 5xx, timeout) and the `catch` renders
>    the empty state "No catalogued objects in this field" — so a dead integration
>    is indistinguishable from an empty patch of sky. Upstream errors must surface
>    as errors.
> 5. The ADQL query has no `TOP` cap; it passes on M31 at 1.5° but a 3° FoV on
>    Sgr A* hangs the tab or gets the client throttled. The gate should assert the
>    outgoing query text contains a `TOP` cap.
> The gate therefore loads `app/index.html` in headless Chromium via a local HTTP
> server, selects the Andromeda preset, clicks Explore, intercepts network
> traffic, and asserts: (a) ≥ 1 request to the hips2fits host whose `ra`/`dec`
> match M31 within 0.01° and whose response is `200` with `image/*`, and the
> rendered `<img>` has `naturalWidth ≥ 200`; (b) ≥ 1 request to the catalogue
> host containing `TOP` and `CIRCLE(`, with a non-error response, and the table
> shows ≥ N real rows where **N is set in Phase 0** from the actual SIMBAD count
> for a 0.75° radius around M31 (take well under half of it — never a number
> the data cannot supply); (c) no uncaught console errors. Fixture data must not
> be able to satisfy (a) or (b).

**Environment (fill in what you already know):**
> - Python interpreter: `E:\CODE\samaa-explorer\.venv\Scripts\python.exe`
>   **— this venv already exists; do not create a new one**
> - Node/npm needed? **No** — vanilla JS, no bundler, no CDN dependency required.
> - Already installed (gate dependencies): `playwright` + Chromium
>   (verified: `chromium ok 156.0.8078.4` from this interpreter)
> - You may install (app runtime dependencies): **none expected** for the
>   browser-only slice. Only if Phase 0 forces a proxy: `fastapi`, `uvicorn`,
>   `httpx` — install into the interpreter above, never into a new venv.
> - Anything else the project needs: Windows 11 workstation, project on local
>   disk `E:\` (not a mapped or UNC drive); outbound HTTPS to
>   `alasky.cds.unistra.fr` and `simbad.cds.unistra.fr`; one free local port for
>   the gate's static server (suggest 8765, make it configurable). No secrets,
>   no env vars. Check each service's data-use terms in Phase 0 and keep the
>   CDS acknowledgement visible in the UI.

> **Note on the venv:** it is created by the user *before* this session, because
> the gate self-tests using that interpreter. An agent that builds its own
> verification environment has nothing trustworthy to verify with. App runtime
> packages are different — install those as you discover you need them.

---

The "broken but passes tests" line is the most important thing on this page.
**It defines the gate, and the gate is the whole system.**

---

## Phase 0 — Discover the environment. Do not skip. Do not assume.

Assumptions about the environment are the single biggest source of wasted
iterations. Establish facts first, and **write them down** in the harness.

1. **Find the real Python interpreter.**
   - On Windows, bare `python` may resolve to the Microsoft Store alias stub at
     `...\WindowsApps\python.exe`, which is a 0-byte shim that cannot execute.
     Detect and reject it explicitly.
   - Report the absolute path you will use. Verify with `<path> --version`.
2. **Find the Node/npm toolchain** if the project needs one. Same rule: absolute
   path, verified by running it.
3. **Check the project location.** Resolve the working directory to an absolute
   path. If it is a mapped network drive or UNC path, say so — headless browsers
   and `file://` URIs behave differently there, and it is far cheaper to know now.
4. **Inspect the data source once.** API: request it and print the raw response
   — and if it errors, diagnose before proceeding (a 403 is as likely to be a
   missing `User-Agent` header as a firewall). File: read the real header and a
   few sample rows. Database: query the schema. Note the true field names,
   nesting, and types. The live source is the truth, not this brief.
5. **Report all of the above back to me before writing any files.**

---

## Phase 1 — Design the gate FIRST

The gate is the harness. Everything else is support. Build it before anything else.

**The gate must catch the failure mode named above**, not merely confirm the code
runs. Lint, type checks, and "it built successfully" do not catch a page that
renders blank, an API that returns `[]`, or a report with every field empty.

Pick the verification method that actually observes the deliverable:

| Deliverable | Gate must |
|---|---|
| HTML/JS frontend | load it in headless Chromium and assert real data is on screen |
| HTTP API | start it, make real requests, assert status + response shape |
| CLI tool | run it on fixture input, assert stdout/exit code |
| Data pipeline | run it, assert output row counts, schema, and value sanity |

Requirements for the gate:

- **Binary.** Exit 0 = pass, non-zero = fail. No warnings tier, no partial credit.
- **Specific failure messages.** Not "verification failed" but "0 populated KPI
  values (need >= 3) — check `.kpi-card .kpi-value` is non-empty". The message is
  fed back to the agent; a vague message costs an iteration.
- **Fast.** It runs on every edit. Seconds, not minutes.
- **Thresholds derived from the real data**, not invented. If the source only
  supports 2 metrics, a gate demanding 3 can never pass and the agent will thrash
  forever inventing filler. Check the actual data before setting numbers.
- **Distinguishes harness failure from deliverable failure.** If a dependency is
  missing or the interpreter is wrong, say "HARNESS ERROR — this is not a
  deliverable problem" and do NOT blame the code.

**Standard layout — do not deviate:** the gate lives at `verify/smoke_test.py`,
takes the deliverable path as its argument, supports a `--selftest` flag, and
writes any screenshots to `verify/artifacts/`. A consistent layout means the
same kickoff prompt works on every project.

**Then prove the gate works.** Add a `--selftest` mode that:
- writes a known-GOOD artifact and asserts the gate passes it
- writes a known-BROKEN artifact and asserts the gate fails it
- runs both from a local temp dir and from the project dir, and reports if they
  disagree

Run the self-test. **A gate you have not watched fail is not a gate.** Do not
proceed until it discriminates correctly.

---

## Phase 2 — Build the rest of the harness

### `CLAUDE.md` — always-loaded conventions
- The definition of done, stated as the literal gate command.
- The contract the deliverable must satisfy, as a table.
- The environment facts from Phase 0 (absolute interpreter paths).
- Guardrails: no secrets in code, no editing the harness, scope of writes.
- An autonomy clause: work through gate failures independently; only stop if the
  same failure repeats 3 times or an external dependency is unreachable.

### The verification hook — the inner loop
- A `PostToolUse` hook matching `Write|Edit` that runs the gate.
- Exit 2 on failure, with the gate output on stderr — this feeds the failure back
  to the model mid-run, so it corrects itself before it can declare done.
- Exit 0 for harness errors, so a broken environment never gets blamed on the code.
- **Pin the interpreter with an absolute path in the hook command.** A bare
  `python` that resolves to a stub makes the hook die silently — no error, just
  no verification, and you will not notice.
- Write the hook in a language that needs no extra tooling (Python stdlib is
  ideal; avoid bash/jq dependencies on Windows).

### A skill — the reusable procedure
The steps to build this kind of deliverable, in order, with a
"common failures and their real causes" table.

### `settings.json`
- Register the hook with the absolute interpreter path.
- Allowlist the tools needed to run unattended.
- **Deny edits to the gate and the harness directory.** A self-verifying agent
  that can edit its own judge will eventually edit its own judge.

### The task spec (`spec.md`)
Concrete, not a template. Real endpoints, real field names from Phase 0, the
actual metrics and views wanted, and any known traps in the data (scale
mismatches, gaps, nulls).

### An outer loop script (optional)
Headless run → gate → resume with failure → escalate after N iterations. Only
build this once the interactive loop is proven.

---

## Phase 3 — Prove the whole thing

Before you tell me it is done:

1. `--selftest` passes (gate discriminates good from broken).
2. The hook logic is proven **by direct invocation** — pipe a simulated
   tool-use JSON payload into the hook script on stdin and confirm: exit 2 with
   a useful message for a broken deliverable, exit 0 for a good one, and exit 0
   (with a "HARNESS ERROR" message, not a code complaint) for a missing
   dependency or interpreter.
   **Important:** the live hook CANNOT fire in this session — hooks register at
   session start, and this harness did not exist when this session started. Do
   not claim otherwise. State clearly in your final report that the user must
   restart Claude Code and run the live-fire test themselves.
3. Every absolute path in the harness has been verified to exist and run.
4. Report: the exact gate command the user should put in their kickoff prompt,
   the interpreter path, the hook status (including the restart requirement
   above), and anything you discovered in Phase 0 that contradicted this brief.

Then stop. Do not build the application. I will start that in a fresh session.

---

## Rules

- **Verify, don't assert.** Every claim about the environment must come from a
  command you ran, not from what is usually true.
- **Tell me when this brief is wrong.** If Phase 0 contradicts something above,
  say so plainly rather than working around it silently.
- Prefer fewer moving parts. Every dependency is something that can drift.