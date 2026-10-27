"""Run the PR repair workflow inside a checked-out GitHub workspace."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

DSH_VERSION = "0.2.1-rc.2"
MODEL_PATTERN = re.compile(r"[A-Za-z0-9._/-]+\Z")
MERGE_METHODS = {"squash", "merge", "rebase"}


class ActionError(RuntimeError):
    """An expected action failure with a user-facing message."""


def run(
    command: list[str],
    *,
    cwd: Path,
    check: bool = True,
    capture: bool = False,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        env=env,
    )
    if check and result.returncode:
        if capture and result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        raise ActionError(f"Command failed ({result.returncode}): {' '.join(command)}")
    return result


def git(cwd: Path, *args: str, check: bool = True, capture: bool = False):
    env = os.environ.copy()
    env.pop("OPENROUTER_API_KEY", None)
    return run(["git", *args], cwd=cwd, check=check, capture=capture, env=env)


def get_pull_request(workspace: Path) -> tuple[int, str, str]:
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        raise ActionError("GITHUB_EVENT_PATH is missing; invoke this action from a pull_request workflow.")

    try:
        event = json.loads(Path(event_path).read_text(encoding="utf-8"))
        pull_request = event["pull_request"]
        number = int(pull_request["number"])
        head = pull_request["head"]
        base_ref = str(pull_request["base"]["ref"])
        head_ref = str(head["ref"])
        head_repo = str(head["repo"]["full_name"])
    except (KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        raise ActionError(f"Could not read pull request details from the event payload: {exc}") from exc

    repository = os.environ.get("GITHUB_REPOSITORY", "")
    if head_repo != repository:
        raise ActionError("PR Agent only accepts same-repository branches so its secrets stay protected.")
    if not base_ref or not head_ref or number < 1:
        raise ActionError("The pull request event is missing its number or branch names.")

    return number, head_ref, base_ref


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


def git_hunks(cwd: Path, pathspec: str) -> bytes:
    result = subprocess.run(
        ["git", "diff", "HEAD", "--binary", "--", pathspec],
        cwd=cwd,
        check=True,
        stdout=subprocess.PIPE,
    )
    return result.stdout


def main() -> int:
    workspace = Path(os.environ.get("GITHUB_WORKSPACE", ".")).resolve()
    if not workspace.is_dir():
        raise ActionError(f"Workspace does not exist: {workspace}")

    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    github_token = os.environ.get("GH_TOKEN", "")
    if not api_key:
        raise ActionError("openrouter-api-key is required.")
    if not github_token:
        raise ActionError("github-token is required.")

    pr_number, head_ref, base_ref = get_pull_request(workspace)
    model = os.environ.get("PR_AGENT_MODEL", "deepseek/deepseek-v4.1-flash")
    merge_method = os.environ.get("PR_AGENT_MERGE_METHOD", "squash").lower()
    auto_merge = os.environ.get("PR_AGENT_AUTO_MERGE", "true").lower()
    task_instructions = os.environ.get("PR_AGENT_TASK_INSTRUCTIONS", "").strip()
    validation_command = os.environ.get("PR_AGENT_VALIDATION_COMMAND", "true").strip()

    if merge_method not in MERGE_METHODS:
        raise ActionError("merge-method must be one of: squash, merge, rebase.")
    if auto_merge not in {"true", "false"}:
        raise ActionError("auto-merge must be 'true' or 'false'.")

    print(f"Fetching base branch {base_ref} for PR #{pr_number}.")
    git(
        workspace,
        "fetch",
        "--no-tags",
        "origin",
        f"+refs/heads/{base_ref}:refs/remotes/origin/{base_ref}",
    )
    merge = git(
        workspace,
        "merge",
        "--no-commit",
        "--no-ff",
        f"origin/{base_ref}",
        check=False,
        capture=True,
    )
    if merge.stdout:
        print(merge.stdout, end="")
    if merge.stderr:
        print(merge.stderr, file=sys.stderr, end="")
    if merge.returncode:
        conflicts = git(workspace, "ls-files", "-u", capture=True).stdout.strip()
        if not conflicts:
            raise ActionError("Merging the base branch failed without a resolvable file conflict.")
        print("Base merge has conflicts; asking the agent to resolve them.")

    github_diff_before = git_hunks(workspace, ".github")
    instructions = (
        "Review this pull request against the fetched base branch.\n"
        "Resolve simple merge conflicts and fix small, unambiguous correctness issues.\n"
        "If the correct change is unsafe or ambiguous, leave it unresolved and return BLOCK.\n"
        "Do not modify files under .github. Do not commit or push.\n"
        "Do not add generated caches, bytecode, or test output to the PR.\n"
    )
    if task_instructions:
        instructions += f"Repository-specific instructions:\n{task_instructions}\n"
    instructions += "After finishing, end your final response with a standalone PASS or BLOCK line."

    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "workspace-write"
    env["DSH_TELEMETRY_DISABLED"] = "1"
    dsh_env = env.copy()
    dsh_env.pop("GH_TOKEN", None)
    auth_env = env.copy()
    auth_env.pop("OPENROUTER_API_KEY", None)
    with tempfile.TemporaryDirectory(prefix="pr-agent-") as temp_dir:
        config_path = Path(temp_dir) / "dsh-openrouter.yml"
        config_path.write_text(make_dsh_config(model), encoding="utf-8")
        print(f"Running DeepSeek Harness with {model}.")
        result = run(
            [
                "npx",
                "-y",
                f"@deepseek-ai/dsh@{DSH_VERSION}",
                "--profile",
                "headless",
                "--patch",
                str(config_path),
                instructions,
            ],
            cwd=workspace,
            check=False,
            capture=True,
            env=dsh_env,
        )
        if result.stdout:
            print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        if result.returncode:
            raise ActionError(f"DeepSeek Harness exited with status {result.returncode}.")

    verdict = next((line.strip() for line in reversed(result.stdout.splitlines()) if line.strip()), "")
    if verdict != "PASS":
        raise ActionError(f"Agent verdict was not PASS (last non-empty line: {verdict!r}).")

    if git_hunks(workspace, ".github") != github_diff_before:
        raise ActionError("The agent changed .github files; refusing to commit or push those changes.")
    if git(workspace, "ls-files", "-u", capture=True).stdout.strip():
        raise ActionError("Unresolved merge conflicts remain after the agent run.")

    git(workspace, "diff", "--check")
    git(workspace, "diff", "--cached", "--check")
    if validation_command:
        print(f"Running repository validation command: {validation_command}")
        validation_env = env.copy()
        validation_env.pop("GH_TOKEN", None)
        validation_env.pop("OPENROUTER_API_KEY", None)
        run(
            ["bash", "-euo", "pipefail", "-c", validation_command],
            cwd=workspace,
            env=validation_env,
        )

    git(
        workspace,
        "add",
        "-A",
        "--",
        ".",
        ":(exclude,glob)**/__pycache__/**",
        ":(exclude,glob)**/*.pyc",
        ":(exclude,glob)**/*.pyo",
        ":(exclude,glob)**/*.pyd",
        ":(exclude,glob)**/.pytest_cache/**",
        ":(exclude,glob)**/.mypy_cache/**",
        ":(exclude,glob)**/.ruff_cache/**",
    )
    merge_in_progress = (workspace / ".git" / "MERGE_HEAD").is_file()
    staged_changes = git(workspace, "diff", "--cached", "--quiet", check=False).returncode != 0
    if merge_in_progress or staged_changes:
        git(workspace, "config", "user.name", "github-actions[bot]")
        git(workspace, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
        git(workspace, "commit", "-m", "[pr-agent] Resolve base conflicts and repair PR")
        run(["gh", "auth", "setup-git"], cwd=workspace, env=auth_env)
        git(workspace, "push", "origin", f"HEAD:{head_ref}")
    else:
        print("No repair commit is needed.")

    if auto_merge == "true":
        run(
            ["gh", "pr", "merge", str(pr_number), "--auto", f"--{merge_method}"],
            cwd=workspace,
            env=auth_env,
        )
        print(f"Auto-merge enabled for PR #{pr_number} ({merge_method}).")
    else:
        print("Auto-merge is disabled; validated changes are pushed to the PR branch.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ActionError as exc:
        print(f"PR Agent failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
