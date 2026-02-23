# personal-site

Personal portfolio site for Charles Hughes — live at **[pointfree.space](https://pointfree.space)**.

## Pages

| Page | Description |
|---|---|
| `index.html` | Portfolio (hero, about, skills, projects, contact) |
| `chat.html` | Real-time human-to-human text chat (polls every 3 s) |
| `voice.html` | WebRTC peer-to-peer voice room (up to 10 participants) |

## Stack

- Vanilla HTML/CSS/JS — no build step, no frontend dependencies
- AWS: S3 (static hosting) + CloudFront (HTTPS) + API Gateway + Lambda + DynamoDB
- GitHub Actions: HTML validation, Jest tests, S3 deploy on push to `main`

## Development

See `CLAUDE.md` for agent workflow instructions.
See `PLAN.md` for project architecture and infrastructure setup.
See `STREAMING_PLAN.md` for the next planned feature (screen sharing).

Tests run in CI only (`npm test` requires Node.js, which is not installed locally).
