# agentic-swe

Reusable GitHub Actions and a Skills Hub for fast, agent-assisted software iteration.

- **Live site**: [agentic-swe.pages.dev](https://agentic-swe.pages.dev)
- **Skills Hub & Vault**: [agentic-swe.pages.dev/skills/](https://agentic-swe.pages.dev/skills/)

## Features

### 1. Skills Hub & Personal Vault (`/skills/`)

- **Official `@agentic-swe` Skills**: Built-in specs (`@agentic-swe/pr-agent-setup`, `@agentic-swe/development-workflow`, `@agentic-swe/documentation-guard`) with bundled workflow examples.
- **Interactive Configuration**: Supports `{{VAR_NAME:default}}` placeholders with live preview and one-click export for Claude Code (`.claude/skills`), Antigravity (`.agents/skills`), Cursor (`.cursor/skills`), or repository `skills/`.
- **Personal Cloud Vault**: Sign in with Google to store `@handle/slug` skills privately or share them publicly, import/export `.md` files, or let coding agents sync skills via short-lived tokens (`/skills/api/`).

### 2. PR Agent (`/pr-agent/`)

Use the [PR Agent action](docs/pr-agent.md) to check same-repository pull requests, repair straightforward conflicts with DeepSeek Harness (`trigger-on: conflict-only` by default, or `always`), and emit **`result.json` + `repair.patch`**. The Agent never pushes or merges; repository owners define any subsequent publishing policy.

### 3. Documentation Guard (`/documentation-guard/`)

Composite action (`zc6600/agentic-swe@main`) enforcing concise documentation limits with actionable GitHub annotations. Defaults: `2000` words for `README.md`, `4000` for other `.md`/`.mdx` files; override with the `readme-limit` and `doc-limit` inputs.

## Website & Deployment

The site is a Next.js static export in [`web/`](web/) backed by Firebase Auth, Firestore, and Cloud Functions ([`infra/firebase/README.md`](infra/firebase/README.md)).

```bash
npm ci --prefix web
npm run dev --prefix web
```

## CI Feedback Format

CI checks must explain what failed, why, and how to fix it:

```text
FAIL: <path>
  Type: <broken specification>
  Reason: <why this matters>
  Fix: <actionable remediation>
```
