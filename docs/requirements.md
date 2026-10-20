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

## Pipeline (implemented locally on 2026-10-20, see README)

1. **Page region:** the largest paper surface, with its holes filled. A thumb or the background touching the edge is never inside it.
2. **Highlight mask:** the Lab a/b distance from the paper's tint. The tint is fitted as a smooth quadratic surface across the photo, so uneven light does not shift the reference. Independent of the pen color.
3. **OCR word boxes:** Tesseract, `spa`, grayscale at 2x. A word is highlighted when at least 25% of the paper under its box is. Gaps of up to 2 words are merged, runs of fewer than 3 words are dropped, and end-of-line hyphens are joined.
4. **Two readers:** Gemma reads a crop that is blank except for the passage's own words. Its text is kept, and runs of 2 or more words it dropped or added compared with OCR flag the quote (`readings_disagree`). Without the model, or when it fails, the OCR text is used and flagged (`ocr_only` or `model_unavailable`).
5. The quotes go to the review queue (not built yet).

## Evidence

- **Real photos (2 pages, one pen color, one with uneven light):** 3 of 3 highlighted passages were found on each flat page, with no false quotes and with correct word boundaries. OCR plus the mask take about 5 s per page on CPU. The curled facing page is ignored.
- **Synthetic pages:** yellow, green, pink, blue and orange pens at 12% blend strength are all found (more than 80% of the tinted area), with no detection on plain paper, the hand or the background.
- **Model:** Gemma 4 e4b on a full page cannot tell which text is highlighted. On crops it reads well but once skipped a clause. On CPU with 4 threads: about 25 s to load, then 9-18 s per crop.
- **Memory (Windows, CPU only, 4 threads):** the model process peaked at a 4.09 GB working set (8.25 GB of private commit that Windows reserves without touching). Pages took 54 to 84 s, model load included.
- **Render constraints (render.com/docs/cronjobs):** cron jobs pull the image before every run, cannot use a persistent disk, and are stopped after 12 hours. A community answer cites a 10 GB image limit (unverified in the docs).
- **Not measured yet:** RAM on Render itself (Linux), real photos with other pen colors, other books and lighting.
