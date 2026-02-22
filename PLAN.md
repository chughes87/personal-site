# Personal Site — Project Plan

## Goal

Build a clean, fast, responsive personal portfolio site for Charles Hughes (chughes87).

## Stack

- Vanilla HTML, CSS, JavaScript — no build step, no dependencies
- Hosted on AWS at **pointfree.space**
- GitHub repo: https://github.com/chughes87/personal-site

## Open TODOs

- [ ] Verify / recreate IAM OIDC provider (see AWS account section)
- [ ] Route 53 — Alias A record for `pointfree.space` → `s3-website-us-west-1.amazonaws.com`
- [ ] Add IAM policies to `github-actions-personal-site` role (see First-time setup below)
- [ ] Run `Deploy Chat API` workflow → copy printed URL → add `CHAT_API_URL` GitHub secret
- [ ] Add Experience section to portfolio (work history from resume not yet on the page)

## First-time setup — Chat API

### 1 — IAM: attach these policies to `github-actions-personal-site`

AWS Console → IAM → Roles → `github-actions-personal-site` → Attach policies:

| Policy | Purpose |
|--------|---------|
| `AWSCloudFormationFullAccess` | SAM uses CloudFormation |
| `AWSLambda_FullAccess` | Create/update Lambda function |
| `AmazonDynamoDBFullAccess` | Create DynamoDB tables |
| `AmazonAPIGatewayAdministrator` | Create HTTP API |
| `IAMFullAccess` | SAM creates the Lambda execution role |
| `AmazonS3FullAccess` | SAM `--resolve-s3` needs its own artifact bucket |

### 2 — Deploy the SAM stack

Trigger the **Deploy Chat API** workflow in GitHub Actions (Actions tab → Deploy Chat API →
Run workflow). On success the "Print API URL" step shows a notice with the full URL, e.g.:
`https://abc123.execute-api.us-west-1.amazonaws.com`

### 3 — Add the GitHub secret

GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
- Name: `CHAT_API_URL`
- Value: the URL from step 2

### 4 — Redeploy the site

Push any change to `main` (or re-run `Deploy to S3`). The deploy workflow substitutes
`CHAT_API_URL` into `chat.html` before uploading to S3. The chat page is now live.

## AWS account

- Account ID: `697845623602`
- IAM user: `windows-dev`
- S3 bucket: `pointfree.space` (us-west-1), static website hosting enabled, public read policy set
- IAM role ARN: `arn:aws:iam::697845623602:role/github-actions-personal-site`
- GitHub secret `AWS_ROLE_ARN` added to repo

> **Note:** OIDC provider was missing in AWS despite being marked done — recreate if the deploy job fails with "No OpenIDConnect provider found":
> ```
> aws iam create-open-id-connect-provider \
>   --url https://token.actions.githubusercontent.com \
>   --client-id-list sts.amazonaws.com \
>   --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
> ```

## Pages / Sections

| Page | Sections |
|------|---------|
| `index.html` | Hero, About, Skills, Projects, Contact, Footer |
| `chat.html` | Real-time human-to-human chat (polls every 3 s) |
| `voice.html` | WebRTC voice chat room (max 10 participants) |

## Features

- Dark / light theme toggle (CSS custom properties + JS)
- Smooth scroll navigation
- Responsive layout (mobile-first)
- No external dependencies (frontend)
- Chat: per-IP rate limiting (15 msg/hr), 7-day message TTL, 500-char limit
- Voice: WebRTC peer-to-peer audio, signalling via Lambda/DynamoDB, max 10 participants

## File Structure

