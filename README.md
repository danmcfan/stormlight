# Shattered Plains — gameplay prototype

A browser prototype of Shardbearer combat on the Shattered Plains: a duel
against a Parshendi Shardbearer and a horde mode, in a painted look that the
art pass is bringing toward the concept art.

## Play it

**https://stormlight.dannyobrien.dev**. Every push to `main` deploys automatically
(see `.github/workflows/deploy.yml`).

## Run it locally

```bash
npm install
npm run dev
```

Open the printed URL (usually http://localhost:5173) and click to take control.

| Input | Action |
|---|---|
| WASD | Move (relative to camera) · Shift to sprint · C to toggle walk |
| Left mouse | Light attack (press again to combo) |
| Right mouse | Heavy attack (hold to charge) |
| Space | Dodge (brief invulnerability) |
| E | Block (raise it just before a hit to parry) |
| Tab | Switch Windstance / Stonestance |
| Q / Middle mouse | Lock on / release · flick the mouse to switch target |
| R | Shove: knock warriors back (and off the plateau's edge) |
| N | Start a horde run / back to the duel |
| Mouse | Look · Scroll to zoom |
| ` (backquote) | Debug readout + live tuning panel |
| F | Show/hide the frame-timing graph |
| M | Mute |
| H | Hide the commands card |
| Esc | Release the mouse |

### On a phone or tablet

The game is fully playable by touch (built and tested for iPhone Safari in
landscape). Tap the title screen to begin; there is no pointer lock on touch.

| Touch | Action |
|---|---|
| Left thumb, anywhere on the left | Floating joystick: small push walks, full push runs, push past the ring to sprint |
| Right thumb, drag on empty screen | Look · pinch with two fingers to zoom |
| **Strike** (big button) | Light attack (tap again to combo) |
| **Heavy** | Heavy attack (hold to charge) |
| **Dodge** | Dodge (brief invulnerability) |
| **Block** | Block while held · raise it just before a hit to parry |
| **Lock** | Tap to lock on / release · swipe across it to switch target |
| **Stance** | Switch Windstance / Stonestance |
| **Shove** | Knock warriors back (and off the plateau's edge) |
| Top-right icons | Pause · frame timing · debug & tuning panel · mute |

Move, look and a button all work at the same time. Touch look sensitivity and
the joystick size are in the tuning panel under **Touch**.

**Add to Home Screen (iPhone):** open the site in Safari, tap **Share →
Add to Home Screen**. Launched from the icon it runs full screen with no
browser bars, edge to edge under the Dynamic Island. Turn the phone sideways
to play; a hint appears in portrait. If there is no sound, check the ring/silent
switch: iOS mutes web audio in silent mode.

A Parshendi Shardbearer waits just past the bridge: Plate against Plate is a
long fight. Ordinary Parshendi die to a single Shardblade stroke, through any
guard (for now they are training targets). Fall into a chasm, or fall in battle, and you return to the
bridge landing.

## Horde mode

A test of whether mowing through crowds as a Shardbearer is fun. Start it with
**Face the horde** on the title screen (tap it on a phone), **N** on a
keyboard, or **Start horde** in the tuning panel's Horde folder. The duel stays
the default; **Return to the duel** (title screen) or **N** goes back.

- **Waves** of Parshendi warriors arrive on the assault plateau, over the
  bridge or climbing up out of the chasms: 4 in the first wave, 6 more each
  wave, up to 38. Between waves Stormlight restores a third of your health.
  Fall and the title screen shows the wave you reached, kills, warriors sent
  into the chasm, your longest kill streak (kills without being hit) and time.
- **Pairs.** As in the books, warriors fight in pairs: they take flanking
  spots either side of you; one steps in and feints while its partner commits
  from the side or behind. Kill one and the survivor either goes berserk or
  joins another pair.
- **Attack tokens.** Only 3 warriors may swing at once; the rest circle in
  rings, shuffle in and wait. Warriors respect the Blade: they hold just out
  of reach and strike when you are busy, recovering or turned away.
- **Aim assist** (not locked on): a swing turns toward the best warrior in the
  direction you push, within 55° and 5 m.
- **Shove** (R / Shove) barges everyone in front back a few metres and
  staggers them; near an edge, they go over.
- **Off-screen warnings:** amber chevrons at the screen edge (and a horn)
  for warriors winding up where you can't see them.
- **Kill feel scales:** rapid kills freeze less and less so a crowd never
  stutters; two kills in one swing, or the last kill of a wave, get a moment
  of slow motion. Shardblade kills burn out the eyes: two dark wisps of smoke.

Every number (wave sizes, tokens, rings, aim assist, shove, kill feel) is in
`tuning.horde` in `src/config.ts` and the tuning panel's **Horde** folder.

## Tuning feel

Every number that affects feel is in `src/config.ts`. Press ` in game to tweak
them live, then **Copy tuning JSON** and paste the values you like back into
`config.ts`.

## Plan and docs

The plan and milestones are GitHub issues: #1 (plan) and #9 (art pass). Agents
start with `AGENTS.md`. Docs are in `docs/`: the look brief, rendering, the
art pipeline and the 3D pipeline.
