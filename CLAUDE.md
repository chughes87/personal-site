# Claude Notes

## Workflow

- Work in small, focused increments — each task gets its own PR
- Before starting any multi-step task, add it to `PLAN.md` as a checklist and keep it updated as you go
- Check `PLAN.md` at the start of each session to see if there is in-progress work to continue
- If a task turns out to be large, break it into smaller sub-tasks in `PLAN.md` before proceeding
- Mark items `[x]` in `PLAN.md` as they are completed so other agents can pick up where you left off
- PRs should be small and focused — one logical change per PR, targeting `main`

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
