---
name: pr-agent-setup
description: Set up the reusable PR Agent in a GitHub repository so it can resolve simple PR conflicts, validate repairs, and enable auto-merge. Use when a user asks how to install or configure PR Agent for another repository.
---

# Set up PR Agent

1. Add `OPENROUTER_API_KEY` and `PR_AGENT_TOKEN` as repository Actions secrets.
2. Copy [`examples/pr-agent.yml`](examples/pr-agent.yml) to `.github/workflows/pr-agent.yml`.
3. Replace `npm test` with the repository's validation command.
4. Enable GitHub auto-merge and required branch checks.

Use a fine-grained PAT or GitHub App token for `PR_AGENT_TOKEN`; the action uses
it to push repairs and update PRs, and its pushes trigger the repository's CI.