```
personal-site/
├── index.html              # portfolio page
├── chat.html               # chat page — update window.CHAT_API_BASE after SAM deploy
├── voice.html              # voice room page — update window.VOICE_API_BASE after SAM deploy
├── style.css               # all styles (design tokens, dark mode, chat UI, voice UI)
├── src/
│   ├── main.js             # theme toggle, dynamic year (used on all pages)
│   ├── chat.js             # chat polling, send, username management
│   └── voice.js            # WebRTC voice — join/leave/signal/heartbeat/mute
├── api/
│   ├── handler.js          # Lambda — chat + voice endpoints, rate limiting
│   └── template.yaml       # SAM — Lambda + HTTP API + DynamoDB tables
├── tests/
│   ├── api/
│   │   └── handler.test.js # Node env — all Lambda handler routes
│   └── src/
│       ├── main.test.js    # jsdom — theme toggle logic
│       ├── chat.test.js    # jsdom — gate/chat UI + XSS prevention
│       └── voice.test.js   # jsdom — gate/join/mute/leave/XSS + WebRTC mocks
├── .github/
│   └── workflows/
│       └── deploy.yml      # validates HTML, deploys static files to S3
└── PLAN.md                 # this file
```

## Milestones

1. [x] `PLAN.md` — project plan
2. [x] `index.html` — full page structure, real content from resume
3. [x] `style.css` — responsive styles + dark mode + chat UI
4. [x] `main.js` — theme toggle, dynamic year
5. [x] `chat.html` + `chat.js` — dedicated chat page
6. [x] `api/handler.js` + `api/template.yaml` — chat Lambda + SAM template
7. [x] AWS infrastructure — S3 bucket (us-west-1), static website hosting, public read policy
8. [ ] IAM OIDC provider — verify exists (see note above)
9. [x] IAM role `github-actions-personal-site` — S3 deploy permissions attached
10. [x] GitHub secret `AWS_ROLE_ARN` added to repo
11. [x] `.github/workflows/deploy.yml` — HTML validation + S3 deploy with cache headers
12. [ ] Route 53 — Alias A record `pointfree.space` → `s3-website-us-west-1.amazonaws.com`
13. [x] `deploy-api.yml` — GitHub Actions workflow for SAM deploy (auto-triggered on `api/**` or manual)
14. [x] `deploy.yml` — injects `CHAT_API_URL` secret into `chat.html` before S3 upload
15. [ ] Run first SAM deploy + add `CHAT_API_URL` secret (see First-time setup above)

## AWS Hosting Architecture

```
Browser
  └─► Route 53 (pointfree.space A alias)
        └─► S3 static website endpoint
              └─► s3://pointfree.space

Browser (chat page)
  └─► API Gateway (HTTP API)
        └─► Lambda (handler.js)
              ├─► DynamoDB: chat-messages   (room + sk, TTL 7 days)
              └─► DynamoDB: chat-rate-limits (ip#hour, TTL 2 hours)
```

> No CloudFront for now — add later for HTTPS. S3 static hosting is HTTP only.

## GitHub Actions CD

Deploys on every push to `main`. Uses OIDC (no long-lived AWS keys).

- `validate` job: runs `html-validate` on all `.html` files
- `deploy` job: uploads HTML (`no-cache`), CSS/JS (5 min), images (1 day), then deletes stale files
- `api/` directory is excluded from S3 sync

### AWS setup status

| Item | Status |
|---|---|
| OIDC provider `token.actions.githubusercontent.com` | ⚠ verify |
| IAM role `github-actions-personal-site` | ✅ |
| Trust policy `repo:chughes87/personal-site:ref:refs/heads/main` | ✅ |
| S3 permissions (`PutObject`, `DeleteObject`, `ListBucket`) | ✅ |
| GitHub secret `AWS_ROLE_ARN` | ✅ |

## Design Tokens

```css
--color-bg        light: #ffffff  dark: #0d1117
--color-surface   light: #f6f8fa  dark: #161b22
--color-text      light: #1f2328  dark: #e6edf3
--color-accent    #2f81f7
--color-border    light: #d0d7de  dark: #30363d
```

## Notes

- Keep the site snappy — no JS frameworks, no heavy images
- Prioritise accessibility: semantic HTML, aria labels, sufficient contrast
- All external links open in a new tab with `rel="noopener"`
- S3 bucket name must exactly match domain name for Route 53 alias to work
- CloudFront needed for HTTPS — S3 static hosting is HTTP only
- Claude can write files directly to the Windows repo path — no WSL workaround needed
