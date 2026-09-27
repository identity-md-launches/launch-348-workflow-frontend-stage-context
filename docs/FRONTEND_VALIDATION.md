# Frontend validation record

Worker review on 2026-09-27. This is evidence of local checks, not independent certification or a publication result.

## Scope and decisions

Implemented the one-page Volume / VOLM frontend against the supplied deployment handoff and pinned source commit `030e2537879f7cf474ef895f9ed1f9999fdb4830`. The deployed Solidity, Foundry configuration, dependencies and existing ABI exports were preserved. New delivery files are limited to `web/`, `dist/` and `docs/`; `web/.gitignore` is the explicitly permitted ignore file.

The page reads live public state even before wallet connection. Connected state adds balances, allowance and personal volume. Buy/sell are exact-input flows; primary settlement controls cover unpaid ranks and finalization of the last four ended epochs. The app does not add liquidity or offer token administration.

Two conflicting requirements were resolved explicitly:

- The requested root `DESIGN.md` lies outside the strict write scope. Its complete implementation record is delivered at `docs/DESIGN.md` instead; the root-location criterion is not literally satisfied.
- The explicit PoolSwapTest router is absent from the supplied `network.uniswapV4` block, which must remain unchanged. Its assignment-provided address is centralized in `imd-deployment.json` under `integrations.poolSwapTest`. Quoter, StateView and manager come from the unchanged network block. The app does not substitute the generic Universal Router example. Consequently, the literal criterion that **every** used Uniswap address exist inside the network block cannot also be satisfied for the assigned router.

PoolSwapTest exposes neither output minimum nor deadline. The interface accurately describes a terminal **price movement limit**, implemented with integer `sqrtPriceLimitX96` math. The hook rejects partial fills. Quotes are estimates; the 45-second UI expiry is not an on-chain deadline. This limitation is visible before confirmation and documented in `web/README.md`.

## Build and integrity evidence

`frontend/build-results.json` records the actual commands, exit codes, output, Node version and final manifest digest. The check sequence uses the lockfile with an offline worker cache:

```sh
cd web
node scripts/validate-build.mjs /tmp/volume-npm-cache
```

It runs `npm ci --offline --cache /tmp/volume-npm-cache --no-audit --no-fund`, `npm run build` (which includes `tsc --noEmit`), `npm run test`, and `npm run check:export`. All passed. The offline reinstall/rebuild produced the same manifest digest as the browser-tested export. A brand-new machine still needs a dependency installation or its own populated cache; no cache/registry/node_modules is included in Git.

Ten unit/integration tests passed: lossless decimal validation and integer bounds; buy/sell integer price limits; payout floor arithmetic over 1,000 pot sizes; canonical serialization; encoded swap direction/value/settings/identity/pool ID; unknown-chain addition; rejected switching; changed wallet guard; empty bytecode guard; and simulation failure blocking signing.

The exporter reads the ABI files with `git show <sourceCommit>:docs/abi/<Contract>.json`, compares bytes with the preserved local exports, then verifies canonical Keccak:

| Contract | Verified ABI hash |
| --- | --- |
| VOLM | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| VolumeLeaderboardHook | `6cca844bc066250cf7664d292ca4f70ddcee2de8924b0c9fbef38d95fd641cc0` |

The final export is 519,746 bytes including its manifest, with 10 inventoried assets. Each exported file other than the manifest is included exactly once and passes SHA-256 verification. Contract sets/identifiers and network/add-chain parameters match the handoff snapshots; ABI JSON is a raw array. All paths are local relative paths, no traversal or external asset URLs; each asset is below 8 MiB and the count is below 128. Vite uses a relative base. The export is well below half of the control plane's 64 MiB total response-body budget.

## Browser and interaction evidence

The supplied browser connector returned **Transport closed** at its first call and provided no preview file. The fallback was the installed Playwright 1.55 Chromium, run by the bounded foreground scripts in `web/tests/`. Each starts its own temporary local server, serves the real production `dist/` at `/preview/`, and closes server/browser on completion. No persistent background server is required.

