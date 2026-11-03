"""Repair a checked-out PR and emit an auditable patch; never publish changes."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

DSH_VERSION = "0.2.1-rc.2"
MODEL_PATTERN = re.compile(r"[A-Za-z0-9._/-]+\Z")
TRIGGER_MODES = {"conflict-only", "always"}


class ActionError(RuntimeError):
    """An expected PR repair failure, reported as BLOCK or ERROR."""


def run(command: list[str], *, cwd: Path, check: bool = True,
        capture: bool = False, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command, cwd=cwd, check=False, text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None, env=env,
    )
    if check and result.returncode:
        if capture and result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        raise ActionError(f"Command failed ({result.returncode}): {command[0]}")
    return result


def git(cwd: Path, *args: str, check: bool = True, capture: bool = False):
    env = os.environ.copy()
    for key in ("OPENROUTER_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "PR_AGENT_TOKEN"):
        env.pop(key, None)
    return run(["git", *args], cwd=cwd, check=check, capture=capture, env=env)


def get_pull_request() -> dict:
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        raise ActionError("GITHUB_EVENT_PATH is missing; run from a PR workflow.")
    try:
        event = json.loads(Path(event_path).read_text(encoding="utf-8"))
        pr = event["pull_request"]
        details = {
            "pr_number": int(pr["number"]),
            "base_ref": str(pr["base"]["ref"]),
            "base_sha_at_event": str(pr["base"]["sha"]),
            "head_ref": str(pr["head"]["ref"]),
            "head_sha": str(pr["head"]["sha"]),
            "head_repo": str(pr["head"]["repo"]["full_name"]),
            "repository": str(os.environ["GITHUB_REPOSITORY"]),
        }
    except (KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        raise ActionError(f"Invalid pull request event payload: {exc}") from exc
    if details["pr_number"] < 1 or not details["base_ref"] or not details["head_ref"]:
        raise ActionError("Invalid pull request number or branch reference.")
    if not re.fullmatch(r"[0-9a-fA-F]{40}", details["head_sha"]):
        raise ActionError("Invalid PR head SHA.")
    return details


def make_dsh_config(model: str) -> str:
    if not MODEL_PATTERN.fullmatch(model):
        raise ActionError("Model must contain only letters, digits, '.', '_', '/', or '-'.")
    return f"""- id: llm-pi-ai
  config:
    providers:
      openrouter:
        api: openai-completions
        baseURL: https://openrouter.ai/api/v1
        apiKeyEnv: OPENROUTER_API_KEY
        models:
          - id: {model}

- id: agent-default-model
  config:
    provider: openrouter
    model: {model}

- id: permission
  config:
    presets:
      ci-workspace-write:
        sandbox: workspace-write
        approval: never
    defaultPreset: ci-workspace-write

- id: session-log-deepseek
  config:
    enabled: false
