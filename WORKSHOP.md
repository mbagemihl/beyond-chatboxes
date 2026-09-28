# WORKSHOP.md — Running models on the edge (3 hours)

A hands-on workshop: attendees run real ML models **entirely in the browser**,
with nothing leaving the machine. The Angular app is pre-scaffolded — every
exercise is about the AI stack itself: setting up a browser ML runtime, getting
meaning out of a model's output, and combining an OCR model with an on-device
LLM. [STACK.md](STACK.md) introduces every technology used; the presenter
tours it before Block 1.

**Focus.** Local/edge inference. Not Angular. Components, templates and styling
are already written; attendees fill in clearly marked seams in pure TypeScript
modules that have tests waiting for them.

**Format.** Three exercise blocks, each with a *core* goal everyone finishes and
a *stretch* goal so the fast people never idle. The server-side comparison is a
presenter-led finale, not an exercise — it needs a JDK and would cost half the
room twenty minutes.

---

## Before anyone writes code

```bash
make doctor
```

Nobody proceeds until this prints **READY**. It checks Node, dependencies, every
model and wasm artifact (including *truncated* downloads, the classic room
failure), the fixture files, and whether port 4200 is free. Each failure comes
with the exact command that fixes it.

**Distribution matters more than anything else in this document.** A cold start
needs roughly **1 GB** per attendee — ~281 MB of models and wasm, ~755 MB of
`node_modules`. Thirty people fetching that over conference wifi is how you lose
the first hour. Hand out a USB stick or a shared drive with `frontend/node_modules/`
and `frontend/public/` pre-seeded, so step zero is *copy a folder*, not *npm install*.

Assume nothing about the network during the workshop. Every exercise runs offline
by design — that is the whole point of the topic.

---

## Timetable

| Time | Block | What happens |
|---|---|---|
| 0:00–0:15 | **Setup gate** | Copy the pre-seeded folder, `make doctor`, everybody green |
| 0:15–0:35 | **Why local + the stack** | Presenter runs the finished demos, then tours [STACK.md](STACK.md) |
| 0:35–1:10 | **Block 1 — Your first model with LiteRT.js** | Runtime, model, accelerator fallback, tensors |
| 1:10–1:20 | Break | |
| 1:20–2:00 | **Block 2 — Meaning without a server** | Token vectors → sentence embeddings |
| 2:00–2:40 | **Block 3 — Reading a document on-device** | OCR layout + confidence, LLM refinement |
| 2:40–2:55 | **Finale — Local vs cloud** | Presenter-led benchmark, latency injection |
| 2:55–3:00 | Close | When to choose local, and when not to |

Three hours is genuinely tight. If a block runs long, cut its stretch goal, not
the setup gate and not the finale — the finale is where the argument lands.

---

## Why local + the stack (20 min, presenter-led)

Run the finished demos first (the "why"): pose, search, the receipt scan with
its **0 bytes uploaded** counter. Then walk through [STACK.md](STACK.md), the
"how". The one picture to leave on screen: *model file → runtime library →
WebGPU or wasm*, with each demo mapped onto it. Show the five LiteRT.js calls
on screen, since Block 1 starts right after.

---

## Block 1 — Your first model with LiteRT.js (35 min)

```bash
make step-1
```

Route: `/pose?fixture=1`. Model: MoveNet SinglePose Lightning, float16 tflite,
via LiteRT.js.

The lesson: running a model in the browser is a short, fixed lifecycle, and
every step has a failure mode you must handle on stage: start the runtime from
your own origin, fetch the model, compile it for the best accelerator (WebGPU,
falling back to wasm), push a tensor through it, and free the memory. The pose
maths (letterboxing, decoding the output, joint angles) is already written.

**Core** — implement in `frontend/src/app/demos/pose/litert-setup.ts`, in order:

1. `startRuntime` — `loadLiteRt('/wasm/litert/')`, reusing a runtime that is
   already loading
2. `fetchModelBytes` — download the `.tflite`; a 404 must say "run
   download-models.sh", not show a blank screen
3. `acceleratorsToTry` + `compileOnBestAccelerator` — `loadAndCompile` on
   WebGPU, fall back to wasm, free a model that compiled but failed warmup
4. `runModel` — `new Tensor`, `model.run`, `await output.data()`, then
   `delete()` every tensor, even when `run` throws

The page guides you: until a step is implemented, the pose demo's error overlay
names the next TODO. Once all four work, the skeleton tracks the fixture clip
and the HUD shows the backend and a real inference time.

Grader: `litert-setup.spec.ts` runs each step against a **fake LiteRT.js**
that records every call, so it checks the library is used correctly (right
path, right accelerator order, every tensor freed) with no GPU or model file.

**Stretch**: `readInputSpec` (ask the model for its input shape and dtype
instead of hard-coding 192×192) and `warmup` (run one grey frame and reject
NaN or all-zero output, because a broken GPU path rarely throws).

