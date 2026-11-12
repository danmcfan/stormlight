# Rendering: the painted look

The game is lit and graded to look like the approved style reference,
`art/source/plateau-noon/nb21-v2/plateau-noon.jpg`: a bright, warm, painted noon
with cool blue shade in the chasms and white-blue glowing Stormlight.

All look values are in `src/render/look.ts` (`defaultLook`) and editable live in
the tuning panel (`` ` `` → **Look**). Use **Copy look JSON** to save a tweak and
paste the values back into `defaultLook`.

## Pipeline

| Stage | File | What it does |
|---|---|---|
| Lights | `src/world/environment.ts` | Warm high-noon sun (elevation / azimuth), cool sky fill + warm ground bounce (hemisphere) |
| Sky | `src/world/environment.ts` | Procedural dome: zenith-to-horizon gradient, streaky high cloud in soft posterised bands, sun glow, dark highstorm wall low in the east, horizon fades into the terrain haze |
| Material stylizing | `src/render/stylize.ts` | Patches every `MeshStandardMaterial` / `MeshPhysicalMaterial` (GLBs included) with `onBeforeCompile`, so Blender models get the look with no extra work |
| Post | `src/render/post.ts` | HDR (half-float) composer: scene → optional Kuwahara brushstrokes → bloom → tone mapping + colour grade |
| Reflections | `src/game.ts` | PMREM of a soft grey-blue sky over warm rock (the painted sky is too saturated for steel) |

### Stylized shading (`stylize.ts`)

- **Banded light.** Sunlight runs through a soft ramp: `rampSteps` flat bands
  with `rampSoftness` edges. `rampLift` brightens the ramp so steep walls that
  face a high sun still read as sunlit.
- **Hue-shifted shade.** Surfaces facing away from the sun or in shadow shift
  hue toward `shadowColor` at the same brightness (blue, not grey); sunlit
  surfaces warm toward `highlightColor`. Metal is tinted less, as it already
  reflects the sky.
- **Rim light** (`rimColor`, `rimStrength`, `rimPower`) on silhouettes.
- **Only glows bloom.** Lit surfaces are capped at `maxLit` (below the bloom
  threshold). Strong emissives (visor, gems, the Blade's etched line) get
  `glowBoost` extra HDR. The player's blade trail and the spark / Stormlight
  mote particles are HDR too (`game.ts`).
- **Atmosphere** replaces three's fog (`scene.fog` is null): distance haze
  toward `hazeColor`, plus chasm haze that fills everything below `fogTop`,
  reaching full strength `chasmDepth` metres down. The chasm haze shifts hue to
  blue first and then fades toward `chasmColor`, so deep walls read blue rather
  than lavender. Plateau tops stay clear.

Emissive materials keep working: emissive is added after the shading and is not
hue-shifted or capped. New materials are picked up automatically (the scene is
re-scanned once a second).

### Post (`post.ts`)

- **Brushstrokes** (Kuwahara, `brushstrokes`, `brushRadius`): desktop only, off
  by default. It is not offered on touch devices.
- **Bloom** (UnrealBloomPass): `bloomStrength`, `bloomRadius`,
  `bloomThreshold`. Off on low.
- **Tone mapping**: three's Neutral. ACES pushed the sandstone oranges toward
  red and desaturated the sky.
- **Grade** (display space): `exposure`, `saturation`, `contrast`, split toning
  (`gradeShadows` cool, `gradeHighlights` warm, `gradeAmount`), `vignette`.

## Quality settings

Chosen automatically: touch devices start on **medium**, everything else on
**high**. Switch in **Look → quality**.

| | Pixel ratio cap | Shadow map | MSAA | Bloom |
|---|---|---|---|---|
| low | 1 | 1024 | off | off |
| medium | 1.5 | 1024 | off | on |
| high | 2 | 2048 | 4× | on |

Budget: 60 fps on a recent iPhone (medium) and on desktop (high). The stylized
shader adds roughly 20–30 ALU ops per pixel over MeshStandard. The post chain
on medium is the scene pass, bloom (5 mip levels) and one grade pass. Distant
plateaus use coarser cliff rows (`rowHeight: 4`) to keep vertex counts down.
Headless SwiftShader frame rates are not representative; measure on device with
the frame timing panel (F).

## Match shot

The match shot puts the camera where the style reference was painted: at the
staging plateau's rim by the bridge, at shoulder height, looking across the
chasm at the assault plateau's chrysalis. It also hides the fighters.

- In game: press **P**, or **Look → Match shot**.
- Scripted side-by-side with the painting:

  ```sh
  npx vite --port 5199 &
  node scripts/lookdev/matchshot.mjs <name> [low|medium|high]
  # A/B a value without editing code:
  LOOK='{"chasmFog":0}' node scripts/lookdev/matchshot.mjs no-chasm-fog
  ```

  This writes `art/renders/look-dev/<name>.png` and `<name>-vs-ref.jpg`
  (painting left, game right). It needs the global Playwright and ImageMagick
  from the dev container.

Judge light, colour, shading and atmosphere here. Plateau shape, textures and
props are step 2 of the art pass (#9).

Kept comparisons in `art/renders/look-dev/`:

- `00-before-vs-ref.jpg`: before the art pass
- `09-final-vs-ref.jpg`: after step 1
- `08-brushstrokes-vs-ref.jpg`: with the brushstroke filter
- `10-gameplay-desktop.png`, `11-gameplay-iphone.png`: in play
