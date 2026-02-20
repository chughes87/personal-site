# Personal Site — Project Plan

## Goal

Build a clean, fast, responsive personal portfolio site for Charles Hughes (chughes87).

## Stack

- Vanilla HTML, CSS, JavaScript — no build step, no dependencies
- Hosted on AWS at **pointfree.space**
- GitHub repo: https://github.com/chughes87/personal-site

## Current Status

### Next step
Set up the Route 53 A record (Alias → S3 website endpoint for us-west-1).

### AWS account
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

Single-page layout with anchor nav:

| Section | Purpose |
|---------|---------|
| Hero | Name, title, short tagline, CTA buttons |
| About | Brief bio, social links (GitHub, LinkedIn) |
| Skills | Languages, Frontend, Backend, Testing & Infra |
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
│       └── deploy.yml      # GitHub Actions CD — validates HTML, deploys to S3 on push to main
└── PLAN.md                 # this file
```

## Milestones

1. [x] PLAN.md — project plan
2. [x] `index.html` — full page structure, real content from resume
3. [x] `style.css` — responsive styles + dark mode
4. [x] `main.js` — theme toggle, dynamic year
5. [x] AWS infrastructure — S3 bucket (us-west-1), static website hosting, public read policy
6. [ ] IAM OIDC provider — needs to be verified/recreated (see note above)
7. [x] IAM role `github-actions-personal-site` created, S3 deploy permissions attached
8. [x] GitHub secret `AWS_ROLE_ARN` added to repo
9. [x] `.github/workflows/deploy.yml` — HTML validation + S3 deploy with cache headers
10. [ ] Route 53 — Alias A record for `pointfree.space` → `s3-website-us-west-1.amazonaws.com`

## AWS Hosting Architecture

Static site served directly from S3 static website hosting, pointed to by Route 53.

```
Browser
  └─► Route 53 (pointfree.space A alias)
        └─► S3 static website endpoint
              └─► s3://pointfree.space (public static website hosting)
```

> Note: No CloudFront for now — S3 static website hosting is sufficient. CloudFront can be
> added later for HTTPS. S3 static hosting is HTTP only.

### Resources to provision

| Resource | Detail |
|----------|--------|
| S3 bucket | `pointfree.space` — static website hosting enabled, public read policy ✅ done |
| Route 53 | Alias A record for apex (`pointfree.space`) → `s3-website-us-west-1.amazonaws.com` ⬅ todo |

## GitHub Actions CD (OIDC)

Deploys on every push to `main`. Uses OIDC (no long-lived AWS keys stored as secrets).
A `validate` job runs `html-validate` on `index.html` before deploying.
Cache-Control headers are set per asset type.

### AWS setup

- OIDC provider: `token.actions.githubusercontent.com` ⚠ verify exists
- IAM role: `github-actions-personal-site` ✅
- Trust policy: `repo:chughes87/personal-site:ref:refs/heads/main` ✅
- Permission policy: `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on `pointfree.space` ✅
- GitHub secret `AWS_ROLE_ARN` set ✅

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
- Claude can write files directly to the Windows repo path — no WSL workaround needed
