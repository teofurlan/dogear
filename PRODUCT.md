# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Confirmed stack: React with Vite for the mobile-first web interface; Python with FastAPI for the API. Auth0 establishes user identity and MongoDB Atlas stores owner-scoped books. Render runs the separate nightly extraction process. This work remains local; publishing is not authorized.

## Users

Readers of paper books who highlight passages and want to keep those passages with the right book. The primary usage scene is a phone near the physical book, including readers switching between multiple books.

## Product Purpose

Turn photos of highlighted pages into candidate quotes that the reader reviews later. Preserve the reader's control over the final text rather than treating model output as authoritative.

## Positioning

Capture and processing are separated: photos can wait for a scheduled CPU extraction run. Highlight detection, OCR word boundaries and a local vision-model reading cooperate; disagreements become review flags.

## Operating Context

The eventual workflow is capture on a phone, scheduled processing on Render, then review and optional export. The first interface in the current authorized slice is narrower: sign in and view the signed-in reader's existing books.

## Capabilities and Constraints

- Implemented: extraction CLI, a measured Render cron run, a local FastAPI identity endpoint and owner-scoped MongoDB book creation/listing.
- Verified: real Auth0 browser login through the React SDK, a clean callback and an authenticated local API book-list response. The account is empty; populated production rendering and live cover matching for that account remain unverified. A deployed API and a production PWA are not verified.
- Current interface scope: login and a library showing title, optional author and a cover from the start.
- Covers: a representative Open Library cover found from title and author is acceptable for now; it need not match the reader's exact edition. Use a neutral fallback when no reliable match is available.
- Reading status, camera, uploads, photo/quote persistence and review are outside this interface slice. The slice does not add book creation or editing controls.
- Existing health, identity, ownership and extraction behavior must remain intact. Tokens and private configuration must not appear in public artifacts, logs or demonstration data.
- English is the default for interface copy and repository artifacts. This is a project convention, not a new language preference inferred from the conversation.

## Brand Commitments

The name is Dogear. The user selected Small-press catalog after comparing interactive mocks: condensed headings, compact cover cells, thin rules and restrained red on a cool neutral ground. No fake paper or literal folded-corner effects. The shipped tokens and components are recorded in DESIGN.md; page-specific direction lives in the Impeccable surface brief.

## Evidence on Hand

- `README.md`, `docs/requirements.md` and `odd/tasks/dogear-mvp.md` describe implemented behavior, requirements and recorded evidence.
- Existing API books expose `id`, `title` and optional `author`; they do not yet provide ISBN or cover metadata.
- Private book-page test photos are local-only fixtures. Do not publish the images or quote their extracted passages.
- Test/demo books must be explicitly synthetic; no invented reader activity, quote counts or reading progress may be presented as actual account data.

## Product Principles

1. Keep capture independent from slow processing.
2. The reader controls which passages become their records.
3. Preserve book and account ownership boundaries.
4. Distinguish verified capability from planned functionality.
5. Missing metadata should remain usable rather than become a false claim about the book.