**Talking points**: why tensors need manual `delete()` (native wasm/GPU
memory, and a 30 fps loop); why `output.data()` is async (GPU readback — time
it, or the HUD lies); why a backend that compiles can still not work; f16
weights (half the download, no visible accuracy loss). Expect a mixed room of
`webgpu` and `wasm` badges; never assert a backend.

---

## Block 2 — Meaning without a server (40 min)

```bash
make step-2
```

Route: `/search`. Model: all-MiniLM-L6-v2 (ONNX), Transformers.js, in a Worker.

The lesson: an embedding model does not output "an embedding". It outputs one
384-dim vector **per token**, padded so the batch is rectangular, and turning
that into one vector per sentence is part of the model's contract. The worker
calls the tokenizer and model directly (no one-line `pipeline()`), so this step
is visible and belongs to the attendee. Get it wrong and nothing crashes: the
rankings just quietly get worse. That is what model-integration bugs look like.

**Warm-up (5 min)** — `similarity.ts` → `cosineSimilarity`.

**Core** — implement in `pooling.ts`:

- `meanPool` — average the token vectors using the attention mask, so padding
  never counts. The mask arrives as a `BigInt64Array`, just as the tokenizer
  produces it.
- `l2Normalize` — unit length, so documents compete on direction, not length

Grader: besides hand-built cases, `pooling.spec.ts` replays a **recorded real
forward pass** (`pooling.fixture.json`) and requires the output to match
Transformers.js' own `pooling: 'mean', normalize: true`. It also proves the mask
matters: pooling the padding too moves the short sentence's vector measurably.

Checkpoint: a query with no shared words with its best match still ranks it
first — compare against the keyword baseline already in the UI.

**Stretch**: `embeddingCandidates` — choose the (backend, weights) order: WebGPU
with fp32, wasm with q8. Then reopen the HUD and explain which one your laptop
picked.

**Talking points**: quantization as a deployment decision, not a detail — fp32 on
WebGPU (int8 only partially delegates to the GPU) and q8 on wasm, a 4× size
difference for a small quality cost. Pooling as part of the model's contract:
all-MiniLM was trained with mean pooling; CLS pooling would run fine and rank
worse. Expect a mixed room: some laptops report `webgpu`, most report `wasm`.
Never write an exercise that asserts a backend.

---

## Block 3 — Reading a document on-device (40 min)

```bash
make step-3
```

Route: `/smartform?fixture=1`. Engine: Tesseract.js (wasm) in a Worker, plus
the optional on-device language model (Chrome Prompt API).

The lesson: `data.text` is the least useful thing the OCR model gives you. It
also reports **where** every word sits and **how sure** it was about each one.
On real receipts, Tesseract often splits a two-column layout into separate text
blocks, so "Total" and "11,00" end up lines apart. And flat text looks equally
certain everywhere: the bundled scan reads "1x" as `lx` at 51% confidence, and
nothing in the text tells you that. The privacy argument stays on screen: the
**0 bytes uploaded** counter next to a scanned document.

The string heuristics (`parseMoney`, `isValidIban`, date and vendor rules) are
given. They are ordinary business logic, not what this block is about.

**Core** — implement in `ocr-layout.ts`:

- `sameRow` — do two bounding boxes sit on one visual line?
- `wordsRightOf` — the words right of a label, in reading order
- `findLabeledAmount` — find the total from the layout: skip "Subtotal", skip a
  header label with nothing beside it, and prefer the lowest label on the page
- `calibrate` — combine the heuristic's confidence with the OCR model's
  per-word confidence; the weakest word decides

Grader: hand-built boxes for each rule, plus **real Tesseract output** for the
bundled receipt (`ocr-layout.fixture.json`).

Checkpoint: scan the bundled receipt. The amount badge goes from `medium`
(found by text alone, with no label beside it) to `high` (paired with its
label). Every field carries a calibrated badge, and the counter still reads zero.

**Stretch — working with the on-device LLM**, in `prompt-api.ts`:

- `buildPromptInput` — fence the OCR text off as data (a receipt can say
  "ignore previous instructions"), then list the words the OCR model doubted
  so the language model knows which characters to question
- `parsePromptJson` — validate the reply against the zod `PromptReplySchema`.
  The same schema, converted to JSON Schema, is passed as `responseConstraint`
  to constrain the model's decoding
- `mergeFields` — the trust policy: never override a `high` value, re-validate
  every model value (an IBAN still has to pass mod-97), tag model values `medium`

All three are pure functions with specs, so they work on any laptop. Seeing the
LLM run live needs Chrome with Gemini Nano downloaded (several GB), so treat it
as a presenter demo, not a room requirement.

