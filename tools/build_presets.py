#!/usr/bin/env python
"""Build app/data/presets.json from tools/preset_catalogue.csv by resolving every name in SIMBAD.

    E:\\CODE\\samaa-explorer\\.venv\\Scripts\\python.exe tools\\build_presets.py
        [--csv tools/preset_catalogue.csv] [--out app/data/presets.json] [--batch 100]
        [--no-sesame] [--dry-run] [--verbose]

Standard library only. Nobody types a coordinate: the CSV holds names, this script asks SIMBAD TAP
(table `ident` joined to `basic` and `otypedef`) in batches, retries the leftovers one name at a time,
asks CDS Sesame for whatever SIMBAD TAP still does not know, and FAILS LOUDLY - exit 1, nothing
written - if any name stays unresolved, two entries land on the same spot, or a value is out of range.

To add a preset: append a CSV row (id,label,category,query_name,fov_override), run this script,
commit the regenerated JSON. Never edit app/data/presets.json by hand.

Facts this script relies on (measured 2026-10-17, see spec.md section 7):
  - `ident.id` comparisons normalise case and whitespace ('M 31', 'M31', 'm  31' all match) but the
    row comes back with SIMBAD's canonical spelling ('M  31', or 'X Cyg X-1' for 'Cyg X-1'), so a
    batch answer is attributed back to the asked name by a whitespace-free lower-case key and the
    leftovers are re-asked one by one.
  - `UNION` is not supported by SIMBAD's ADQL, GET URLs over ~8 KB answer HTTP 414 (so: POST), and a
    1000-name IN list answers in about a second.
  - `galdim_majaxis` is in arcminutes.
  - Sesame answers HTTP 200 with Content-Type text/plain whose body is XML; a miss is still HTTP 200
    with `<INFO> *** Nothing found *** </INFO>` and no <Resolver> element.

Exit codes: 0 written - 1 catalogue / resolution / validation problem (nothing written)
            3 SIMBAD TAP or Sesame unreachable - 4 usage
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover
        pass

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = ROOT / "tools" / "preset_catalogue.csv"
DEFAULT_OUT = ROOT / "app" / "data" / "presets.json"

TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
SESAME = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?"
UA = "samaa-explorer build_presets/2.0 (python-urllib)"
TIMEOUT_S = 60

CSV_COLUMNS = ["id", "label", "category", "query_name", "fov_override"]
CATEGORIES = ["Galaxies", "Nebulae", "Star clusters", "Stars", "Deep fields", "Exotic & high-energy"]
CATEGORY_DEFAULT_FOV = {"Galaxies": 0.5, "Nebulae": 1.0, "Star clusters": 1.0, "Stars": 0.5,
                        "Deep fields": 0.2, "Exotic & high-energy": 0.3}
SIZE_FACTOR, FOV_FLOOR, FOV_CAP = 1.5, 0.1, 3.0     # derived FoV = clamp(1.5 x majaxis_arcmin / 60, 0.1, 3.0) deg
FOV_RANGE = (0.05, 10.0)
MIN_SEPARATION_DEG = 0.001
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
SOURCE = "SIMBAD TAP (basic/ident) via tools/build_presets.py"

SELECT = ("SELECT i.id, b.main_id, b.ra, b.dec, b.otype, od.description, b.galdim_majaxis, b.nbref "
          "FROM ident i JOIN basic b ON b.oid = i.oidref LEFT JOIN otypedef od ON od.otype = b.otype "
          "WHERE i.id ")


class CatalogueError(Exception):
    """A problem in the CSV, the resolution or the result. Exit 1, nothing written."""


class NetworkError(Exception):
    """SIMBAD TAP / Sesame unreachable or answering 5xx. Exit 3."""


# --------------------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------------------
def http(url: str, post: dict | None = None, attempts: int = 2) -> tuple[int, bytes]:
    data = urllib.parse.urlencode(post).encode("utf-8") if post is not None else None
    headers = {"User-Agent": UA}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    last = ""
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=TIMEOUT_S) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            body = e.read()
            if e.code < 500:
                return e.code, body
            last = f"HTTP {e.code}"
        except Exception as e:  # URLError, socket timeout, ConnectionReset ...
            last = f"{e.__class__.__name__}: {getattr(e, 'reason', e)}"
        if attempt < attempts:
            time.sleep(3)
    raise NetworkError(f"{urllib.parse.urlsplit(url).netloc} did not answer ({last}) after {attempts} attempts")


def adql_literal(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def tap(adql: str) -> list[dict]:
    """Run one ADQL query (POST, JSON); rows as dicts keyed by column name."""
    status, body = http(TAP, {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": adql})
    if status != 200:
        m = re.search(r'QUERY_STATUS"\s+value="ERROR">([^<]*)<', body.decode("utf-8", "replace"))
        raise CatalogueError(f"SIMBAD TAP answered HTTP {status} to the resolver query: "
                             f"{(m.group(1).strip() if m else body[:200].decode('utf-8', 'replace'))!r}\n  query: {adql[:300]}")
    j = json.loads(body)
    names = [c["name"] for c in j["metadata"]]
    return [dict(zip(names, row)) for row in j["data"]]


def key(name: str) -> str:
    """Attribution key: SIMBAD ignores case and whitespace when matching ident.id."""
    return re.sub(r"\s+", "", name).lower()


# --------------------------------------------------------------------------------------
# Catalogue
# --------------------------------------------------------------------------------------
def read_catalogue(path: Path) -> list[dict]:
    if not path.is_file():
        raise CatalogueError(f"catalogue not found: {path}")
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != CSV_COLUMNS:
            raise CatalogueError(f"{path.name} must have exactly the columns {','.join(CSV_COLUMNS)} "
                                 f"(found {','.join(reader.fieldnames or [])})")
        rows = [{k: (v or "").strip() for k, v in r.items()} for r in reader]
    problems = []
    seen_ids: dict[str, int] = {}
    seen_names: dict[str, int] = {}
    for n, r in enumerate(rows, start=2):
        if not ID_RE.match(r["id"]):
            problems.append(f"line {n}: id {r['id']!r} is not a slug (lowercase letters, digits, hyphens)")
        if r["id"] in seen_ids:
            problems.append(f"line {n}: duplicate id {r['id']!r} (also line {seen_ids[r['id']]})")
        seen_ids.setdefault(r["id"], n)
        if not r["label"]:
            problems.append(f"line {n}: empty label")
        if r["category"] not in CATEGORIES:
            problems.append(f"line {n}: category {r['category']!r} is not one of {CATEGORIES}")
        if not r["query_name"]:
            problems.append(f"line {n}: empty query_name")
        if key(r["query_name"]) in seen_names:
            problems.append(f"line {n}: query_name {r['query_name']!r} repeats line {seen_names[key(r['query_name'])]}")
        seen_names.setdefault(key(r["query_name"]), n)
        if r["fov_override"]:
            try:
                v = float(r["fov_override"])
                if not (FOV_RANGE[0] <= v <= FOV_RANGE[1]):
                    raise ValueError
            except ValueError:
                problems.append(f"line {n}: fov_override {r['fov_override']!r} must be blank or a number in "
                                f"[{FOV_RANGE[0]}, {FOV_RANGE[1]}] degrees")
    if problems:
        raise CatalogueError(f"{len(problems)} problem(s) in {path.name}:\n  " + "\n  ".join(problems))
    if not rows:
        raise CatalogueError(f"{path.name} has no rows")
    return rows


# --------------------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------------------
def tap_row(r: dict, via: str) -> dict:
    return {
        "main_id": r["main_id"], "ra": float(r["ra"]), "dec": float(r["dec"]), "otype": r["otype"],
        "otype_desc": r["description"], "size_arcmin": (None if r["galdim_majaxis"] is None else float(r["galdim_majaxis"])),
        "nbref": (None if r["nbref"] is None else int(r["nbref"])), "resolved_by": "SIMBAD TAP", "resolved_via": via,
    }


def resolve_tap_batch(names: list[str], batch: int, verbose: bool) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(names), batch):
        chunk = names[i:i + batch]
        t0 = time.time()
        rows = tap(SELECT + "IN (" + ", ".join(adql_literal(n) for n in chunk) + ")")
        by_key: dict[str, dict] = {}
        for r in rows:
            by_key.setdefault(key(r["id"]), r)
        hits = 0
        for n in chunk:
            r = by_key.get(key(n))
            if r is not None and r["ra"] is not None and r["dec"] is not None:
                out[n] = tap_row(r, "tap-batch")
                hits += 1
        if verbose:
            print(f"  TAP batch {i // batch + 1}: {len(chunk)} names -> {len(rows)} rows, {hits} attributed in {time.time() - t0:.2f}s")
    return out


def resolve_tap_single(names: list[str], verbose: bool) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for n in names:
        t0 = time.time()
        rows = [r for r in tap(SELECT + "= " + adql_literal(n)) if r["ra"] is not None and r["dec"] is not None]
        if rows:
            out[n] = tap_row(rows[0], "tap-single")
        if verbose:
            print(f"  TAP single {n!r}: {'-> ' + rows[0]['main_id'] if rows else 'no row'} in {time.time() - t0:.2f}s")
    return out


SESAME_RESOLVER_RE = re.compile(r"<Resolver\s+name=\"([^\"]*)\"[^>]*>(.*?)</Resolver>", re.S)


def sesame_tag(block: str, tag: str) -> str | None:
    m = re.search(rf"<{tag}>([^<]*)</{tag}>", block)
    return m.group(1).strip() if m else None


def resolve_sesame(names: list[str], verbose: bool) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for n in names:
        t0 = time.time()
        status, body = http(SESAME + urllib.parse.quote(n), attempts=2)
        text = body.decode("utf-8", "replace")
        if status != 200:
            raise NetworkError(f"Sesame answered HTTP {status} for {n!r}")
        hit = None
        for resolver, block in SESAME_RESOLVER_RE.findall(text):
            ra, dec = sesame_tag(block, "jradeg"), sesame_tag(block, "jdedeg")
            if ra is None or dec is None:
                continue
            nrefs = sesame_tag(block, "nrefs")
            hit = {
                "main_id": sesame_tag(block, "oname") or n, "ra": float(ra), "dec": float(dec),
                "otype": sesame_tag(block, "otype"), "otype_desc": None, "size_arcmin": None,
                "nbref": int(nrefs) if nrefs and nrefs.isdigit() else None,
                "resolved_by": f"CDS Sesame ({resolver.split('(')[0].strip()})", "resolved_via": "sesame",
            }
            break
        if hit:
            out[n] = hit
        if verbose:
            info = sesame_tag(text, "INFO")
            print(f"  Sesame {n!r}: {'-> ' + hit['main_id'] if hit else 'miss (' + str(info) + ')'} in {time.time() - t0:.2f}s")
    return out


def otype_descriptions() -> dict[str, str]:
    return {r["otype"]: r["description"] for r in tap("SELECT otype, description FROM otypedef") if r["otype"]}


# --------------------------------------------------------------------------------------
# Derivation and validation
# --------------------------------------------------------------------------------------
def derive_fov(override: str, size_arcmin: float | None, category: str) -> tuple[float, str]:
    if override:
        return round(float(override), 2), "override"
    if size_arcmin is not None and size_arcmin > 0:
        return round(min(FOV_CAP, max(FOV_FLOOR, SIZE_FACTOR * size_arcmin / 60.0)), 2), "size"
    return CATEGORY_DEFAULT_FOV[category], "category"


def separation_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    r = math.radians
    a = (math.sin(r(dec1)) * math.sin(r(dec2)) + math.cos(r(dec1)) * math.cos(r(dec2)) * math.cos(r(ra1 - ra2)))
    return math.degrees(math.acos(max(-1.0, min(1.0, a))))


def natural_key(label: str) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", label)]


def validate(presets: list[dict]) -> None:
    problems = []
    for p in presets:
        if not (0 <= p["ra"] < 360):
            problems.append(f"{p['id']}: ra {p['ra']} outside [0, 360)")
        if not (-90 <= p["dec"] <= 90):
            problems.append(f"{p['id']}: dec {p['dec']} outside [-90, 90]")
        if not (FOV_RANGE[0] <= p["fov"] <= FOV_RANGE[1]):
            problems.append(f"{p['id']}: fov {p['fov']} outside {FOV_RANGE}")
        if not p["main_id"]:
            problems.append(f"{p['id']}: empty main_id")
    for i in range(len(presets)):
        for j in range(i + 1, len(presets)):
            a, b = presets[i], presets[j]
            sep = separation_deg(a["ra"], a["dec"], b["ra"], b["dec"])
            if sep < MIN_SEPARATION_DEG:
                problems.append(f"{a['id']} ({a['label']}, {a['main_id']}) and {b['id']} ({b['label']}, {b['main_id']}) "
                                f"are {sep * 3600:.1f} arcsec apart - the same place twice; drop one or pick another target")
    if problems:
        raise CatalogueError(f"{len(problems)} problem(s) in the resolved library:\n  " + "\n  ".join(problems))


# --------------------------------------------------------------------------------------
def build(csv_path: Path, out_path: Path, batch: int, use_sesame: bool, dry_run: bool, verbose: bool) -> int:
    rows = read_catalogue(csv_path)
    names = [r["query_name"] for r in rows]
    print(f"catalogue: {len(rows)} rows in {csv_path}")

    t0 = time.time()
    resolved = resolve_tap_batch(names, batch, verbose)
    left = [n for n in names if n not in resolved]
    print(f"SIMBAD TAP batches of {batch}: {len(resolved)} attributed, {len(left)} left ({time.time() - t0:.1f}s)")
    if left:
        t1 = time.time()
        single = resolve_tap_single(left, verbose)
        resolved.update(single)
        left = [n for n in left if n not in resolved]
        print(f"SIMBAD TAP one by one: {len(single)} resolved, {len(left)} left ({time.time() - t1:.1f}s)")
    if left and use_sesame:
        t2 = time.time()
        via_sesame = resolve_sesame(left, verbose)
        resolved.update(via_sesame)
        left = [n for n in left if n not in resolved]
        print(f"CDS Sesame: {len(via_sesame)} resolved, {len(left)} left ({time.time() - t2:.1f}s)")
    if left:
        raise CatalogueError(f"{len(left)} name(s) could not be resolved - fix the spelling in {csv_path.name} "
                             f"(SIMBAD's own form, e.g. 'NGC 869' not 'C 14'); nothing written:\n  " + "\n  ".join(repr(n) for n in left))

    descriptions = otype_descriptions()
    today = datetime.now(timezone.utc)
    presets = []
    for r in rows:
        hit = resolved[r["query_name"]]
        fov, fov_source = derive_fov(r["fov_override"], hit["size_arcmin"], r["category"])
        otype_desc = hit["otype_desc"] if hit["otype_desc"] is not None else descriptions.get(hit["otype"] or "")
        presets.append({
            "id": r["id"], "label": r["label"], "category": r["category"], "query_name": r["query_name"],
            "main_id": hit["main_id"], "ra": round(hit["ra"], 8), "dec": round(hit["dec"], 8), "fov": fov,
            "fov_source": fov_source, "size_arcmin": hit["size_arcmin"], "otype": hit["otype"], "otype_desc": otype_desc,
            "nbref": hit["nbref"], "resolved_by": hit["resolved_by"], "resolved_via": hit["resolved_via"],
            "resolved_at": today.strftime("%Y-%m-%d"),
        })
    presets.sort(key=lambda p: (CATEGORIES.index(p["category"]), natural_key(p["label"])))
    validate(presets)

    via = Counter(p["resolved_via"] for p in presets)
    print(f"resolved {len(presets)}/{len(rows)}: SIMBAD TAP {via['tap-batch'] + via['tap-single']} "
          f"(batch {via['tap-batch']}, single {via['tap-single']}), Sesame {via['sesame']}, failed 0")
    for p in presets:
        if p["resolved_via"] != "tap-batch":
            print(f"  {p['resolved_via']:10} {p['query_name']!r} -> {p['main_id']!r} ({p['resolved_by']})")
    cats = Counter(p["category"] for p in presets)
    print("categories: " + ", ".join(f"{c} {cats[c]}" for c in CATEGORIES))
    fovs = Counter(p["fov_source"] for p in presets)
    print(f"fov: {fovs['override']} overrides, {fovs['size']} from galdim_majaxis, {fovs['category']} category defaults")

    doc = {
        "generated_at": today.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": SOURCE,
        "catalogue": str(csv_path.relative_to(ROOT)).replace("\\", "/") if csv_path.is_relative_to(ROOT) else csv_path.name,
        "fov_rule": f"fov_override, else clamp({SIZE_FACTOR} x galdim_majaxis[arcmin] / 60, {FOV_FLOOR}, {FOV_CAP}) deg, "
                    f"else category default " + json.dumps(CATEGORY_DEFAULT_FOV),
        "count": len(presets),
        "presets": presets,
    }
    if dry_run:
        print(f"dry run: {out_path} not written")
        return 0
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out_path} ({len(presets)} presets, generated_at {doc['generated_at']})")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", default=str(DEFAULT_CSV))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--batch", type=int, default=100, help="names per IN list (POST; 1000 measured fine)")
    ap.add_argument("--no-sesame", action="store_true", help="do not fall back to CDS Sesame")
    ap.add_argument("--dry-run", action="store_true", help="resolve and validate, write nothing")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args(argv)
    if a.batch < 1 or a.batch > 1000:
        print("USAGE ERROR - --batch must be between 1 and 1000", file=sys.stderr)
        return 4
    try:
        return build(Path(a.csv).resolve(), Path(a.out).resolve(), a.batch, not a.no_sesame, a.dry_run, a.verbose)
    except CatalogueError as e:
        print(f"ERROR - {e}", file=sys.stderr)
        return 1
    except NetworkError as e:
        print(f"NETWORK ERROR - {e}. Not a catalogue problem; retry in a minute.", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
