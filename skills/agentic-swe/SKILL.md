---
name: development-workflow
description: Git development workflows, pull requests, and CI feedback.
---

# Development Workflow

Choose the appropriate workflow based on your task and context.

## Direct Commit

Modify → Validate → Commit → Push

## Feature + PR

Branch → Modify → Validate → Commit → Push → PR → CI → Review → Merge

Use `gh` to manage PRs and check CI status.

On CI failure, prefer structured GitHub Checks API annotations over raw logs.

Retrieve feedback (example for a single failed check):

```bash
SHA=$(gh pr view --json headRefOid -q '.headRefOid')

CHECK_ID=$(gh api "repos/{owner}/{repo}/commits/$SHA/check-runs" \
  --jq '[.check_runs[] | select(.conclusion == "failure" and .output.annotations_count > 0)] | max_by(.completed_at).id')

gh api "repos/{owner}/{repo}/check-runs/$CHECK_ID/annotations" \
  --jq '[.[] | select(.annotation_level == "failure") | {file: .path, feedback: .message}]'
```

Follow `FAIL / Type / Reason / Fix` feedback. If annotations are unavailable, inspect failed CI logs.


