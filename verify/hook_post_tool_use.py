#!/usr/bin/env python
"""PostToolUse hook: run the gate after every Write / Edit that touches app/.

Registered in .claude/settings.json with the venv interpreter pinned by absolute path.
Reads the Claude Code hook payload (JSON) from stdin.

Exit codes
  0   gate PASSED (reported to the model via additionalContext), or nothing to verify
      (edit outside app/, or app/index.html not written yet), or HARNESS ERROR - the gate
      could not run for an environment reason; that is reported via additionalContext and
      systemMessage so the model knows verification did NOT happen, without blaming the code.
  2   gate FAILED - the gate output is written to stderr, which Claude Code feeds back to
      the model so it corrects the deliverable before declaring done.

Prove it by hand (see CLAUDE.md "Hook proof"):
  echo {"tool_name":"Write","tool_input":{"file_path":"E:/CODE/samaa-explorer/app/index.html"}} | <venv python> verify/hook_post_tool_use.py
"""
import json
import pathlib
import subprocess
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = pathlib.Path(__file__).resolve().parent          # <project>/verify
ROOT = HERE.parent                                       # <project>
GATE = HERE / "smoke_test.py"
APP_DIR = ROOT / "app"
TARGET = APP_DIR / "index.html"
LOG = HERE / "artifacts" / "last_gate.log"
GATE_TIMEOUT_S = 240
TAIL_CHARS = 6000


def context(text: str, system_message: str | None = None) -> None:
    """Non-blocking message: additionalContext reaches the model, systemMessage the user."""
    out = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": text}}
    if system_message:
        out["systemMessage"] = system_message
    print(json.dumps(out))


def harness(msg: str) -> int:
    text = f"HARNESS ERROR - the verification gate could not run; this is NOT a deliverable problem. {msg}"
    context(text, system_message=text[:300])
    return 0


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        return harness(f"hook received non-JSON stdin ({e}).")
    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input") or {}
    fp = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not fp:
        return 0
    path = pathlib.Path(fp)
    if not path.is_absolute():
        path = pathlib.Path(payload.get("cwd") or ROOT) / path
    try:
        path.resolve().relative_to(APP_DIR.resolve())
    except ValueError:
        return 0  # edit outside the deliverable: nothing to verify
    if not TARGET.is_file():
        context(f"Gate skipped: {TARGET} does not exist yet. The gate runs after every edit under app/ once index.html exists.")
        return 0
    if not GATE.is_file():
        return harness(f"{GATE} is missing.")

    cmd = [sys.executable, str(GATE), str(TARGET), "--label", "hook"]
    t0 = time.time()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=GATE_TIMEOUT_S, cwd=str(ROOT))
    except subprocess.TimeoutExpired:
        return harness(f"gate exceeded {GATE_TIMEOUT_S}s and was killed; check that the CDS services are reachable.")
    except OSError as e:
        return harness(f"could not start the gate with {sys.executable}: {e}")
    dt = time.time() - t0
    out = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        LOG.write_text(f"$ {' '.join(cmd)}\nexit {proc.returncode} in {dt:.0f}s\n\n{out}", encoding="utf-8")
    except OSError:
        pass

    if proc.returncode == 0:
        last = next((ln for ln in reversed(out.splitlines()) if ln.startswith("GATE PASS")), "GATE PASS")
        context(f"Verification gate after {tool} on {path.name}: {last} ({dt:.0f}s). Full log: {LOG}")
        return 0
    if proc.returncode == 1:
        tail = out if len(out) <= TAIL_CHARS else "...\n" + out[-TAIL_CHARS:]
        sys.stderr.write(
            f"GATE FAILED after {tool} on {path} ({dt:.0f}s). Fix the deliverable under app/ - never the harness.\n"
            f"Gate output:\n{tail}\n")
        return 2
    tail = out if len(out) <= 1500 else "...\n" + out[-1500:]
    return harness(f"gate exit code {proc.returncode} (3 = environment, 4 = usage). Output:\n{tail}")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # the hook itself must never look like a code failure
        context(f"HARNESS ERROR - the verification hook crashed ({e!r}); not a deliverable problem.",
                system_message="HARNESS ERROR - verification hook crashed")
        sys.exit(0)
