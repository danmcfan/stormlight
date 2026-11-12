# Shattered Plains — gameplay prototype

A browser prototype of Shardbearer combat on the Shattered Plains. Graphics are
deliberately rough: the goal is to get the *feel* right first.

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

## Tuning feel

Every number that affects feel is in `src/config.ts`. Press ` in game to tweak
them live, then **Copy tuning JSON** and paste the values you like back into
`config.ts`.

## Milestones

1. **Movement, camera, lock-on** ✅ — heavy Plate locomotion (inertia, limited
   turn rate, plant-and-pivot), over-the-shoulder camera with collision,
   Souls-style lock-on and strafing, assault plateau + bridge + chrysalis.
2. **One-on-one duel** ✅ — data-driven moves (frame data + sword keyframes
   that drive both animation and hit detection), Windstance/Stonestance
   movesets, combos with input buffering, charged heavies, dodge with
   i-frames, block/parry, stamina, poise and stagger, hit-stop, knockback,
   blade trails, synthesized sound, a Parshendi duelist AI, combat HUD.
3. Shardbearer systems: Stormlight, per-piece Plate cracking, Blade summon.
4. The battle: crowds of Parshendi, attack-token AI, allied squad.
5. Parshendi Shardbearer duel.
6. First-person mode.
7. A ten-minute plateau run, then an art pass.

## Layout

```
src/
  config.ts              all tunable numbers
  game.ts                wires everything together
  main.ts                boot + fixed 60 Hz loop with render interpolation
  core/                  input, math, Rapier physics wrapper
  player/locomotion.ts   pure movement model (unit-tested)
  combat/moves.ts        every attack: frame data + sword keyframes
  combat/fighter.ts      combat state machine (unit-tested)
  combat/bladePose.ts    sword pose at any frame; shared by animation and hits
  combat/hits.ts         swept blade-vs-capsule hit tests (unit-tested)
  combat/lockOn*.ts      target selection, reticle, switching
  entities/              physics body, Combatant (player & Parshendi), duel AI
  render/humanoid.ts     box-built rig with arm IK and procedural animation
  fx/                    blade trails, sparks, synthesized sound
  ui/hud.ts              health / stamina / stance / target bars
  ui/touchControls.ts    on-screen joystick, look drag and action buttons
  camera/                third-person camera
  world/                 plateau generation, props, lighting
tests/                   vitest unit tests (`npm test`)
```

Stack: Three.js, Rapier (physics), TypeScript, Vite, lil-gui.
