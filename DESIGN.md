---
name: Dogear
description: A small-press catalog for a personal library.
colors:
  catalog-paper: "#e9e9e5"
  catalog-ink: "#191919"
  catalog-red: "#c8302d"
  catalog-rule: "#a7a7a1"
  catalog-muted: "#484844"
  action-text: "#fff"
  cover-ground: "#d1d0ca"
  cover-image-ground: "#e0e5e6"
  skeleton-ground: "#d4d4ce"
  load-more-hover: "#dcdcd5"
typography:
  display:
    fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif'
    fontSize: "2.65rem"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  display-desktop:
    fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif'
    fontSize: "4.15rem"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  wordmark:
    fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif'
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif'
    fontSize: "1.7rem"
    fontWeight: 700
    lineHeight: 1.05
  title:
    fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif'
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.08
  body:
    fontFamily: '"Public Sans", Arial, sans-serif'
    fontSize: "0.94rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Public Sans", Arial, sans-serif'
    fontSize: "0.77rem"
    fontWeight: 400
    lineHeight: 1.35
  count:
    fontFamily: '"Public Sans", Arial, sans-serif'
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.5
  footer:
    fontFamily: '"Public Sans", Arial, sans-serif'
    fontSize: "0.72rem"
    fontWeight: 400
    lineHeight: 1.5
spacing:
  catalog-gutter: "clamp(1rem, 4vw, 3.25rem)"
  cell-mobile: "0.65rem"
  cell-wide: "0.8rem"
  copy-inset: "0.55rem"
  block-gap: "1.65rem"
components:
  button-primary:
    backgroundColor: "{colors.catalog-red}"
    textColor: "{colors.action-text}"
    padding: "0.65rem 1rem"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.catalog-ink}"
    padding: "0.45rem 0.2rem"
  button-load-more:
    backgroundColor: "transparent"
    textColor: "{colors.catalog-ink}"
    padding: "0.7rem 1.25rem"
  button-load-more-hover:
    backgroundColor: "{colors.load-more-hover}"
  book-cell:
    backgroundColor: "transparent"
    textColor: "{colors.catalog-ink}"
    padding: "{spacing.cell-mobile}"
  book-cell-wide:
    padding: "{spacing.cell-wide}"
  wordmark:
    textColor: "{colors.catalog-ink}"
    typography: "{typography.wordmark}"
---

# Design System: Dogear

## Overview

**Creative North Star: "Small-press catalog"**

An independent book-fair catalog gives Dogear a compact, readable index: cool off-white ground, condensed black type, registered cells and restrained red punctuation. The material is expressed through typography and rules, not simulated paper texture.

The interface stays direct and quiet around the books. Self-hosted type, plain account actions and honest missing-data states carry the identity without invented reader activity or decorative imagery. This records the shipped library, not the richer reference board's search, maps, chips or illustrations.

**Key Characteristics:**
- Condensed display type paired with open, readable body text.
- A continuous cool ground divided by fine rules.
- Red reserved for punctuation, the primary action and interaction cues.
- Stable portrait cover slots with full bibliographic labels.

## Colors

Cool paper and near-black ink establish the catalog; one red accent gives actions and details a distinct voice. Frontmatter values are normative. Sidecar tonal ramps are synthesized panel previews, not additional shipped color tokens.

### Primary
- **Catalog Red**: the wordmark dot, sign-in button, link underlines, focus outlines and text selection.

### Neutral
- **Catalog Paper**: the continuous page ground, including empty and signed-out states.
- **Catalog Ink**: headings, controls and major registration rules.
- **Catalog Muted**: supporting copy, authors, counts and footer text.
- **Catalog Rule**: quieter grid and empty-state dividers.
- **Action Text**: white text on the red action and selected text.
- **Cover Ground**: neutral uncovered portrait slots.
- **Cover Image Ground**: the backing retained beneath contained cover images.
- **Skeleton Ground**: loading placeholders, not finished content.
- **Load More Hover**: a restrained tonal response on the outlined pagination action.

**The Red Punctuation Rule.** Use red where the implementation assigns emphasis or interaction; leave the catalog ground and cell structure neutral.

## Typography

**Display Font:** Barlow Condensed, with Arial Narrow and sans-serif fallbacks.
**Body Font:** Public Sans, with Arial and sans-serif fallbacks.

**Character:** Narrow, substantial headings provide the small-press voice; Public Sans keeps operational copy and bibliographic metadata unforced. Both families are self-hosted with swap loading.

### Hierarchy
- **Display / Display Desktop**: page headings; the desktop role begins at the wide breakpoint.
- **Wordmark**: the full lowercase `dogear.` name in the header, with a red terminal dot. Reserve `d.` for the favicon and icon-sized contexts; Dogear remains the accessible name. The favicon uses outlines of the same bundled glyphs on the catalog ground.
- **Headline**: the signed-out panel's secondary heading.
- **Title**: book titles use the bundled 700-weight Barlow Condensed face, with wrapping rather than truncation.
- **Body**: operational copy; introductory text is limited to 42ch, sign-in copy to 55ch and empty-state copy to 60ch.
- **Label / Count / Footer**: author metadata, tabular numeric counts and quiet attribution respectively. No uppercase tracking system is used.

