# Concept art: how we generate it

Concept art sets the game's look. It is reference for us, never a shipped
asset. Look: **painterly and bright**. Everything is made by us.

## Rules

- **Approval gates.** Every paid run waits for an explicit yes. Propose the
  model, prompt, reference images and cost; after the run, show the image and
  its billed cost and wait before the next run.
- **Model.** Nano Banana 2.1 at 1K via OpenRouter
  (`google/gemini-nano-banana-2.1`, about $0.04). Run with
  `scripts/gen/openrouter_image.py` (`--dry-run` first). It logs every run,
  with prompt and billed cost, to `art/source/<slug>/runs.jsonl`.
- **Shape.** 16:9 for scenes and style frames; 1:1 for character and prop
  references; 16:9 for long props (a Blade laid horizontally).
- **Construction references** (for modelling) drop the painterly-finish
  sentence and ask for a plain light-grey background, flat even light with no
  cast shadows, and "from far away with a long lens so there is almost no
  perspective". Each later view of a design passes the approved earlier view
  as its design source.
- **Reference images** live in `art/references/` (see its README for credits;
  they belong to their artists). Shape-only references may be
  passed in, labelled "for shape only… copy no single one"; never pass
  references with lettering or signatures.
- **Fan and official art** inform the *words* of a prompt (shapes,
  proportions, colours). Never pass someone else's art in as an image without
  the artist's permission.

## Prompt structure

Adapted from the `danmcfan/ingardia` prompting guide (`campaign/CAMPAIGN.md`,
Image Prompt Style). One short paragraph each, in this order:

1. **Camera.** Shot size, viewpoint and height, where the subject sits in
   frame. Say "close", never "wide". No lens wording, which produces photos.
2. **Scene.** The subject and what it is doing. Describe every object that
   matters concretely (size, shape, what it is made of): the model draws
   exactly what is named.
3. **Mood.** A few words.
4. **Light and palette.** The main light source and shadows, then 4–6 colours.
5. **Materials.** Two or three surfaces the eye should feel.
6. **Finish** (until we have an approved style reference):
   `The whole image has visible brushstrokes, soft edges and simplified shapes, with colour laid in broad flat areas.`
7. **Closing line:** `Full-bleed, no borders, no black bars, no text, no signature.`

Other rules from the guide:

- Add nothing the idea doesn't need.
- Give each image **one contrast**.
- The approved style reference is `art/source/plateau-noon/nb21-v2/plateau-noon.jpg`;
  pass it as Image 1 (look only) on every run.
- Label every reference image's role.
- Use no quality claims ("masterpiece", "8K").
- **Describe what is there, not what isn't.** The model tends to ignore "no X"
  and draw the familiar X anyway (e.g. "no crossguard" still gave a
  crossguard). Name the replacement shape instead.

Once a frame is approved, pass it as **Image 1** with:
`Image 1 sets the look only: match its painted brushwork, soft painted edges and finish. Copy nothing else from it.`

## Book accuracy: what to write

Without precise wording, the model falls back on Earth look-alikes. Words that
have worked, and fixes still to test:

