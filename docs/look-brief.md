# Look brief

The house style for how the game looks. `docs/art.md` covers generating
concept art, `docs/3d-pipeline.md` building models, and `docs/rendering.md` the
renderer and its settings. The approach is adapted from prompts that produced
very high-quality three.js builds, turned to our subject.

## The medium

**Your medium: a hand-painted world, gouache and oil on board, like the painted
backgrounds of a classic animated film.**

- Light and colour are painted in: warm sunlit planes, cool blue-violet shade,
  soft edges, colour laid in broad flat areas.
- Brushwork shows on large surfaces (cliff faces, plateau tops, sky). Detail is
  concentrated where the eye lands: the Shardbearer, the Shardblade, the
  chrysalis, the nearest rockbuds.
- Shapes are simplified but solid: every form reads as a real, heavy object
  with a lit side, a shaded side and a shadow it casts.

Obey the rules of the medium in every pixel. **Before you write code, decide
those rules and write them down** (in your plan or commit message): how an edge
looks; how stone, crem, Shardplate, Shardblade steel, Parshendi skin and
carapace, and bridge wood are painted; where wear, dust and crem sit; how
sunlight and Stormlight sit on each surface; and how each thing moves. Then hold
every frame to them.

## The bar

> A frozen frame passes for a page of the painted concept art.

The reference pages are the approved concept images in `art/source/`, above
all the style reference `art/source/plateau-noon/nb21-v2/plateau-noon.jpg`
and the Shardbearer close-up `art/source/shardbearer-closeup/nb21-v2`. Book
accuracy (what rockbuds, chrysalises, Plate and Blades look like) is in the
book-accuracy table in `docs/art.md`.

## Painted, not default

Hold every surface to these targets:

- Rock, crem, carapace and plants have smooth, rounded, hand-shaped forms;
  facets appear only where the material really breaks (a cut plank, a cracked
  slab edge).
- Strata and colour bands run in soft, roughly level layers that follow the
  rock, at any camera distance.
- Every material is painted: lit planes, cool shade and wear are in the
  texture and the bake, and metal shows painted highlights and worn edges.
- Atmosphere is layered: haze lit from one side, dust where fighters ran, depth
  that fades into blue.
- Light comes from the bake and the medium's rules; post-processing only grades
  and lends glow.
- Glow belongs to real light sources only: Stormlight, gems, spren, visors and
  blade trails.

Guardrail: when a frame shows low-poly facets, bands that follow triangle
edges, default three.js materials, plain fog, untextured boxes, blobby rocks,
cone plants, cel shading or outlines, it fails the bar; fix it before moving on.

## Light: bake it

What does not move is lit once, offline, properly:

- Build the static world (plateaus, cliffs, props, bridges) in Blender by
  script. Bake Cycles bounce light, ambient occlusion and soft sun shadows into
  texture atlases, and show them unlit in three.js. Give more texels to what the
  player stands close to (the assault plateau, the bridge landing); distant
  plateaus can share a coarse atlas.
- The bake uses one sun and one sky for the whole map: high noon, warm sun,
  cool blue sky fill. The painted look comes from the bake (warm lit planes,
  cool bounce in the shade), not from shader tricks after the fact.
- Moving things (Shardbearers, Parshendi, effects) are lit live with an
  environment map and light probes that match the bake, so a fighter in a
  chasm's shade is in shade. Give them live soft sun shadows and contact
  shadows so they sit on the ground. Blend live and baked shadows so nothing
  has two shadows.
- Blender jobs: test at small size and few samples first; check every baked
  file after a job (a job can be cut short).

## Materials

- Paint in the textures: painterly albedo with brushwork at two scales (broad
  strokes plus finer variation) so nothing visibly repeats. Use the art pipeline
  in `docs/art.md` to generate textures and log every run.
- Add our own layers on top: crem crust in hollows and at the foot of walls,
  dust on upward faces, orange plateau dust in the seams of Plate, worn bright
  edges on metal, scuffs and cut marks on the bridge planks.
- Cut edges and corners need real geometry (rounded, eroded rims), not a flat
  texture.

## Atmosphere

- Height haze that fills the chasms with cool blue and fades the distance,
  lit by the sun from one side, not a uniform fog.
- Dust that hangs where fighters ran, light shafts where they make sense, and
  Stormlight wisps that take the light of the scene.
- The Plains read as vast: banded plateaus repeating into haze, a highstorm
  wall on the horizon, spren in the air.

## Characters

- At game distance, **silhouette and motion matter most**: a Shardbearer must
  read as huge, armoured and heavy from 20 m away; Parshendi pairs must read as
  pairs.
- Plate pieces, Blades and carapace are painted like the concept close-ups: lit
  planes of slate steel, sapphire trim, a glowing visor slit and gem, no plastic
  sheen.

## What must be excellent

When time is short, spend it here first:

1. The plateau at the bridge landing (the match-shot view): cliff strata,
   plateau top, rockbuds, chrysalis, haze.
2. The Shardbearer and Shardblade at gameplay distance and in close-up.
3. Stormlight: the visor, the gem, the light from cracks, blade trails, the
   motes of a Shardblade kill.
4. The Parshendi in pairs, moving.

## Render plan: one corner first

Decide the render plan before modelling anything. Test it on one corner of the
world first: the bridge landing with one cliff face, the plateau top, a few
rockbuds, the chrysalis, the sky, one Shardbearer and one Parshendi. Iterate
until that corner passes the bar. Only then build the rest.

## Fixed views

Every review uses the same named views so rounds compare like with like. The
game should support them by URL (`?view=<name>`) and freeze time with
`?t=<seconds>`; add them if missing:

| View | What it shows |
|---|---|
| `matchshot` | The style reference composition (also key **P**) |
| `landing` | The bridge landing from shoulder height, Shardbearer in frame |
| `duel` | The Shardbearer facing the Parshendi Shardbearer, mid-distance |
| `plate` | Close-up of the player's Plate and Blade |
| `chasm` | Looking along a chasm: haze, strata, distant plateaus |
| `horde` | A wide view of a horde wave in pairs |

## Process

1. Build a complete first version. Check it in the headless browser. Fix every
   error.
2. Run **up to 3 improvement rounds** (the user's cap for now), as described
   in `docs/art-rounds.md` (brief, ledger, judge, stop). In each round: take screenshots of at
   least three fixed views and states. Read them. Judge them as a **harsh art
   director who compares the picture with the concept art and the best painted
   games and films of this kind**. Name the three weakest things. Fix them.
   Check again. Keep a side-by-side of each round's match shot against the
   style reference.
3. Measured checks still apply where a task gives them (silhouette overlap,
   band direction, saturation, the blind judge). They support the art
   director's eye; they don't replace it.
4. Frame rate: the game must hold 60 fps on a recent iPhone and on desktop.
   If a change makes it slower, make it faster before adding anything else.
   Headless browsers here render in software, so judge cost by draw calls,
   triangles, texture memory and shader complexity, and flag anything the user
   must measure on a real phone.
5. Stop after the third round, or earlier when one more round would not show
   on screen.
6. Final summary: before/after side-by-sides, the three weakest things left,
   cost (model time and generation), and any known flaw.
