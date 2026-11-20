# Spill: pre-alpha prototype demo (static site)

A free, short, playable demo: the game's own title screen with one item, Begin, which starts the prototype's Sieve boss fight. Nothing else. The only change to the game code is a two-line hook in `src/game.js` (`SPILL_DEMO_TITLE`) that lets `demo.js` set the title menu. It is **not** the remake and **not** the Eye of the Wells. Runs entirely in the browser; no build step.

## Live
https://ayellowplum.github.io/spill-demo/

Test locally: `python3 -m http.server 8792` in this folder, open http://localhost:8792/

## Notes
- A public repo exposes all code and assets to anyone (see KICKSTARTER_PLAN.md section 5.7); the licence is the legal protection. For a private-ish build use itch.io with a password instead.
- Play the boss fight through once by hand to a real win.
- Size is about 40 MB (music tracks only the two modes use).