| Subject | Write | Avoid / known failure |
|---|---|---|
| Shattered Plains | To test: "a vast, almost flat plain broken into hundreds of flat-topped stone slabs, like dried mud cracked from above; narrow, deep chasms between tightly packed plateaus; smooth sun-bleached tops with rounded, wind-worn edges; now and then a lone rock spire" | "a vast plain of stone mesas split by sheer chasms" gave Earth canyon country (widely separated buttes, wide canyons). Without the finish sentence it reads as an American Southwest photo |
| Plains palette | Sun-bleached apricot and tan tops, rust-brown chasm walls, blue sky with puffy cloud; a highstorm as a towering dark wall of cloud on the horizon | |
| Chasmfiend | To test: a huge spiny armoured crustacean, layered shell plates bristling with spikes, many jointed legs, picking its way across cracked slabs | |
| Warcamps | Camps filling round craters at the edge of the Plains, smoke rising, the cracked plain beyond | |
| Rockbuds | "squat stone-grey shells the size of a barrel, ridged like clams, a few thin green vines trailing from their open lips" ✅ | "round shelled rockbuds with vines unfurled" gave melons with tentacles |
| Chrysalis | "a huge chrysalis three times a man's height, a hunched mound of overlapping ridged grey-brown plates" ✅ | "huge ridged grey chrysalis" gave a flat boulder |
| Bridge | Plain wooden span carried by bridge crews: no ropes, rails or posts. To test: "a long bridge about fifteen paces across, its far end resting on the plateau's rim, support beams hidden underneath" | "narrow wooden bridge" gave a rope suspension bridge; "flat span … bolted to two beams" gave a short bench with protruding legs |
| Windspren | "one thin ribbon of white light curls through the air" ✅ | |
| Crem | "dry pale crust in the cracks of the rock" | Barely visible so far |
| Shardplate | "thick and seamless: broad interlocking plates that overlap at every joint with no gaps, massive rounded pauldrons"; "fully closed, smooth and rounded helm with a single narrow horizontal slit"; "orange dust in its seams" ✅. From references, to test: a skirt of overlapping leaf-like plates at the waist (fauld); a gem set at the waist or chest; a cloak hanging from the shoulders; light leaking from the seams between plates (blue-white Stormlight) | |
| Summoned Blade | To test: "the Blade forms out of a streak of white mist, still half vapour along its length" | |
| Stormlight | "bright white-blue light streams upward like glowing steam, lit from within", plus in the light line: "glows brighter than anything else in the frame" ✅ | "faint wisps of white-blue glowing smoke" gave plain grey smoke |
| Shardblade | "where a crossguard would be, the blade itself flares out into two curved hooks that sweep back toward the grip"; "cutting edge ripples in flame-like waves, spine curving into a hooked tip"; "pommel set with a single sapphire"; "beaded with tiny drops of water"; with shape-only references (Images 2–3) ✅. Scale to test: "six times the length of the gauntlet; the grip as long as two gauntlets side by side" | v1: generic broadsword. v2: "no plain crossguard" still gave a crossguard (negation ignored). Sheet v1: right design but reads ~1 m long next to a huge gauntlet; "etched symbols" came out as runic lettering |

## Log

| Image | Result | Cost |
|---|---|---|
| `art/source/plateau-noon/nb21-v1` | Good composition; photographic; rope bridge; melon rockbuds | $0.039 |
| `art/source/plateau-noon/nb21-v2` | **Painterly and bright: the look to follow.** Rockbuds and chrysalis right; bridge too short, reads as a bench | $0.041 |
| `art/source/shardbearer-closeup/nb21-v1` | Style matches v2 (reference works). Plate convincing; Stormlight reads as grey smoke; Blade looks like a generic knight's sword | $0.039 |
| `art/source/shardbearer-closeup/nb21-v2` | Stormlight now glows ✅. Blade has wavy flared edges but still a cross-guard and leather grip; blade cropped by the frame | $0.039 |
| `art/source/shardblade-sheet/nb21-v1` | **Distinct Shardblade design** ✅: crescent hooks instead of a crossguard, flame-wave edge, hooked tip, sapphire pommel, condensation. Scale too small next to the gauntlet; glyphs read as runes | $0.043 |
| `art/source/shardblade-side/nb21-v1` | **Construction ref** ✅: horizontal side view, design kept, plain background. Etched line still reads as runes | $0.042 |
| `art/source/shardplate-front/nb21-v1` | **Construction ref** ✅: symmetric front view with fauld, chest gem, knee cops. Outlined/cel look (fine for modelling); very stocky proportions; dark under-layer shows at joints | $0.039 |
| `art/source/shardplate-side-back/nb21-v1` | **Construction ref** ✅: side and back views consistent with the front (same pauldron discs, fauld, trim). Side view slightly turned, not a pure profile; legs still short | $0.039 |
| `art/source/shardplate-helm/nb21-v1` | **Construction ref** ✅: helm front and side with gorget; visor, ridge and trim lines clear | $0.039 |
