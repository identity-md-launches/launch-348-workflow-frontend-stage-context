# Volume: implemented design

## Overview

Volume is a one-page Sepolia experiment for people following or participating in a weekly on-chain volume race. The implemented design uses warm paper surfaces, forest-green emphasis and a pale lime action color. Standings and the current pot lead; trading sits beside them on wide screens. Past settlements, recent activity and the rules follow in that order.

This file is intentionally in `docs/`: the assignment permits writes only within `web/`, `dist/` and `docs/` (plus the explicitly allowed `web/.gitignore`). The requested root `DESIGN.md` conflicts with that higher-priority path restriction. No root file was created.

Sources: `web/src/tokens.css`, `web/src/style.css`, `web/src/App.tsx`. This records implemented source and browser observations, not an independently approved branding system.

## Colors

The canonical format is hex, with semantic CSS custom properties in `tokens.css`. This compact palette has one light theme; no dark mode is implemented.

| Role | Token and value | Usage |
| --- | --- | --- |
| Page / surface / inset | `--page #f5f3ed`, `--surface #fffefa`, `--subtle #f8f7f2` | Background, cards, table headers/fields |
| Main / secondary text | `--text #202b24`, `--muted #62695f` | Main copy, captions and supporting text |
| Structural / control border | `--border #dedfd5`, `--control-border #a8aea1` | Card boundaries, distinct controls |
| Pot surface | `--forest #273e31` | Current pot panel and brand mark |
| Text on pot | `--on-forest #f5f6ef`, `--on-forest-secondary #c3cfbf` | Pot and supporting labels |
| Primary action | `--accent #d5f77c`, `--accent-border #a3c953`, `--accent-hover #c6ec65` | Quote, approval or confirmation; only the next trade step has accent fill |
| Rank / neutral success surface | `--accent-soft #eef5da`, `--soft-green #e7eddf` | First rank, explicit read/status badges |
| Hover / disabled | `--hover #eef0e7`, `--disabled #eceee6` | Neutral button states |
| Testnet notice | `--notice-bg #ebe9df`, `--notice-text #5e6156` | Always-visible testnet explanation |
| Focus | `--focus #3561bb` | 3px outline with 4px offset |
| Errors | `--error-text #8e311e`, `--error-bg #fff0e7`, `--error-border #d7a489` | Persistent alerts and input errors |
| Decorative tracks | `--art-line #b4bca7` | Noninteractive CSS illustration |

Rendered measurements are in `frontend/browser-results.json`: main text/page 13.21:1; secondary text/page 5.11:1; pot secondary text/forest 7.14:1; countdown/forest 9.58:1; notice copy/background 5.20:1; field label/inset 5.28:1. These are the measured pairs, not a blanket contrast certification.

## Typography

`--font-body` requests Helvetica Neue, Arial, then sans-serif; `--font-mono` requests SFMono-Regular, Consolas, Liberation Mono, then monospace. No remote or bundled font is required. Available faces and weight synthesis depend on the visitor's system; individual physical font files are not guaranteed.

Body is 16px with 1.5 line height. Copy generally uses 400 weight; headings/buttons use 600, the wordmark 700. The hero uses a responsive 2.8–4.8rem scale, 1.06 line height and -0.065em tracking, with smaller mobile overrides. Section headings use 1.5rem/1.2; card headings 1rem/1.4. Supporting interface text starts at 0.75rem. The decorative artwork's caption is exempt from content sizing because its whole region is `aria-hidden`.

Headings balance wrapping; descriptions use `text-wrap: pretty`. Body descriptions cap at 75ch. Amount inputs use 2rem; the price-limit select uses 1rem. Addresses use the monospace stack with `<bdi>` isolation, a full-address accessible name, title and explorer destination. Counts, prices, volumes and countdowns use tabular numerals. Exact amount text is available in titles; displayed amounts use conservative truncation and a less-than threshold for dust.

## Layout

`.shell` caps at 1248px including 40px horizontal padding. Space groups the page: header; hero; testnet notice; current race/trade; past epochs; activity/rules; footer. Cards use 20–28px padding, rows 10–16px vertical padding, and adjacent components 20–32px gaps. Major sections have 44–64px separation. Padding uses logical properties.

