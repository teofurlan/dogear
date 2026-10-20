# Dogear: working requirements

Living document for the Hacktoberfest Week 3 ("Slow and Steady") entry. It is updated as decisions are made. The public write-up lives in `post-draft.md`.

Deadline: 2026-10-25 23:59 PDT.

## Product

- **R1. Capture.** The user photographs the pages they highlighted, from the phone (PWA). One page per photo, flat, with good light (the capture screen guides this).
- **R2. Books.** A "currently reading" shelf. A book is added once, from a photo of its cover or its ISBN barcode. The camera screen shows the active book (the last one used by default). After a gap since the last photo, it asks "Still reading X?".
- **R3. Any highlighter color.** Several colors may be used, and the color must not change the result.
- **R4. Night run.** The night run extracts the highlighted passages, with exact word boundaries, the page number, and quotes that continue onto the next page.
- **R5. Morning review, user in full control.** The user can keep, edit or delete any quote, and add a passage the run missed, regardless of model confidence. Flags (model and OCR disagree, or the page does not match the book) only point the user's attention.
- **R6. Minimal reading tracker, optional to use.** Books have the states want to read, reading and finished. Progress is the highest page photographed. Each book lists its quotes, and quotes are searchable by meaning.
- **R7. Destinations.** The app is the source of truth. Notion export uses the user's template and is optional, and so is Markdown export.

Out of scope this week: ratings, reviews, goals, statistics, handwritten margin notes.

## Pipeline (from the 2026-10-20 spike)

1. Find the page region and ignore the hand, the background and the curled facing page.
2. Highlight mask: each pixel's distance from the paper's own tint in Lab, independent of the highlighter color.
3. OCR (Tesseract, `spa`, grayscale at 2x) returns word boxes. A word is highlighted when at least ~25% of the paper under its box is highlighted. Consecutive highlighted words form one passage, with small gaps merged.
4. Gemma reads each highlighted crop. Its text is kept where it agrees with the OCR words, and any disagreement is flagged.
5. The quotes go to the review queue.

## Spike evidence (3 photos, a single highlighter color)

- The Lab tint shift found every highlighted block. **Only one color was tested.** The spike code also assumed that one color's direction and used a skin filter that would reject warm-colored highlighters. R3 requires replacing them with tint distance plus page-region detection, which is not yet tested.
- Gemma 4 e4b on a full page cannot tell which text is highlighted. On crops it reads well but once skipped a clause.
- OCR word boxes plus coverage give exact boundaries on the flat page, in about 5 s per page on CPU.
- Gemma on CPU (4 threads): about 25 s to load, then 9-18 s per crop.
- Not measured: RAM on Render, other highlighter colors, other books or lighting.
