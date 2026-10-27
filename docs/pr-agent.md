# Add the PR Agent

The reusable workflow handles checkout, base merging, conflict repair,
validation, push, and auto-merge. A target repository only needs two Actions
secrets and a short caller workflow.

## Secrets

- `OPENROUTER_API_KEY`: OpenRouter key for the model.
- `PR_AGENT_TOKEN`: fine-grained PAT or GitHub App token with repository
  Contents write and Pull requests write access.

Use a PAT or GitHub App token because pushes made with GitHub's built-in
`GITHUB_TOKEN` do not normally start other CI workflows. [GitHub explains this
event behavior](https://docs.github.com/en/actions/concepts/security/github_token).

## Workflow

Add `.github/workflows/pr-agent.yml` to the target repository:

```yaml
name: PR Agent

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write

jobs:
  agent:
    uses: zc6600/agentic-swe/.github/workflows/pr-agent.yml@main
    with:
      validation-command: npm test
    secrets:
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      PR_AGENT_TOKEN: ${{ secrets.PR_AGENT_TOKEN }}
```

Change `npm test` to the repository's test command. Auto-merge defaults to on;
disable it with `auto-merge: false`. Enable **Allow auto-merge** and configure
branch protection checks in GitHub. The workflow only runs for branches in the
same repository; fork PRs are skipped.

For production, pin the reusable workflow to a reviewed release tag or commit
SHA instead of `@main`.