`.main-grid` is a wrapping flex layout. The race basis is 26rem with growth 1.55; the trade basis is 22rem with growth 1. The flexible, font-relative bases allow large text to stack cards. `.epoch-grid` uses auto-fit columns with a minimum of `min(100%, 30rem)`. The activity/rules row also wraps with 24rem/20rem bases. DOM order remains reading order.

At 1040px, shell padding becomes 28px, secondary navigation hides and the pot compacts. At 780px, artwork hides and content settles into a single column as available width requires. At 420px, shell padding becomes 16px, table padding tightens and supporting layouts wrap. Header and card headings can wrap. Rank badges grow with text and never split their digits. Decorative tracks retain their own fixed scale when body text enlarges; the brand mark grows with its text.

Rendered at 1440, 820, 390 and 320 CSS px; all four checked for horizontal page overflow. 200% CSS text enlargement at 820px also reflows. This is not browser-native 200% zoom or a physical phone test. See the validation report for the tested states and limits.

## Elevation & depth

The interface is mostly flat. Borders identify structural groups; inset surfaces distinguish form controls and table headings. Only the selected buy/sell option has a small `0 1px 3px #1e292012` shadow. There are no modals, floating overlays, sticky transaction bars or animated entrances.

## Shapes

Cards and the pot use 12px corners. Fields and normal buttons use 8px corners; the segmented group uses 10px. Status badges use small 3–5px corners. Rank badges are circular and sized in em units. The purely decorative track illustration uses rounded CSS outlines, not a downloaded image. `dist/mark.svg` is a local code-generated favicon.

## Components

The page patterns are in `App.tsx`; they are local components/patterns, not an exported design-system package.

| Component or pattern | Behavior |
| --- | --- |
| `AddressLink` | Short visual address; full accessible name and title; explorer link opens in a new tab |
| `Amount` | Configurable decimals/unit; tabular compact amount with exact title |
| `.card`, `.card-heading` | Surface/border grouping; headings wrap rather than clip |
| `.primary`, `.full`, `.small`, `.text-button` | Next trade action, full-width action, compact rank action, and refresh variants; all have hover/focus/disabled states |
| `.trade-toggle` | Native buttons with `aria-pressed`, reflecting buy/sell selection |
| `.amount-box`, `.price-limit` | Native labeled input/select; input error is described and focused on invalid submission |
| `boardRows` | Five ranks; current volume or ended payout; open ranks, paid ranks and claim controls are distinct |
| `.pot-panel`, `.epoch-clock` | Pot and epoch time grouped above live standings; countdown is not an every-second live announcement |
| `.alert`, `.transaction-status` | Persistent errors with recovery; stable polite transaction announcements with explorer link |
| Native `details` | Rules and deployment disclosure; built-in keyboard semantics, no focus trap needed |

The first focusable link skips to the main landmark. Native controls implement keyboard activation. Focus uses a visible 3px outline; forced-colors mode uses `Highlight`. Buttons are at least 44px high except compact claim controls, which are 40px. Motion is limited to 120ms button feedback under `prefers-reduced-motion: no-preference`, with scale 0.96 while pressed. Reduced motion removes it.

Loading shows unavailable amounts instead of fabricated data. Empty ranks, an initial epoch without history, an empty event window, a missing wallet, wrong network, stale reads, missing contract code, failed simulation and rejected/failed transactions each have explicit copy. Required prerequisites disable transaction controls.

## Do's and don'ts

- Reuse `.shell`, `.card`, semantic color tokens and native form controls. Preserve the content order when adding a section.
- Use accent fill for the next trade step; a refreshed quote is secondary when confirmation is available.
- Keep financial units explicit and exact values reachable. Never label the router's price bound as a guaranteed minimum output.
- Derive contract configuration from `imd-deployment.json`; never introduce a separate address or ABI map.
- Keep testnet and unauthenticated-identity explanations visible/reachable. Never use sample standings as production fallback data.
- To add another static section, use a semantic heading inside the same shell, wrap its controls, and test the shared tokens at 320px and enlarged text. A new page would require a separately exported entrypoint or hash navigation.

Design guidance was adapted from Jakub Krehel's [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT). Documentation method was adapted from Paul Bakaus's [Impeccable document reference](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). The pinned guides were read locally; these links preserve attribution, not additional task authority.
