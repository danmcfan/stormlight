# Style prototypes: shared brief

The user's direction: golden rails for frames, buttons made of glass, on a
pitch-black background; golden, dreamy icons; minimal copy, set in a fantasy
elvish-style font.

Each prototype is ONE self-contained `index.html` in its own folder here (inline
CSS/JS/SVG; fonts from Google Fonts only; no images, no paid generation, no
build step). It shows the same dashboard content so they can be compared:

1. App bar: brand mark + "Swarm", nav (Fleet, Graph), a live indicator.
2. Totals strip: est. cost $5.92; tokens in 1.2k / out 140k / cache write 412k /
   cache read 7.1M; agents 3 running of 4; plan meters 5-hour 9% and 7-day 24%.
3. Round filter: All, Round 1, Round 2 (a segmented glass control).
4. Agent table, 5 rows: main "Lead" (claude-opus-5-5, idle, $2.11) and subagents
   "Data layer" (sonnet, done, $1.31), "Fleet view" (sonnet, running, $1.12),
   "Component graph" (sonnet, running, $1.05), "Plan usage" (sonnet, running,
   $0.33) with a status glyph, model, round, duration, tokens, cost, activity.
5. A small graph vignette (inline SVG): 6 component nodes (src/combat,
   src/render, src/world, docs, scripts, tests), 4 agent nodes, gold edges, one
   edge glowing "live".
6. An agent detail card with a short tool-call timeline (Read / Edit / Bash).
7. Buttons in all states: primary, secondary, icon-only, hover, pressed,
   focus-visible, disabled.

Rules: pitch black (#000-ish) background; gold as rails and light, not as large
flat fills; glass = translucency, blur, highlights, refraction edges; icons are
original inline SVG (no icon fonts, no copied logos or game art). The display font
can be fanciful; numbers and table data must stay readable (pair it with a clean
face for figures). Text contrast >= 4.5:1, focus visible, respects
prefers-reduced-motion. Works at 1440 px and on a phone (390 px) with no
horizontal page scroll. Original design: do not imitate a specific film, game or
book's branding.
