---
version: 1
slug: "web-src-app-jsx"
primary_target: "web/src/App.jsx"
related_targets: ["web/src/styles.css"]
---

# Dogear library

Mode: operate. Chosen by the user after comparing interactive mocks. Scope: S17/S18/S20 in odd/tasks/dogear-mvp.md. React/Vite app uses existing Auth0 identity and owner-scoped book listing. S21 extends the library with inline manual book entry and transient cover-photo OCR suggestions followed by explicit confirmation. Reading states, page-photo uploads, existing-book editing and quote review remain out of scope.

## Direction contract

THESIS: An independent book-fair catalog makes a personal library a compact, readable visual index rather than a dashboard.

OWN-WORLD: Cool off-white #E9E9E5, black #191919 and restrained red #C8302D; self-hosted Barlow Condensed headlines and Public Sans labels. Thin registered cover cells, 2:3 image slots, direct controls, no fake paper or invented activity.

STORY: Sign in with Auth0 and recognize your own books by title, optional author and a representative cover. Missing covers and service failures remain understandable and recoverable.

FIRST VIEWPORT: At390px Dogear and the account control lead to Your library and a two-column cover grid with full bibliographic labels. Desktop adds whole columns to four, never excessive hero space. Signed-out retains the same frame and one sign-in action. Signature interaction is a stable whole-cell reveal as cover metadata arrives; reduced motion swaps instantly.

FORM: User-selected challenger pop-culture-shelf-doujin-event-catalog, seed ac22a84f. The selected mock at .impeccable/previews/small-press-catalog is the visual reference, not a raster comp or an invented capability promise. Code-first is confirmed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