`PLAYWRIGHT_BROWSERS_PATH=/tmp/volume-playwright npm run test:browser` passed **26 checks**. See `frontend/browser-results.json`. RPCs are intercepted and the injected wallet is a test fixture; its data and receipts are not live-chain results.

Coverage includes disconnected live reads and disabled actions; four past epochs; decoded Credited event; keyboard skip navigation; connect, quote and buy confirmation using keyboard activation; unknown-chain switch/add/switch with exact handoff parameters; invalid amount error and focus; buy calldata/value/hookData/limit; exact sell approval followed by a fresh quote and sell; one-based claim rank and paid-state refresh; independent finalization; simulation rejection without signing; wallet rejection; failed on-chain receipt status; account-change quote invalidation; disconnection; missing-wallet and empty states; RPC failure/recovery; missing bytecode; and ABI tampering.

No uncaught browser errors or failed resource requests occurred in the primary interaction scenario. The automated axe scan reported **0 violations**, with **33 passing rules**, for the chosen WCAG A/AA tags. This is an automated scan of that rendered state, not full accessibility conformance.

Screenshots viewed during review:

- `frontend/view-1440.png`: desktop populated fixture.
- `frontend/view-820.png`: intermediate-width populated fixture.
- `frontend/view-390.png` and `frontend/view-320.png`: mobile-width populated fixture.
- `frontend/text-200.png`: 200% CSS root text at 820px.
- `frontend/keyboard-confirm.png`: connected quote with visible confirmation focus ring.
- `frontend/empty-no-wallet.png`: epoch 0 with empty ranks and missing-wallet feedback.
- `frontend/live-desktop.png`: actual public-RPC browser view, recorded separately below.

All four viewport widths and enlarged-text state passed horizontal page-overflow assertions. Inspection found the corrected layout readable, primary controls reachable and the testnet context visible. Screenshots of long pages are full-height; use the PNG at its original resolution to inspect text.

## Live read evidence

`npm run check:live` performed real public-RPC reads using the configured endpoint. `frontend/live-read.json` records block **11,791,646**, exact read values, pool ID and endpoint. It verified chain ID 11155111; nonempty code at VOLM, hook, PoolManager, StateView, Quoter and PoolSwapTest; both hook and router manager bindings; token decimals 18; initialized slot0; hook views; and the bounded event window. Epoch 0 had zero pot, zero credited ranks, no ended epochs, and no events in the scanned deployment-to-read window. A read-only quote for `1000000000000` wei input returned `49481270350726962106` raw VOLM. The quote simulation used the zero address and did not sign or persist any state.

`PLAYWRIGHT_BROWSERS_PATH=/tmp/volume-playwright node tests/live-browser.mjs` separately loaded the production export with real browser RPC requests and no injected wallet. It reached live state with no uncaught errors or failed requests; `frontend/live-browser.json` records the visible state and time. The live screenshot shows the actual empty initial epoch and initialized pool price. Browser and RPC records are observations at their recorded blocks/times, not assurances about future state or RPC uptime.

No real approval, swap, claim or finalization was broadcast. Funded wallet signing, real gas estimation/payment, transaction inclusion/replacement, reorgs and a real recipient rejecting ETH were not exercised. Claims/finalization of past epochs necessarily use fixtures because the live deployment was still in its first epoch.

## Better Interface: six-domain review

The pinned workflow and all six core domains in `.imd/reads/skills/better-interface/REFERENCE.md` were read and applied during implementation. The documentation section was read before writing `docs/DESIGN.md`. Source attribution is retained there.