**Talking points**: two models cooperating, with the small specialised one
first and the general one refining. Model uncertainty as an input, not a log
line. Why a wrong IBAN is worse than an empty one. An LLM reply is untrusted
input and gets validated like any other.

---

## Finale — Local vs cloud (15 min, presenter-led)

Route: `/benchmark`. The same MoveNet architecture races in the browser against
Spring Boot + DJL/ONNX Runtime on the presenter's machine.

Race once, then raise injected WAN latency to 150 ms and race again. The local
bar does not move; the cloud bar's network segment grows until it dominates. Land
the point: the model was never the slow part.

Close with the decision framework — local wins on privacy, latency, offline and
per-inference cost; the server still wins on model size, shared state, and
anything you must not ship to a client.

---

## Checkpoint mechanics

Four commands are all an attendee needs:

```bash
make doctor      # am I set up?          (run once, before anything)
make step-1      # start a block         (also -2, -3)
make verify-1    # am I done?            (also -2, -3)
make solve-1     # show me the answer    (also -2, -3)
```

- **`make step-N`** checks out the `step-N-start` tag on a fresh
  `workshop-step-N` branch and prints which files to edit.
- **`make verify-N`** runs *only* that block's specs — 24, 23 and 37 tests. This
  is the oracle: the exercise is done when its tests pass, so attendees unblock
  themselves instead of queueing at the front.
- **`make solve-N`** restores the reference implementation from `main`.

**Nothing can lose an attendee's work**, which matters more than elegance when
thirty people are switching checkpoints at once:

- uncommitted changes are committed onto a `workshop-wip-<stamp>` branch, and
  the branch name is printed;
- an existing `workshop-step-N` branch is *renamed*, never reset, so its commits
  stay reachable;
- `solve-N` copies your attempt into `.workshop-backups/<stamp>/` (gitignored)
  before overwriting it.

Each exercise is a function body removed with its spec left in place, so the
grader already exists. What each checkpoint leaves failing:

| Tag | Files | Failing at the start |
|---|---|---|
| `step-1-start` | `litert-setup.ts` | 19 of 24 (5 of them stretch) |
| `step-2-start` | `pooling.ts`, `similarity.ts` | 13 of 23 (1 of them stretch) |
| `step-3-start` | `ocr-layout.ts`, `prompt-api.ts` | 22 of 37 (9 of them stretch) |

Only the current block is stubbed — the rest of the app is the finished
reference, so attendees always see their piece working *in context* and a broken
unrelated route never generates support questions.

**Maintaining the checkpoints.** The tags are commits branching off the tooling
commit on `main`; `main` itself always holds the complete solution. If you change
one of the five exercise modules on `main`, re-cut the affected tag: check out
the tag, replay your change, `git tag -f step-N-start`, and force-push the tag.
Three tags is little enough to maintain by hand; freeze the content a week
before the workshop and re-run the checks below.

Two graders replay recorded model output instead of hand-made numbers. If you
change the model, its weights or the bundled receipt, regenerate them from
`frontend/` and commit the JSON:

```bash
node scripts/generate-pooling-fixture.mjs   # search/pooling.fixture.json
node scripts/generate-ocr-fixture.mjs       # smartform/ocr-layout.fixture.json
```

**Verifying the checkpoints still work** (do this after any re-cut):

```bash
git checkout step-N-start
npx tsc -p frontend/tsconfig.app.json --noEmit   # must be clean: stubs type-check
make verify-N                                    # must FAIL: the exercise is real
make solve-N && make verify-N                    # must PASS: the answer is right
```

---

## Facilitator notes

- **Fixture mode is the default.** Thirty webcams in a dim room is a worse bet
  than one on stage. `?fixture=1` runs both camera demos on bundled media, which
  also makes assertions reproducible. Let people switch to a live camera once
  their code works.
- **Mixed backends are normal.** WebGPU availability varies wildly across
  laptops. The wasm fallback is a feature; say so early or you will answer the
  same question fifteen times.
- **Don't debug individual laptops.** Point at `make doctor`. If it says READY
  and the demo still fails, that is a real bug worth everyone's attention.
- **Port conflicts are common** — VM and container proxies love `:8080` and
  `:4200`. `make doctor` catches both and prints the alternate-port command.
- **Pin Node.** There is no `engines` field in `package.json` and this repo was
  developed on an odd-numbered release. Tell attendees "Node 22 or 24" before
  they discover the EBADENGINE warning independently.
- **A shrink is available if bandwidth is the binding constraint.** Most of the
  281 MB is engine variants no single browser loads: the runtimes are handed a
  directory and choose one build at load time. Keeping one variant each, plus
  q8-only embeddings and English-only OCR, is roughly **56 MB** — a 5× cut.
  Confirm the keep-list by watching network requests per demo before deleting
  anything, and note that dropping the fp32 weights needs the worker's dtype
  candidate list to tolerate an absent file rather than fail on it.
