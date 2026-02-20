# Personal Site — Project Plan

## Goal

Build a clean, fast, responsive personal portfolio site for Chris Hughes (chughes87).

## Stack

- Vanilla HTML, CSS, JavaScript — no build step, no dependencies
- Hosted on AWS at **pointfree.space**

## Pages / Sections

Single-page layout with anchor nav:

| Section | Purpose |
|---------|---------|
| Hero | Name, title, short tagline, CTA buttons |
| About | Brief bio, social links (GitHub, LinkedIn) |
| Skills | Languages, Frontend, Backend, Tools |
| Projects | Cards with title, description, tags, links |
| Contact | Email CTA |
| Footer | Copyright, social links |

## Features

- Dark / light theme toggle (CSS custom properties + JS)
- Smooth scroll navigation
- Responsive layout (mobile-first)
- No external dependencies

## File Structure

```
personal-site/
├── index.html   # markup
├── style.css    # all styles (CSS custom properties for theming)
├── main.js      # theme toggle, scroll behaviour, dynamic year
└── PLAN.md      # this file
```

## Milestones

1. [x] PLAN.md — project plan
2. [ ] `index.html` — full page structure
3. [ ] `style.css` — responsive styles + dark mode
4. [ ] `main.js` — interactivity
5. [ ] Deploy to AWS (S3 + CloudFront + ACM + Route 53)

## AWS Hosting Architecture

Static site hosted on AWS, served at `pointfree.space` (apex) and `www.pointfree.space`.

```
Browser
  └─► Route 53 (pointfree.space A/AAAA alias)
        └─► CloudFront distribution
              ├─► ACM certificate (us-east-1, covers *.pointfree.space + pointfree.space)
              └─► S3 origin bucket (private, OAC)
```

### Resources to provision

| Resource | Detail |
|----------|--------|
| S3 bucket | `pointfree.space` — static website files, **not** public; access via CloudFront OAC only |
| CloudFront distribution | HTTPS only, redirect HTTP → HTTPS; default root object `index.html`; custom error page 404 → `index.html` (for future SPA support) |
| ACM certificate | Region **us-east-1** (required for CloudFront); covers `pointfree.space` + `www.pointfree.space`; DNS validation via Route 53 |
| Route 53 | Alias records for apex (`pointfree.space`) and `www` pointing to CloudFront |

### Deployment workflow

```
# Upload / sync files to S3
aws s3 sync . s3://pointfree.space \
  --exclude ".git/*" --exclude "PLAN.md" \
  --delete

# Invalidate CloudFront cache after each deploy
aws cloudfront create-invalidation \
  --distribution-id <DIST_ID> --paths "/*"
```

A `deploy.sh` script will wrap these two commands for convenience.

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
- ACM cert must be issued in `us-east-1` regardless of where other infra lives
- OAC (Origin Access Control) preferred over legacy OAI for S3 bucket policy
- `deploy.sh` should be excluded from S3 uploads
