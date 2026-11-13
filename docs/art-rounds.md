# Art rounds: a look task on a fixed budget

How to run a task that improves the look over several rounds: the improvement
rounds in `docs/look-brief.md` (Process), or a model pass against its
references in `docs/3d-pipeline.md`. It keeps the useful parts of the Cook Loop
(github.com/Leonxlnx/cook) and leaves out the parts that spend a whole usage
window. The bar, the fixed views and the measured checks stay where they are;
this file is the procedure and the ledger that ties them together.

## 1. The brief: one message, before round 1

Ask every open question in one message, each with its default, so the user can
answer by number or reply "defaults". Skip what the task already answers.

| # | Question | Default |
|---|---|---|
| 1 | What is the target: which views, which model or pieces? | From the task |
| 2 | Which references set the bar? | The style reference and close-up in `docs/look-brief.md`; for a model, its construction references in `docs/art.md` |
| 3 | How many rounds? | 3 (the user's cap) |
| 4 | Time cap? | 2 h of wall clock. No minimum |
| 5 | Builder subagents? | At most 2 at once, each owning named files |
| 6 | Paid generation? | None. Each run still needs its own yes (`docs/art.md`) |

Then write the ledger (below) and start. After the brief, decide small things
yourself and log them under Decisions. Stop and ask only for:

- a paid generation run;
- a change to files another session owns;
- a long render: a full-sample Blender bake, a high-sample preview set, or
  anything you estimate at more than 10 minutes.

## 2. The ledger

One file per task: `art/rounds/<yyyy-mm-dd>-<slug>.md`, committed with the
round's work. It is your memory after a context compaction and the handoff to
another session. After a compaction, read the ledger before you act. Write
entries that a stranger could continue from.

```markdown
# Rounds: [task]

Target: [views / model]. References: [paths]. Owner files: [paths].
Caps: [3] rounds, [2 h] (started [YYYY-MM-DD HH:MM]). Builders: [≤2].
Baseline: [commit], scores [scores.json / acceptance numbers].
Best so far: round [N], commit [sha].

## Decisions
- [time] [decision], because [reason]

## User feedback
Exact words. Close an item only with a render that shows the fix.
- "[quote]" | round [N] | [open / done: path]

## Round [N]
Focus: [what], because [user feedback / judge defect / worst band]
Changed: [what, in which files]
Renders: [side-by-side paths]
Measured: [metric before -> after, the command that produced it]
Judge defects (named by ≥2 of 3): [list]
Not checked: [what, and why]
Next: [focus] | Stop: [yes, why / no]
```

## 3. A round

1. **Focus.** Open user feedback first. Then the top defect the judge named in
   the last round. Then the worst band or view in the metrics. One focus per
   round, fixed in depth, beats five touched lightly.
2. **Fix it.** Split independent parts across builders only when they touch
   different files.
3. **Render only what the fix can change**, at the fixed views:
   `matchshot.mjs`, `compare_reference.py --fast --views ...`,
   `ingame_shots.cjs --only ...`. Use `--fast` until the last round.
4. **Measure.** IoU and `lines_f` / `trim_f` from `scores.json`, the
   acceptance checks in `docs/rendering.md`. Mind the traps in
   `docs/3d-pipeline.md` (helm height rescales the body views; a helper's band
   score is not the shipped score).
5. **Judge** with fresh context (next section).
6. **Log** the round in the ledger and commit it with the work.
7. **Show the user** the side-by-side with a three-line note: what changed,
   measured before and after, next focus. Do not wait for a reply.
8. **Stop check** (section 6). If it fails, start the next round.

If a round makes a measured score worse, fix it or return to the best commit
before you go on, and log why.

## 4. The judge

The judge is a new subagent with no history. It gets only the side-by-side
images and the rubric. It does not get the code, the ledger, the brief, your
opinion or earlier scores, and it is not told who made the work. On Claude
Code, use the Agent tool with `model: "sonnet"`: judging images does not need
the largest model.

Run it three times in parallel. Act on the defects that at least two of the
three runs name. Do not decide anything from its numbers: a 1-10 rating
varies by ±1 between identical runs (`docs/3d-pipeline.md`, Judging the art).

Prompt:

```text
You are a strict art director seeing this work for the first time.
Each image shows a painted reference on the left and a game render on the right.
The bar: a frozen frame of the right side passes for a page of the painted art.
For each image, name the 3 biggest differences that stop it passing:
where (region or piece), what is wrong, what to change.
Look at: silhouette and proportion, light and shade (warm lit planes, cool
blue shade), colour, how each material is painted, atmosphere and haze, and
detail where the eye lands.
These always fail: low-poly facets, bands that follow triangle edges, default
plastic-looking materials, plain fog, untextured boxes, blobby rocks, cel
shading or outlines.
End with the single weakest thing across all images.
```

## 5. The user's word wins

- User feedback beats the judge and the metrics. Log the exact words and
  handle them first next round.
- If the user's estimate and the judge disagree, report the user's. Never
  report a judged number as progress; report measured numbers and the defects
  that were closed.

## 6. Stop

Stop when any of these is true:

- the round cap or the time cap is reached (finish the round and log it
  first);
- one more round would not show on screen at the fixed views;
- the judge names no defect twice and the user has no open feedback.

Then write the final summary from `docs/look-brief.md` (before/after
side-by-sides, the three weakest things left, cost, known flaws) and ship it
the way `AGENTS.md` says.

## What we left out of the Cook Loop, and why

| Cook does | We do instead | Why |
|---|---|---|
| A time floor ("at least 8 h; done after 2 h means something is wrong") | A cap, no floor | A floor exists to spend time; we pay for the time |
| Pace usage to about 99% of every 5 h window | Round and time caps | Other sessions share the plan |
| Never ask after intake | Ask only for paid runs, other lanes, long renders | The user is usually reachable |
| Critics give a 0-100 similarity score, median decides | Three judge runs, act on repeated defects | Judged numbers are not repeatable here |
| A 99.9% stretch bar | The look-brief bar plus measured scores | Our metrics give a real number to move |
| Zero external assets, slop ban list, video shipping | `docs/art.md` and `docs/look-brief.md` rules | Already covered, or not our deliverable |