**The Two Voices Rule.** Keep condensed type for identity and bibliographic/display headings; keep explanatory copy and controls in Public Sans.

## Layout

The centered shell has a maximum outer width of 1100px, fluid catalog gutters and a minimum height of 100svh. A flexing main region keeps the footer near the viewport bottom when content is short. The header and footer span the content width and use ink rules; the header grows from 4.35rem to 5rem at the wide breakpoint.

The cover grid uses two equal columns by default, three from 560px and four from 820px. It adds whole columns rather than stretching a desktop hero. Each cell has a fixed 2:3 cover slot, a label area below it, and fine shared borders. Cell padding changes from the mobile to wide spacing token at 560px. Long titles and author strings wrap anywhere when necessary; no clamp hides bibliographic content.

The authenticated main region begins with responsive top space and ends with 3.5rem of bottom space; wide screens use 3.2rem top padding. Empty libraries retain that frame.

The signed-out entry keeps the same visual language with a height-aware composition from 560px. Its main column distributes the heading, copy/action row and four fixed cover examples across the available height, instead of leaving unused space below the gallery. The heading grows from 3rem to 4.5rem using 6.5svh. Cover size grows with `clamp(5rem, calc(100svh - 36rem), 22rem)` but remains bounded by cell width and its 2:3 aspect ratio. Windows at most 680px tall reduce spacing and use a 2.5rem heading. Below 560px, the examples use two columns and natural vertical scrolling. Never hide overflow to simulate a fitting screen; errors and zoom must remain accessible.

## Elevation & Depth

The shipped system has no box-shadow vocabulary. Depth comes from tonal cover placeholders, real cover imagery and the distinction between ink rules and quieter dividers. Cells are flat at rest and do not lift on hover. Reference-board texture, ink wear and decorative illustration did not ship and are not reusable asset requirements.

**The Registered Ground Rule.** Separate catalog regions with rules and spacing, not elevated cards.

## Shapes

The recurring geometry is rectangular: square control outlines, thin registration rules and uncropped portrait cover slots. No rounded-token scale is declared by the shipped stylesheet. Covers use contain fitting so an edition's own artwork remains intact within the slot; typography supplies the fallback rather than a fabricated cover illustration.

## Components

### Buttons
Direct, text-led controls with distinct roles.
- **Primary:** red fill, white semibold Public Sans, an ink border and a minimum 48px height. Padding is recorded in the component token.
- **Text:** transparent account/retry actions with red underlines and a minimum 44px height; retry uses semibold text.
- **Outlined:** the centered load-more action uses an ink border, a minimum 48px height and a tonal hover ground.
- **States:** enabled primary buttons darken within the existing red palette on hover and press; text actions turn red on hover. Disabled buttons retain wait cursors and 0.65 opacity without hover feedback. Buttons and links share a red 3px focus-visible outline with a 4px offset. No active transform is used.

### Cards / Containers
Registered cells rather than floating cards.
- **Structure:** transparent ground, quiet right/bottom borders, portrait cover and bibliographic labels; the grid supplies its top/left border.
- **Cover:** a neutral typographic fallback remains behind a representative cover image. The image is contained, not cropped.
- **Arrival:** only cover images fade from 0.65 to full opacity over 180ms using cubic-bezier(.16,1,.3,1); there is no cell translation or stagger.
- **Loading:** static neutral cover and text blocks reserve the grid's geometry.

### Navigation
The header is a wordmark home link with a minimum 44px touch height and, when signed in, a text sign-out action. The same alignment and bottom ink rule persist on mobile. Heading rows wrap their count when space is tight. The footer provides a plain attribution link with a red underline; there is no tab bar or icon navigation system.

### Empty and Signed-out Panels
Empty content is a ruled, text-led region with a Public Sans heading and muted explanation, not a fabricated populated shelf. The signed-out panel uses ink rules, a condensed secondary heading and one red sign-in action.

Motion stays limited to smooth page scrolling and the cover arrival fade. Reduced-motion preferences disable smooth scrolling and reduce animation/transition durations to 0.01ms with one animation iteration. No input, chip, tooltip or dialog primitive exists in this slice.

## Do's and Don'ts

### Do:
- **Do** preserve the condensed-heading and readable-body pairing.
- **Do** use shared rules and the continuous paper ground to organize regions.
- **Do** retain full title and author labels beneath stable portrait slots.
- **Do** preserve visible focus and reduced-motion behavior on new controls.
- **Do** distinguish loading, missing covers and genuinely empty content.

### Don't:
- **Don't** replace the flat catalog cells with elevated dashboard cards.
- **Don't** import paper textures or illustrations from the world references as if they shipped.
- **Don't** treat populated mock books or counts as real account evidence.
- **Don't** add unsupported inputs, chips or icon navigation to the recorded primitive set.

Evidence: `web/src/styles.css`, `web/src/App.jsx`, `web/public/fonts/fonts.css`, `PRODUCT.md`, the library surface brief and screenshots in `.impeccable/review/library`. The signed-in screenshots show an empty account; populated grid rules are source-derived, not verified populated production output. Legacy unscoped fallback CSS is not promoted into a second visual system.
