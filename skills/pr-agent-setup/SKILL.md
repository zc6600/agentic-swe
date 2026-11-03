---
name: pr-agent-setup
description: Set up an output-only PR repair Agent. It resolves conflicts and emits an auditable patch plus JSON; publishing and merging are the repository owner's choice.
---

# Set up PR Agent

1. Add `OPENROUTER_API_KEY` as a repository Actions secret. No GitHub write token is needed.
2. Copy [`examples/pr-agent.yml`](examples/pr-agent.yml) into `.github/workflows/pr-agent.yml`.
3. Replace `npm test` with a meaningful repository validation command.
4. Choose `trigger-on: conflict-only` (default) or `always` (review every PR).
5. Inspect the uploaded `result.json` and `repair.patch` artifacts in Actions.

The reusable workflow only runs for same-repository PRs by default. Fork PRs need
an isolated, separately configured runner to safely use a model API key. Do not
solve this by running fork code under a privileged `pull_request_target` workflow.

The Agent **never commits, pushes, creates PRs, or merges**. If the repository
owner wants publication or GitHub auto-merge, they must separately configure a
trusted workflow that checks the patch, expected commit SHAs, and required CI.
`PASS` is not a security approval. See [`docs/pr-agent.md`](../../docs/pr-agent.md).
