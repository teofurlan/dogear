---
title: "I highlight paper books. A small open model types my quotes while I sleep"
tags: devchallenge, hf26challenge, opensource, ai
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 3: Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19).*

## What I Built

I read on paper, with a highlighter in hand. Every quote that stops me ends up in a Notion database: knowing I'll keep what I mark makes me read more carefully, writing it down helps me remember it, and later I can find the right line when it comes up in a conversation or in something I'm writing.

The chore is in between: sitting down with the book, finding each highlighted passage again and typing it word by word. By the end of a book I have dozens of highlighted lines and no will to copy them.

**Dogear** removes that chore. While reading, the only extra thing I do is take a photo of each page I highlighted. Overnight, a small open-weight model running on a plain CPU in the cloud reads the photos and pulls out exactly the highlighted passages. In the morning I review them and stay in full control: I can keep, edit or delete any quote, and add one the night run missed. What I keep lands in my book log, and in Notion if I want.

> Dogear is still growing. Reading highlights from photos and the night run already work; the screens that connect them to my phone are what I'm building now. [What's still ahead](#whats-still-ahead) says exactly where it stands.

## Demo

TODO: deployed link (anyone can sign in and start their own library) and a short video of the loop.

## Code

{% github teofurlan/dogear %}

## How I Built It

### My highlighter is almost invisible to a computer

Before writing any app code, I tested the riskiest assumption with three real photos taken on my lap, one-handed. In a phone photo, a highlighter barely changes the paper: its color saturation measured about 7 out of 255, which is basically gray.

What worked was the Lab color space, which separates brightness from color. Instead of looking for a particular color, the code measures how far each pixel drifts from the paper's own tint, so it doesn't care which pen I picked. Light was the next trap: with half a page in shadow, one paper tint no longer fit the whole photo. The fix was to fit the tint as a smooth surface across the page and compare each pixel with the tint at its own position. That found every highlighted block on my test pages.

### The model is a good reader and a bad judge

My first plan was to hand the whole photo to Gemma 4 (`e4b`, running in Ollama) and ask for the highlighted text. On one page it found 1 of 3 passages. On the other, it confidently returned the chapter title, which isn't highlighted at all. Given only a crop, it read well, but once it silently dropped a whole clause. A quote app that drops words is worse than no app.

So the design flipped: **the model reads, the code decides.**

1. **Color decides what is highlighted.** It's deterministic and cheap.
2. **OCR finds where every word is.** Tesseract returns a box for each word, and a word belongs to a quote when enough of the paper under it carries highlighter. That found the exact first and last word of every passage, even when a highlight starts mid-line.
3. **Two readers, compared.** OCR knows *where* but misreads letters. Gemma writes clean text but can skip words. Each block is read by both, and Gemma's version is kept where they agree.
4. **Disagreement is flagged for me**, with the photo crop next to the quote. Flags only point my attention: every quote stays mine to keep, edit or delete.

On my two test pages, the pipeline found 3 of 3 passages on each, with no false quotes. Watching Gemma fail taught me two fixes: send crops shaped like a text selection instead of scattered word boxes, and compare readings in a way that forgives OCR's glued words and the page's line-break hyphens. In the end, 4 of the 6 quotes came out with both readers agreeing, and the other 2 were flagged, exactly where OCR scrambled the text near the book's gutter. No wrong quote was presented as confident.

### Slow on purpose

None of this has to happen when I take the photo, so it doesn't. A nightly cron job on Render processes the day's photos on a plain CPU, with no GPU. The model weights are baked into the Docker image, and a page takes about a minute once the model is loaded, so even a heavy reading day of 30 pages is done in about half an hour, long before I wake up. The job first ran on an 8 GB instance for about 2.5 cents, but Gemma peaked near 7.4 GiB there, so it moved to 16 GB for about a cent more per night.

### From a script to an app

Around the pipeline, I'm building a FastAPI server and a React PWA:

- **My books, only for me.** Sign-in goes through Auth0, the server checks every token, and books live in MongoDB Atlas tied to the verified account. Tests make sure one reader never sees another reader's books.
- **A library that looks like a book catalog**, with covers from Open Library. When there's no reliable match, a book gets a plain placeholder instead of a guessed edition.
- **Adding a book, the lazy way.** I type it or photograph the cover. OCR suggests the title and author, nothing is saved until I confirm, and the cover photo is never stored. Same rule as the quotes: the machine suggests, I decide.
- **A careful PWA.** Its service worker keeps only a public "you're offline" page. Sign-in data, books and photos never touch its cache.

### What's still ahead

Reading highlights, the night run and the library work. What's missing is what ties them together: photographing pages from the app, sending them to the night run, and the morning review. After that come search by meaning and the Notion export.

## Why Does Open Innovation Matter?

- **My reading stays mine.** My photos and highlights are read by a model running in my own night job, not sent to a third-party AI API.
- **It costs a few cents a night.** A small open model on a plain CPU is cheap enough to run every night for years, with no per-request bill.
- **The model doesn't change under me.** The whole design rests on knowing how Gemma fails. With the weights pinned in my image, tomorrow's model fails the same way today's does, so the checks I tuned against it keep working.
- **Swappable parts.** The model and the OCR sit behind small interfaces, so a better open model can replace Gemma without touching the rest.

## The Lazy Payoff

**Before:** in a dense book, I highlight 2 or 3 passages per page. Copying them is a 30 to 60 minute typing session, so I keep postponing it, and the quotes pile up in books I've already shelved.

**After:** one photo per highlighted page, taken while the book is still open, and a short review over breakfast. I'll measure the real review time as soon as the review screen exists.

## Prize Categories

- **Best Use of Gemma:** Gemma 4 `e4b` reads every highlighted block, cross-checked against OCR.
- **Best Use of Render:** the nightly CPU cron job that runs the extraction.
- **Best Use of MongoDB Atlas:** each reader's books, stored per verified account.
