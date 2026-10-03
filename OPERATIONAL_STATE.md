# OPERATIONAL STATE — GayDex: Circuit

Project: westkitty/Gay_Dex
Active branch: arena/01a10065-gay-dex
Baseline before uplift: 686d3294cff05bb431579d438fb633c272d99713

## Protected invariants
- GayDex_Battle_Simulator_SINGLE_FILE.html remains the directly launchable production artifact.
- src/battle-core.js remains authoritative for battle truth; Three.js is presentation.
- Canonical taxonomy, lineages, comparison, Evolution Lab, CPU modes, seeded replay and Circuit progression remain intact.
- Keyboard, touch, reduced motion, AUTO/HIGH/ECO, static fallback and zero-runtime-network behavior remain intact.
- Exactly one Three.js renderer / requestAnimationFrame owner.

## Verified baseline
- npm run verify: 37/37 tests pass.
- Build roundtrip and artifact freshness checks pass.
- Three.js pinned/vendored at r186.

## Current work
Performance + awe uplift: scoped world updates, lower-frequency crowd/mote animation, distance-aware specimen culling, cinematic fly arcs and focus pulses.

## Known unknown
Real GPU frame pacing, shader compilation, visual quality and long-session thermals require real-browser evidence.

## Uplift verification — 2026-10-03
- npm run verify: 38/38 tests pass after uplift.
- Generated single-file artifact rebuilt and build freshness passes.
- Active-district scheduler test verifies hot local updates plus throttled remote ambience.
- Representative specimen test verifies at least 10 of 19 distant specimens skip per-frame visual work.
- Structural scheduler reduction versus baseline: updater invocations drop from 40 to 19 per 8 frames in an active district (52.5% fewer); route-node animation drops from 152 to 47–54 per 8 frames depending district (about 64.5–69.1% fewer).
- Headless Brave GPU proof remains unavailable: Brave exits before render with macOS CVDisplayLinkCreateWithCGDisplay error -6670. Do not claim measured FPS from this run.
