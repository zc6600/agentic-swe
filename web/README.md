# agentic-swe website

Next.js App Router static site (`output: "export"`) for the Skills Hub, PR Agent, and Documentation Guard.

## Local development

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Set `NEXT_PUBLIC_FIREBASE_CONFIG` in `.env.local` to the Firebase Web App JSON config.

## Build & Deploy (Cloudflare Pages)

Run the Cloudflare Pages deployment from inside `web/` so Wrangler deploys `web/out` without parsing root Firebase `functions/`:

```bash
npm run lint
npm run typecheck
npm run build
npx wrangler pages deploy out --project-name agentic-swe --branch main
```

For Firebase Auth, Firestore rules, and Cloud Functions (`uploadSkill`, `getRawSkill`), see [`../infra/firebase/README.md`](../infra/firebase/README.md).
