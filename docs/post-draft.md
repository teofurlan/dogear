---
title: "I highlight paper books. A small open model types my quotes while I sleep"
tags: devchallenge, hf26challenge, opensource, ai
---

<!-- DRAFT. Placeholders are marked TODO. -->

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 3: Slow and Steady](https://dev.to/devteam/join-the-hacktoberfest-open-source-ai-challenge-slow-and-steady-2850-in-prizes-across-21-3iee).*

> **Status: building in public.** I'm publishing this on day 2 and updating it as the project grows. The changelog at the bottom shows what changed and when.

## What I Built

I read on paper, with a highlighter in hand. Afterwards, every quote that stopped me goes into a Notion database, with a template I like. I keep them for three reasons:

- **To read on purpose.** Knowing I'll keep what I mark makes me read more carefully.
- **To remember what I read.** Writing a passage down helps me retain it long after I've closed the book.
- **To share at the right moment.** A conversation with friends often brings a quote to mind, and I want to find it in seconds instead of flipping through a book I may not have with me.
- **To write.** My saved quotes end up in what I write.

The gap between highlighting and saving is a chore I always postpone: sitting down with the book, finding each highlighted passage again, and typing it out word by word. By the time I finish a book, I have dozens of highlighted lines and no will to copy them.

**Dogear** removes that chore. While reading, the only extra thing I do is take a photo of each page I highlighted. That's it. Overnight, a small open-weight model running on a CPU in the cloud reads the photos and pulls out exactly the highlighted passages. In the morning, I go through them and stay in full control: I can keep, edit or delete any quote, and add one the night run missed, no matter how confident the model was. What I keep lands in my book log (and in Notion, if I want).

Because I usually need a quote in the middle of a conversation, the log is searchable by meaning, so I can find a quote even when I don't remember its exact words.

It also keeps a minimal reading tracker for free: the last page I photographed is how far I've read.

## Demo

TODO: 60-second video of the full loop (photo while reading → night run → morning review → Notion).

## Code

TODO: repository link.

## How I Built It

### The first surprise: my highlighter is almost invisible to a computer

Before writing any app code, I tested the riskiest assumption with three real photos: a cover and two highlighted pages of a Spanish paperback, taken on my lap with one hand.

In a phone photo, a highlighter barely changes the paper. Its color saturation measured about 7 out of 255, which is basically gray, so looking for "colored pixels" found nothing.

What worked was the Lab color space, which separates brightness from color. Instead of looking for any particular color, I compare each pixel with the paper's own tint on that photo: highlighted paper drifts away from it. That found **every highlighted block on both pages**, including one on the curled facing page.

I use several highlighter colors, so the app must not care which one I picked. TODO: confirm the detection with more than one color.

TODO: before/after image of the color mask.

### The second surprise: the model is a good reader and a bad judge

My first plan was to hand the whole photo to Gemma 4 (`e4b`, running locally in Ollama) and ask for the highlighted text. It didn't work:

- On one page, it found 1 of 3 highlighted passages.
- On the other, it confidently returned the chapter title, which isn't highlighted at all.

The faint highlight simply doesn't survive the downscaling a vision model applies to a whole page.

Given only a crop of a highlighted block, it transcribed well. But in one block it silently dropped a whole clause. A quote app that invents or drops words is worse than no app.

So the design flipped: **the model reads, the code decides.**

1. **Color decides what is highlighted.** It's deterministic and cheap.
2. **OCR gives the position of every word.** Tesseract returns a box for each word. A word counts as part of a quote when at least a quarter of the paper under its box carries highlighter. On my two test pages, this found the start and end of every highlighted passage on the flat page, down to the exact word, in about 5 seconds per page on a CPU. It even caught highlights that start in the middle of a line.
3. **Two independent readers, compared.** OCR is great at *where* but sloppy at *what*: it misread letters inside words and scrambled a long passage near the column gutter. Gemma is the opposite: clean text, but it can skip words. So each highlighted block is read by both, and the model's version is kept only where the two agree.
4. **Disagreement is flagged for me.** If Gemma drops words that OCR saw, or writes words OCR never saw, the quote reaches my morning review flagged, with the photo crop next to it. Flags only point my attention: every quote, flagged or not, stays mine to keep, edit or delete.

### Slow on purpose

None of this needs to happen when I take the photo, so it doesn't. A nightly job on Render processes the day's photos on a plain CPU, with no GPU.

On 4 CPU threads, Gemma takes about 25 seconds to load and 9 to 18 seconds per highlighted block. That's about a minute per page, so a heavy reading day of 30 pages takes roughly half an hour, finished long before I wake up.

TODO: architecture diagram (phone PWA → Render web service → MongoDB Atlas → nightly Render cron → review → Notion).

### Reading several books at once

TODO: the shelf, the sticky "currently reading" book on the camera screen, the "still reading X?" prompt after a gap, and the nightly check that flags pages that don't match the chosen book.

## Why Does Open Innovation Matter?

TODO, with real numbers once built. Points to cover:

- **What I read stays mine.** My photos and highlights are processed by a model I run, not sent to a third-party API.
- **Zero running cost at the model level.** A small open model on a CPU is cheap enough to run every night for years. Readwise already scans paper highlights, but it is a paid, closed cloud service.
- **Swappable parts.** The model, the OCR engine and the destination (Notion, Markdown, Obsidian) sit behind small interfaces, so I can swap any of them.
- **Fine-tuning is possible at all.** TODO: whether a fine-tuned small model fixes the dropped-clause and hyphenation errors (Tinker), measured against the base model.

## The Lazy Payoff

**Before:** in a dense book, I highlight 2 or 3 passages per page. Copying them is a 30 to 60 minute typing session, so I keep postponing it, and the quotes pile up in books I've already shelved.

**After:** one photo per highlighted page, taken while the book is still open, and a short review over breakfast. TODO: measure the real review time once the app exists.

## Prize Categories

TODO: confirm once each one is actually used.

- Best Use of Render: web service and nightly CPU job
- Best Use of Gemma: the vision model that reads the highlights
- Best Use of MongoDB Atlas: books, photos and quotes, plus semantic search to find a quote by its meaning
- Best Use of Sentry Agent Tracing: per-photo latency and token traces of the nightly run
- Best Use of Tinker: only if the fine-tune beats the baseline
- .tech Domain

## Changelog

- 2026-10-20: First version. Idea and the feasibility test with real photos.
