# Personal Site — Project Plan

## Goal

Build a clean, fast, responsive personal portfolio site for Chris Hughes (chughes87).

## Stack

- Vanilla HTML, CSS, JavaScript — no build step, no dependencies
- Deployed as static files (GitHub Pages or similar)

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
5. [ ] Deploy to GitHub Pages

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
