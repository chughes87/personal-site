# Claude Notes

## Workflow

- Work in small, focused increments — each task gets its own PR
- Before starting any multi-step task, add it to `PLAN.md` as a checklist and keep it updated as you go
- Check `PLAN.md` at the start of each session to see if there is in-progress work to continue
- Feature-specific plans live in dedicated files — check the relevant one when working on that feature (see Feature Status below)
- If a task turns out to be large, break it into smaller sub-tasks in `PLAN.md`, complete only the first sub-task, and stop — do not attempt the remaining sub-tasks
- Mark items `[x]` in `PLAN.md` as they are completed so other agents can pick up where you left off
- PRs should be small and focused — one logical change per PR, targeting `main`

## Commands

```bash
npm test          # run Jest test suite (CI only — Node.js is not installed locally)
```

## CI / CD

Two GitHub Actions workflows:

| Workflow | Trigger | Jobs |
|---|---|---|
| `.github/workflows/ci.yml` | Pull requests to `main` | `validate` (HTML: index + chat), `test` (npm ci + jest) |
| `.github/workflows/deploy.yml` | Push to `main` | `validate` (all .html), `deploy` (S3 upload + CloudFront invalidation) |

> **Known gap:** `ci.yml` validates only `index.html` and `chat.html` — `voice.html` is not validated until the deploy job runs on merge.

## Testing

- Framework: Jest 29 with `jest-environment-jsdom` for browser files
- Tests live in `tests/` mirroring the source structure
- `tests/api/handler.test.js` — Node env, AWS SDK fully mocked
- `tests/src/main.test.js` — jsdom env, tests theme toggle logic
- `tests/src/chat.test.js` — jsdom env, tests gate/chat UI + XSS prevention
- `tests/src/voice.test.js` — jsdom env, tests gate/join/mute/leave/XSS + WebRTC mocks
- CI runs tests on every PR (must pass before merge) and on every push to main before deploy
- Include tests in the same PR as the code they cover — don't defer them to a separate PR

## Stack

- Vanilla HTML/CSS/JS — no build step, no frontend dependencies
- `src/` — browser JS (`main.js`, `chat.js`, `voice.js`) and CSS (`style.css`)
- `api/` — Lambda handler (Node.js CommonJS); `handler.js` + SAM `template.yaml`
- Files written directly to the Windows repo path; no worktrees
- **Never try to run the server locally** — Node.js is not installed on this machine; CI is the only way to run tests

## Deploy

- Push to `main` → GitHub Actions → validate HTML + run tests → sync to S3 (`pointfree.space`, us-west-1)
- `api/`, `tests/`, `node_modules/`, `package*.json`, `*.md` are excluded from S3 sync
- `CHAT_API_URL` secret is injected into `chat.html` and `voice.html` at deploy time (sed substitution)
- CloudFront cache is invalidated automatically when `CLOUDFRONT_DISTRIBUTION_ID` secret is set

## Feature Status

| Feature | Status | Plan file |
|---|---|---|
| Portfolio / index page | ✅ Complete | `PLAN.md` |
| Chat (polling, DynamoDB) | ✅ Complete | `PLAN.md` |
| Voice room (WebRTC, full mesh) | ✅ Complete | `VOICE_PLAN.md` |
| Screen sharing (WebRTC video) | ⬜ Not started | `STREAMING_PLAN.md` |

Next up: **Screen sharing** — see `STREAMING_PLAN.md` for the full spec and implementation checklist.
