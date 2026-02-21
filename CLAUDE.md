# Claude Notes

## Commands

```bash
npm test          # run Jest test suite
```

## Testing

- Framework: Jest 29 with `jest-environment-jsdom` for browser files
- Tests live in `tests/` mirroring the source structure
- `tests/api/handler.test.js` — Node env, AWS SDK fully mocked
- `tests/src/main.test.js` — jsdom env, tests theme toggle logic
- `tests/src/chat.test.js` — jsdom env, tests gate/chat UI + XSS prevention
- CI runs tests on every push to main (must pass before deploy)

## Stack

- Vanilla HTML/CSS/JS — no build step, no frontend dependencies
- `src/` — browser JS and CSS
- `api/` — Lambda handler (Node.js CommonJS)
- Files written directly to the Windows repo path; no worktrees

## Deploy

- Push to `main` → GitHub Actions → validate HTML + run tests → sync to S3 (`pointfree.space`, us-west-1)
- `api/`, `tests/`, `node_modules/`, `package*.json` are excluded from S3 sync
