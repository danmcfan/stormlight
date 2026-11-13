# Mobile audit — Swarm dashboard

Scope: `/` (Fleet), `/graph`, `/lead`, app shell (`Header.tsx`, `__root.tsx`,
`styles.css`, `calm.css`, `nav/nav.css`). Tested live in Chromium
(`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) against
`npx vite dev --port 3100`, emulating `devices['iPhone 15 Pro']` (390×844 CSS
px) and `devices['iPhone 15 Pro landscape']`.

Overall: the shell (safe-area insets, `100dvh`, 16px input font, sticky dock,
`prefers-reduced-motion`) was clearly built with a phone in mind — most of
AGENTS.md's checklist is already handled. The remaining problems are
concentrated in the Fleet table.

`document.documentElement.scrollWidth > clientWidth` was **false** on every
route/orientation tested — the *page* never scrolls sideways. But one
component scrolls sideways inside itself with no visual hint that it does,
which is the main finding below.

---

## Must fix

### 1. Fleet table needs ~450px of hidden horizontal scroll at 390px wide, with zero affordance that it's scrollable

- **File:** `src/components/fleet/AgentTable.tsx` (column list `COLS`, lines 17–32) and `src/styles.css:1108-1113` (`.table-wrap`)
- **Measured:** at 390px viewport, `.table-wrap` reports `scrollWidth: 783` vs `clientWidth: 335` (inside the `.frame` padding). That's 448px of content — more than the entire viewport width again — reachable only by swiping the table sideways.
- **Why it hurts:** `hide-sm`/`hide-md` already strip Kind, Model, Started, In, Cache read and Plan at ≤47.99rem, which is the right idea, but what's left (Status, Agent, Round, Time, Turns, Out, Est. cost, Activity — 8 columns) still doesn't fit 390px, and nothing in the UI shows the table can scroll: no scrollbar (`scrollbar-width: thin` on a touch device shows nothing), no edge fade, no "swipe for more →" cue. A screenshot at rest shows Time/Turns/Out/Cost/Activity simply cut off mid-glyph at the viewport edge (confirmed in `/tmp/fleet-table-left.png` — digits like "31m 3", "10m 16", "11m 47" are sliced at the right edge).
- **Fix:** drop two more columns on phone and add a scroll-edge fade so the cut is legible as "more content," e.g.:
  ```css
  /* styles.css, replace the .hide-sm block (~line 1271) */
  @media (max-width: 47.99rem) {
    .hide-sm { display: none; }
    .agents td.num:nth-last-child(3), /* Turns */
    .agents th.num:nth-last-child(3) {
      display: none; /* also hide on phone, not just tablet/mid */
    }
  }
  ```
  and give `.table-wrap` a scroll cue so a cut column reads as scrollable:
  ```css
  .table-wrap {
    overflow: auto;
    /* ...existing... */
    background:
      linear-gradient(var(--bg) 0 0) left / 0 100% no-repeat,
      linear-gradient(to right, transparent, var(--bg)) right / 24px 100% no-repeat;
    background-attachment: local, scroll;
  }
  ```
  Simpler alternative that avoids the columns problem entirely on phone: collapse `Est. cost`/`Activity` into the existing `Agent` cell as a second line (the way `.cell-activity` is already styled), so the always-visible columns are just Status · Agent (two lines: label + cost/activity) · Time, which fits 335px without any horizontal scroll.

---

### 2. Fleet table still overflows in landscape too, and so does the round selector

- **File:** same as #1, plus `src/components/fleet/Filters.tsx` (`RoundSelector`)
- **Measured at 844×390 landscape** (`devices['iPhone 15 Pro landscape']`, 734px CSS width): the `.agents` table's own `<thead><tr>` reports `right: 827` against a 734px-wide viewport — the Activity column header is sliced ("ACTIVI…", see `/tmp/v2-landscape-index-full.png`). The `.rounds` segmented control is worse: its inner `.seg` reports `width: 1006` in a 734px-wide card, i.e. roughly 270px — a whole extra round pill or more — is swiped-away and invisible, again with no scrollbar or fade to say so.
- **Fix:** same column triage as #1; for `.rounds`/`.seg`, add the edge-fade mask below.

### 3. Column-sort buttons and graph detail-panel links have a 24px-tall tap target

- **File:** `src/styles.css:1156-1169` (`.sort`), `src/components/graph/graph.css:522-534` (`.gp-link`)
- **Measured:** `page.locator('.sort').first().boundingBox()` → `{ width: 65, height: 24 }`. `page.locator('.gp-link').first().boundingBox()` (in the Graph detail panel's "Spawned by" / "Subagents" / "Touched by" lists) → `{ width: 47, height: 24 }`. Both are defined by `min-height: 24px` with no padding, and both are the *only* clickable element in their row (the `<th>`/`<li>` around them has no handler), so the real tap target is 24px, not the 44px iOS HIG minimum — easy to miss on a phone, especially `.sort` which is how you re-sort the Fleet table with a thumb.
- **Fix:**
  ```css
  /* styles.css */
  .sort { min-height: 44px; padding-block: 10px; }
  ```
  ```css
  /* graph.css */
  .gp-link { min-height: 44px; padding-block: 10px; }
  ```
  (Both already sit inside elements with room to grow — `th` padding-block and `.gp-list li` padding — so this only changes the hit area, not the row rhythm much.)

### 4. Graph's own phone media query shrinks the zoom buttons below their already-sub-44px desktop size

- **File:** `src/components/graph/graph.css:607-627` (the `@media (max-width: 47.99rem)` block) vs. `graph.css:241-247` (desktop)
- **Measured:** `.graph-toolbar .gem-btn.icon` (the zoom +/- buttons) is `42×42` on a phone (confirmed via `boundingBox()`); on desktop the same rule is `46×46` (`graph.css:244-247`, itself already under the 48×48 the base `.gem-btn.icon` gets everywhere else, `styles.css:432-437`). `.graph-toolbar .gem-btn.fit` is `42×42` on both (`min-height: 42px` from `graph.css:241-243`, unchanged by the phone query) — so it was never 44px either. The segmented-control round items go from `38px` tall on desktop (`graph.css:238`) to `36px` on phone (`graph.css:592-593`). These are the pinch-zoom-adjacent controls people tap most on a touch device, and the one breakpoint written specifically for phones makes the zoom buttons *smaller* still, not larger.
- **Fix:** keep these at 44px minimum on phone; drop the padding/font-size instead of the hit box:
  ```css
  @media (max-width: 47.99rem) {
    .graph-toolbar .gem-btn.fit,
    .graph-toolbar .gem-btn.icon {
      width: 44px;
      min-height: 44px;
    }
    .graph-toolbar .seg [data-slot='segmented-control-item'] {
      min-height: 40px; /* was 36px */
    }
  }
  ```

---

## Polish

### 5. No scroll-edge affordance on any of the three horizontally-scrolling strips

- **Files:** `src/styles.css:882-888` (`.rounds`), `src/components/graph/graph.css:231-236` (`.graph-toolbar .seg`), plus the table from #1
- All three use `overflow-x: auto` with `scrollbar-width: none` or `thin` (invisible on iOS Safari either way), so there is no hint that content continues off-screen besides a word being cut mid-glyph. Confirmed visually in `/tmp/v2-portrait-graph.png` (toolbar's "Round 3" pill sliced) and `/tmp/v2-landscape-index-full.png`.
- **Fix:** one reusable fade, applied to all three:
  ```css
  .rounds,
  .graph-toolbar .seg,
  .table-wrap {
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
            mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
  }
  ```

### 6. Search-clear and the graph panel's close button sit a little under 44px

- **Files:** `src/styles.css:1046-1059` (`.search [data-slot='input-clear']`, 30×30), `src/components/graph/graph.css:407-409` (`.gp-close.gem-btn.icon`, 42×42)
- Lower priority than #3/#4 because both sit next to generously-sized siblings (the 44px-tall search input, the 44px menu button), but still below the HIG minimum and easy to fat-finger-miss, especially the "×" clear button which is the only way to clear the search field without deleting characters one at a time.
- **Fix:** bump `.search [data-slot='input-clear']` to `36×36` minimum (it has room inside the 44px input) and `.gp-close.gem-btn.icon` to `44×44` to match every other `.icon` button.

### 7. Graph node-label collisions at some zoom levels (not phone-specific, but worse on the smaller canvas)

- **File:** `src/components/graph/layout.ts` (`labelOffsets`) / observed in `/tmp/v2-landscape-graph.png`
- At the default auto-fit zoom on a phone-sized canvas, sibling node labels overlap illegibly (e.g. "ser" + "First line of README…." + "Tool-call activity fe…" stacked on top of each other). `labelOffsets` already tries to stagger labels vertically when nodes are close, but doesn't account for horizontal label width, so on the narrower phone canvas (more nodes compressed into less width) labels still collide. Not something introduced by the phone breakpoint, just more visible there because there's less room. Noting for completeness; not a quick CSS fix since it's a layout algorithm issue.

