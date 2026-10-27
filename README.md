# agentic-swe

Reusable GitHub Actions for fast, agent-assisted software iteration.

## PR Agent

Use the [PR Agent action](docs/pr-agent.md) in a repository where contributors
open pull requests. It merges the base branch into same-repository PRs, asks an
agent to resolve simple conflicts and correctness issues, runs your validation
command, pushes the repair, and can enable GitHub auto-merge.

### CI

CI should explain why a change failed and how to fix it.

It should contain path, the Type of rule, the Reason and Fix suggestion.

For example:

```bash
FAIL: <path>
  Type: <the broken spec>
  Reason: <reason>
  Fix: <fix>
```
