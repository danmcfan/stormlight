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
  references.
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
- Label every reference image's role.
- Use no quality claims ("masterpiece", "8K").

Once a frame is approved, pass it as **Image 1** with:
`Image 1 sets the look only: match its painted brushwork, soft painted edges and finish. Copy nothing else from it.`

## Book accuracy: what to write

Without precise wording, the model falls back on Earth look-alikes. Words that
have worked, and fixes still to test:

| Subject | Write | Avoid / known failure |
|---|---|---|
| Shattered Plains | "a vast plain of stone mesas split by sheer chasms", banded orange/tan/cream walls | Without the finish sentence it reads as an American Southwest photo |
| Rockbuds | "squat stone-grey shells the size of a barrel, ridged like clams, a few thin green vines trailing from their open lips" ✅ | "round shelled rockbuds with vines unfurled" gave melons with tentacles |
| Chrysalis | "a huge chrysalis three times a man's height, a hunched mound of overlapping ridged grey-brown plates" ✅ | "huge ridged grey chrysalis" gave a flat boulder |
| Bridge | Plain wooden span carried by bridge crews: no ropes, rails or posts. To test: "a long bridge about fifteen paces across, its far end resting on the plateau's rim, support beams hidden underneath" | "narrow wooden bridge" gave a rope suspension bridge; "flat span … bolted to two beams" gave a short bench with protruding legs |
| Windspren | "one thin ribbon of white light curls through the air" ✅ | |
| Crem | "dry pale crust in the cracks of the rock" | Barely visible so far |

## Log

| Image | Result | Cost |
|---|---|---|
| `art/source/plateau-noon/nb21-v1` | Good composition; photographic; rope bridge; melon rockbuds | $0.039 |
| `art/source/plateau-noon/nb21-v2` | **Painterly and bright: the look to follow.** Rockbuds and chrysalis right; bridge too short, reads as a bench | $0.041 |
