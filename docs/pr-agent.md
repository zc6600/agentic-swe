# PR Agent: patch producer

The reusable PR Agent **does not push, create PRs, or merge**. It checks a pull request's
head against the target base, uses DeepSeek Harness to repair straightforward conflicts
(or review every PR with `trigger-on: always`), and emits a JSON report plus a patch.
The repository owner chooses any later publication or auto-merge workflow.

## Install in a repository

1. Add `OPENROUTER_API_KEY` to **Settings → Secrets and variables → Actions**.
2. Copy [`skills/pr-agent-setup/examples/pr-agent.yml`](../skills/pr-agent-setup/examples/pr-agent.yml)
   to `.github/workflows/pr-agent.yml` in the consuming repository.
3. Replace `npm test` with a meaningful validation command. Never use `true` to bypass checks.
4. Open a same-repository PR. The reusable workflow uploads `result.json` and
   `repair.patch` as a GitHub Actions artifact, even when the agent blocks.

```yaml
name: PR Agent
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: read
jobs:
  agent:
    uses: zc6600/agentic-swe/.github/workflows/pr-agent.yml@main
    with:
      validation-command: npm test
      trigger-on: conflict-only
    secrets:
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

The default `conflict-only` mode skips the model **and validation** on clean merges.
`always` runs the agent and the validation command even when no conflicts exist.
The default workflow skips fork PRs because GitHub withholds repository secrets
from ordinary fork `pull_request` events. This is a safe default, **not** a limit
of the core controller's JSON/patch format.

## Outputs

Artifacts in `pr-agent-output/`:

- `result.json`: machine-readable verdict, input refs/SHAs, invocation details,
  validation result, and the SHA-256 of any patch.
- `repair.patch`: a Git binary-capable diff relative to the **original PR head**;
  empty when there is no repair or the agent blocks.

Example:

```json
{
  "schema_version": 1,
  "pr_number": 12,
  "repository": "owner/project",
  "head_repo": "contributor/project",
  "head_ref": "feature",
  "head_sha": "<40-character SHA of PR head>",
  "base_ref": "main",
  "base_sha_at_event": "<40-character event base SHA>",
  "base_sha": "<40-character fetched base SHA>",
  "verdict": "PASS",
  "reason": "repaired",
  "agent_invoked": true,
  "conflicts_found": true,
  "validation_passed": true,
  "has_changes": true,
  "patch_file": "repair.patch",
  "patch_sha256": "<SHA-256 hex digest>"
}
```

`verdict` is `PASS`, `BLOCK`, or `ERROR`. In `conflict-only` mode without
conflicts, `verdict` is `PASS`, `reason` is `no-conflicts`, `agent_invoked` is
`false`, `validation_passed` is `null`, and no patch is emitted. A non-PASS result
fails the Action but still writes the report and an empty patch.

**PASS is not a security or merge approval.** A downstream publisher must
independently check CI, inspect the actual patch, match the current PR head/base
SHAs to the report, verify the patch hash, enforce branch protections and
require appropriate authorization. A changed base requires a fresh run.

## What users can do next

Publication policy lives **outside** PR Agent. A trusted workflow may:

- Keep the artifact for human review (default; no GitHub write token needed).
- Apply the patch to the exact original head, push to the contributor's branch
  **if** the publisher has permission, then request auto-merge.
- Apply it to a new branch in the owner's repository, open a replacement PR,
  and request auto-merge only after required checks.

Those are **consumer choices**, not operations implemented by this action.
GitHub's **Allow auto-merge** setting and branch protections are likewise
managed by the repository owner. An agent-produced patch must never directly
be treated as approval to publish or merge.

## Security and fork PRs

- The included reusable workflow uses `contents: read`, `pull-requests: read`,
  checkout with `persist-credentials: false`, and never gives the agent a GitHub
  write token. It deliberately skips fork PRs.
- The controller accepts PR metadata from either repository when the caller
  has already checked out the exact `head_sha`; it does **not** authorize a
  fork to run with Secrets or perform a privileged checkout.
- Never simply switch a fork workflow to `pull_request_target` while checking
  out and executing untrusted code. Even with GitHub credentials removed,
  executing untrusted code alongside the OpenRouter API key can expose it.
  Use an isolated worker / approved sandbox with tightly scoped credentials
  for untrusted fork code, then pass artifacts to a separate trusted publisher.
- Do not execute arbitrary contributor validation scripts in a privileged
  publisher job. The publisher should not execute the patch or any PR code.
- The controller rejects modifications to `.github` by the model (including
  untracked files), refuses unresolved conflicts, and excludes GitHub tokens
  from the model and validation subprocess environments.
- Pin workflow/action references to a reviewed release tag or commit SHA in
  production instead of `@main`.

## Local tests

```bash
python3 -m unittest discover -s tests -v
```

These tests use temporary local Git remotes, not GitHub write permissions, and
simulate the model invocation. They cover patch generation, blocked conflicts,
clean-merge skip behavior, stale SHA rejection, and `.github` protection.
