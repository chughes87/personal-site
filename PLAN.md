# Personal Site — Project Plan

## Goal

Build a clean, fast, responsive personal portfolio site for Charles Hughes (chughes87).

## Stack

- Vanilla HTML, CSS, JavaScript — no build step, no dependencies
- Hosted on AWS at **pointfree.space**
- GitHub repo: https://github.com/chughes87/personal-site

## Current Status

Last blocker: WSL filesystem write permissions make it impossible to create files via Claude.
Use VS Code directly to create `.github/workflows/deploy.yml`.

### Next step
Create `.github/workflows/deploy.yml` in VS Code with the content from the "GitHub Actions CD" section below, commit, and push to main. Then set up the Route 53 A record.

### AWS account
- Account ID: `697845623602`
- IAM user: `windows-dev`
- S3 bucket: `pointfree.space` (us-west-1), static website hosting enabled, public read policy set
- IAM role ARN: `arn:aws:iam::697845623602:role/github-actions-personal-site`
- GitHub secret `AWS_ROLE_ARN` added to repo

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
├── index.html              # markup
├── style.css               # all styles (CSS custom properties for theming)
├── main.js                 # theme toggle, scroll behaviour, dynamic year
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions CD — deploys to S3 on push to main
└── PLAN.md                 # this file
```

## Milestones

1. [x] PLAN.md — project plan
2. [x] `index.html` — full page structure
3. [ ] `style.css` — responsive styles + dark mode
4. [ ] `main.js` — interactivity
5. [x] AWS infrastructure — S3 bucket (us-west-1) created, static website hosting enabled, public read policy set
6. [x] IAM OIDC provider created for `token.actions.githubusercontent.com`
7. [x] IAM role `github-actions-personal-site` created, S3 deploy permissions attached
8. [x] GitHub secret `AWS_ROLE_ARN` added to repo
9. [ ] `.github/workflows/deploy.yml` — create in VS Code and push to main
10. [ ] Route 53 — A record alias pointing to S3 website endpoint

## AWS Hosting Architecture

Static site served directly from S3 static website hosting, pointed to by Route 53.

```
Browser
  └─► Route 53 (pointfree.space A alias)
        └─► S3 static website endpoint
              └─► s3://pointfree.space (public static website hosting)
```

> Note: No CloudFront for now — S3 static website hosting is sufficient. CloudFront can be
> added later if HTTPS or a CDN is needed.

### Resources to provision

| Resource | Detail |
|----------|--------|
| S3 bucket | `pointfree.space` — static website hosting enabled, public read policy ✅ done |
| Route 53 | A record alias for apex (`pointfree.space`) pointing to S3 website endpoint |

## GitHub Actions CD (OIDC)

Deploys on every push to `main`. Uses OIDC (no long-lived AWS keys stored as secrets).

### AWS setup — DONE

- OIDC provider: `token.actions.githubusercontent.com` ✅
- IAM role: `github-actions-personal-site` ✅
- Trust policy: `repo:chughes87/personal-site:ref:refs/heads/main` ✅
- Permission policy: `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on `pointfree.space` ✅
- GitHub secret `AWS_ROLE_ARN` set ✅

### Workflow — `.github/workflows/deploy.yml`

```yaml
name: Deploy to S3

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-west-1

      - name: Sync to S3
        run: |
          aws s3 sync . s3://pointfree.space \
            --exclude ".git/*" \
            --exclude ".github/*" \
            --exclude "PLAN.md" \
            --delete
```

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
- CloudFront can be added later for HTTPS — S3 static hosting is HTTP only
- Claude cannot write files to WSL filesystem via Windows paths — use VS Code or WSL terminal directly
