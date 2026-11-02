# Skills Hub Firebase Backend

The live Firebase project is `agentic-swe-skills` (region: `asia-southeast1`).

- **Authentication**: Google sign-in enabled for `agentic-swe.pages.dev` and `localhost`.
- **Firestore (`infra/firebase/firestore.rules`)**: Stores user skills at `/users/{userId}/skills/{skillId}`. Private skills are restricted to the owner; skills with `visibility: "public"` are readable via shared links and collection-group queries.
- **Cloud Functions (`functions/index.js`)**:
  - `createSkillUploadToken` / `listSkillUploadTokens` / `revokeSkillUploadToken`: Manage time-limited `ask_...` Bearer tokens.
  - `uploadSkill` (`POST`): Creates or updates a skill by `slug` in the token owner's vault.
  - `getRawSkill` (`GET`): Returns raw `SKILL.md` by `?slug=<slug>&owner=<handle>` and interpolates `{{VAR:default}}` placeholders from query parameters.

## Deploy Firestore Rules & Auth

```bash
npx firebase-tools@latest deploy --only auth,firestore:rules,firestore:indexes --project agentic-swe-skills
```

## Deploy Cloud Functions

```bash
cd functions && npm ci && cd ..
npx firebase-tools@latest deploy --only functions --project agentic-swe-skills
```