"""


def snapshot_directory(root: Path) -> dict[str, tuple[str, str]]:
    """Include untracked files and symlinks when guarding workflow definitions."""
    snapshot: dict[str, tuple[str, str]] = {}
    if not root.exists() and not root.is_symlink():
        return snapshot
    for path in (root, *sorted(root.rglob("*"))):
        name = str(path.relative_to(root.parent))
        if path.is_symlink():
            snapshot[name] = ("symlink", os.readlink(path))
        elif path.is_file():
            snapshot[name] = ("file", hashlib.sha256(path.read_bytes()).hexdigest())
        elif path.is_dir():
            snapshot[name] = ("directory", "")
    return snapshot


def output_directory() -> Path:
    root = Path(os.environ.get("GITHUB_WORKSPACE", ".")).resolve()
    default = Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir())) / "pr-agent-output"
    output = Path(os.environ.get("PR_AGENT_OUTPUT_DIR", str(default))).resolve()
    if output == root or root in output.parents:
        raise ActionError("PR_AGENT_OUTPUT_DIR must be outside the checked-out repository.")
    output.mkdir(parents=True, exist_ok=True)
    return output


def write_result(output: Path, data: dict, patch: bytes = b"") -> None:
    patch_file = output / "repair.patch"
    patch_file.write_bytes(patch)
    data["has_changes"] = bool(patch)
    data["patch_file"] = "repair.patch" if patch else None
    data["patch_sha256"] = hashlib.sha256(patch).hexdigest() if patch else None
    (output / "result.json").write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a", encoding="utf-8") as stream:
            stream.write(f"verdict={data['verdict']}\n")
            stream.write(f"has-changes={str(bool(patch)).lower()}\n")
            stream.write(f"result-path={output / 'result.json'}\n")
            stream.write(f"patch-path={patch_file}\n")


def main() -> int:
    output = output_directory()
    report: dict = {
        "schema_version": 1,
        "verdict": "ERROR",
        "reason": "not-started",
        "agent_invoked": False,
        "conflicts_found": None,
        "validation_passed": None,
        "base_sha": None,
    }
    patch = b""
    try:
        workspace = Path(os.environ.get("GITHUB_WORKSPACE", ".")).resolve()
        if not workspace.is_dir():
            raise ActionError(f"Workspace does not exist: {workspace}")
        report.update(get_pull_request())
        if git(workspace, "rev-parse", "HEAD", capture=True).stdout.strip() != report["head_sha"]:
            raise ActionError("Checkout HEAD differs from the PR event head SHA; refusing stale worktree.")
        if git(workspace, "status", "--porcelain", capture=True).stdout.strip():
            raise ActionError("Worktree must be clean before PR Agent runs.")
        trigger = os.environ.get("PR_AGENT_TRIGGER_ON", "conflict-only").strip().lower()
        if trigger not in TRIGGER_MODES:
            raise ActionError("trigger-on must be one of: conflict-only, always.")
        model = os.environ.get("PR_AGENT_MODEL", "deepseek/deepseek-v4.1-flash")
        task_instructions = os.environ.get("PR_AGENT_TASK_INSTRUCTIONS", "").strip()
        validation_command = os.environ.get("PR_AGENT_VALIDATION_COMMAND", "").strip()

        # Checkout with fetch-depth: 0 already fetches the base. Re-fetching over
        # HTTPS fails for private repositories when credentials are not persisted.
        # If a caller uses a shallow/single-branch checkout, fall back to fetch.
        remote_base = f"refs/remotes/origin/{report['base_ref']}"
        existing_base = git(workspace, "rev-parse", "--verify", remote_base,
                            check=False, capture=True)
        if existing_base.returncode:
            git(workspace, "fetch", "--no-tags", "origin",
                f"+refs/heads/{report['base_ref']}:{remote_base}")
        report["base_sha"] = git(workspace, "rev-parse", remote_base, capture=True).stdout.strip()
        attempt = git(workspace, "merge", "--no-commit", "--no-ff", f"origin/{report['base_ref']}", check=False, capture=True)
        if attempt.stdout:
            print(attempt.stdout, end="")
        if attempt.stderr:
            print(attempt.stderr, file=sys.stderr, end="")
        unmerged = git(workspace, "ls-files", "-u", capture=True).stdout.strip()
        if attempt.returncode and not unmerged:
            raise ActionError("Base merge failed without a resolvable file conflict.")
        report["conflicts_found"] = bool(unmerged)
        if not unmerged and trigger == "conflict-only":
            report.update(verdict="PASS", reason="no-conflicts")
            print("No conflicts: skipping model and validation; no patch is emitted.")
            return 0

        if git(workspace, "ls-files", "-u", "--", ".github", capture=True).stdout.strip():
            raise ActionError("Workflow files have merge conflicts; refusing automated repair.")
        if not os.environ.get("OPENROUTER_API_KEY"):
            raise ActionError("OPENROUTER_API_KEY is required when the agent is invoked.")
        baseline = snapshot_directory(workspace / ".github")
        report["agent_invoked"] = True
        instructions = (
            "Review this pull request against the fetched base branch.\n"
            "Resolve simple merge conflicts and fix small, unambiguous correctness issues.\n"
            "If a change is unsafe or ambiguous, return BLOCK without claiming success.\n"
            "Do not modify files under .github. Do not commit or push.\n"
            "Do not add caches, bytecode or generated test output.\n"
        )
        if task_instructions:
            instructions += f"Repository-specific instructions:\n{task_instructions}\n"
        instructions += "End your final response with one standalone line: PASS or BLOCK."
        agent_env = os.environ.copy()
        for key in ("GH_TOKEN", "GITHUB_TOKEN", "PR_AGENT_TOKEN"):
            agent_env.pop(key, None)
        agent_env["DSH_PERMISSION_MODE"] = "workspace-write"
        agent_env["DSH_TELEMETRY_DISABLED"] = "1"
        with tempfile.TemporaryDirectory(prefix="pr-agent-") as temp_dir:
            config_path = Path(temp_dir) / "dsh-openrouter.yml"
            config_path.write_text(make_dsh_config(model), encoding="utf-8")
            result = run([
                "npx", "-y", f"@deepseek-ai/dsh@{DSH_VERSION}",
                "--profile", "headless", "--patch", str(config_path), instructions,
            ], cwd=workspace, check=False, capture=True, env=agent_env)
        if result.stdout:
            print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        if result.returncode:
            raise ActionError(f"DeepSeek Harness exited with status {result.returncode}.")
        verdict = next((line.strip() for line in reversed(result.stdout.splitlines()) if line.strip()), "")
        if verdict != "PASS":
            report.update(verdict="BLOCK", reason="agent-blocked")
            raise ActionError(f"Agent verdict was not PASS (last non-empty line: {verdict!r}).")
        if snapshot_directory(workspace / ".github") != baseline:
            raise ActionError("Agent modified .github (including untracked files); refusing patch.")
        git(workspace, "add", "-A", "--", ".",
            ":(exclude,glob)**/__pycache__/**",
            ":(exclude,glob)**/*.pyc", ":(exclude,glob)**/*.pyo",
            ":(exclude,glob)**/.pytest_cache/**",
            ":(exclude,glob)**/.mypy_cache/**",
            ":(exclude,glob)**/.ruff_cache/**")
        if git(workspace, "ls-files", "-u", capture=True).stdout.strip():
            raise ActionError("Unresolved merge conflicts remain.")
        git(workspace, "diff", "--cached", "--check")
        if validation_command:
            print(f"Validating: {validation_command}")
            clean_env = os.environ.copy()
            for key in ("GH_TOKEN", "GITHUB_TOKEN", "PR_AGENT_TOKEN", "OPENROUTER_API_KEY"):
                clean_env.pop(key, None)
            run(["bash", "-euo", "pipefail", "-c", validation_command], cwd=workspace, env=clean_env)
            report["validation_passed"] = True
        else:
            report["validation_passed"] = None
        if snapshot_directory(workspace / ".github") != baseline:
            raise ActionError("Validation modified .github; refusing patch.")
        if git(workspace, "status", "--porcelain", "--untracked-files=all", capture=True).stdout.strip():
            # Validation may have changed tracked files after staging: refuse a stale or incomplete patch.
            unstaged = git(workspace, "diff", "--name-only", capture=True).stdout.strip()
            if unstaged:
                raise ActionError("Validation modified tracked files after staging; refusing incomplete patch.")
        patch = subprocess.run(["git", "diff", "--cached", "HEAD", "--binary"],
                               cwd=workspace, check=True, stdout=subprocess.PIPE).stdout
        report.update(verdict="PASS", reason="repaired" if report["conflicts_found"] else "reviewed")
        print("Agent finished; emitting patch and JSON. No GitHub write action was performed.")
        return 0
    except ActionError as exc:
        if report["verdict"] != "BLOCK":
            report.update(verdict="BLOCK", reason=str(exc))
        print(f"PR Agent blocked: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        report.update(verdict="ERROR", reason=f"Unexpected error: {exc}")
        print(f"PR Agent errored: {exc}", file=sys.stderr)
        return 1
    finally:
        write_result(output, report, patch if report["verdict"] == "PASS" else b"")


if __name__ == "__main__":
    raise SystemExit(main())