| Domain | Coverage and evidence | Explicit limits |
| --- | --- | --- |
| Accessibility — Checked | Native landmarks, heading outline, table headers/captions, input labels/descriptions, state text, skip link, keyboard activation, focus screenshot, axe scan, reduced-motion assertion, 40–48px action heights | No screen-reader session, physical touch-device test, browser-native zoom or forced-colors rendered session; full manual keyboard traversal of every repeated claim control not performed |
| Layout — Checked | Source/DOM order; desktop, intermediate, 390px and 320px screenshots; 200% text reflow; flexible cards and headings; no page overflow | No RTL or pseudo-localization; the only delivered language is English. Native 200% browser zoom not performed |
| Writing — Checked | Action-specific labels, price-limit caveat, exact approval step, recorded-recipient claims, original ended pot, testnet/no-return and unauthenticated identity copy; failure recovery tested | Error wording from wallet/RPC providers can vary |
| Typography — Checked | System font stacks; descending content headings; tabular amounts; 12px minimum supporting UI after review; 16px select/32px amount input; long-address links, enlarged text screenshots | OS-specific font availability/synthesis and Safari rendering not verified |
| Colors — Checked | Semantic palette; six computed rendered pairs all ≥4.5:1 (exact values in JSON and DESIGN); axe contrast scan; visible error/status labels | No dark theme exists; no claim that every possible provider-error/wallet-extension surface was measured |
| UI — Checked | Quote/approval/confirmation emphasis, selected direction, disabled/loading/empty/error states, disclosure controls, rendered focus, reduced-motion removal of 120ms feedback | No animation-panel 10% replay; there are no entrances, modals, video or continuous animations |

## Findings, corrections and rechecks

Locations refer to final source. These are worker findings, not an independent audit.

| Severity | Source | Evidence and impact | Correction / recheck |
| --- | --- | --- | --- |
| Medium | `web/src/style.css:281` | Initial 200% root text at 820px overflowed because fixed two-column grids outgrew their content widths | Main/activity layouts now wrap using font-relative flex bases; epoch grid uses `auto-fit` and capped minima. Final enlarged-text assertion and screenshot pass |
| Low | `web/src/style.css:420`, `web/src/style.css:1090` | Enlarged screenshot split rank digits and enlarged the wordmark/art text beyond fixed geometry | Rank badges use em sizing/nowrap; brand shape follows its text; decorative illustration retains a bounded scale. Final enlarged screenshot rechecked |
| Medium | `web/src/App.tsx:766` | Quote refresh and confirmation both had accent fill in one trade state, weakening the next-action distinction | Refresh becomes a neutral button while approval/confirmation remains accented; keyboard-confirm screenshot rechecked |
| Low | `web/src/App.tsx:392` | Disconnect initially retained the previous transaction link beside a new disconnect message | Disconnect clears its transaction hash; final disconnected screenshots show the corrected message |
| Low | `web/src/style.css` | Several supporting labels used 10–11px sizes, reducing comfort at narrow widths | Content UI floor raised to 12px; 320px reflow and axe checks still pass. Decorative hidden artwork retains its own scale |

During test-harness development, an unconditional `BigInt` cast attempted to parse a swap tuple. The fixture decoder was corrected to convert only epoch arguments; the passing interaction record was then regenerated. This was a test-fixture defect, not a shipped application workaround.

## Completion and remaining boundaries

**Implementation and local validation complete; local Git commit blocked.** The source, lockfile, static export, runtime manifest, implementation ABIs, tests and evidence are delivered in the working tree, with the two explicit requirement conflicts recorded above. Root design-document placement and using the absent PoolSwapTest address from within the unchanged network block cannot both be fulfilled under the supplied constraints.

`git add web dist docs` failed with `Unable to create .../.git/index.lock: Read-only file system`. No local commit or staging is claimed. The network collector must include the delivered files in its source submission. The original tracked source remains unchanged (`git diff --exit-code` passed). No protected files, submodules, symlinks, dependency caches or npm archives are included among the delivery files.

`frontend/delivery-audit.json`, produced by `node web/scripts/check-delivery.mjs`, records the permitted-path check and a conservative size bound: the full existing-history Git bundle plus all uncompressed delivery files, plus a 1 MiB reserve for new metadata/packing overhead and the audit record. This is below 8 MiB. An exact bundle of a new commit cannot be produced without writable Git metadata; that limitation is explicit rather than reporting a fabricated bundle size.

The checked export is ready for the publisher. Site publication, IPFS CID, naming, immutable/named asset verification and control-plane RPC verification have not been performed by this worker and are not claimed as results. They remain the subsequent workflow's responsibility. The network verifier for this assignment checks paths and bytes; it does not certify these behavioral claims.
