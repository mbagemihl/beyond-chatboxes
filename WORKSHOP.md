# WORKSHOP.md — Beyond the chatbox: ML in the browser (3 hours)

A hands-on lab that follows the abstract. Attendees start on familiar ground, a
Spring Boot + Kotlin service running pose estimation on the JVM with DJL, and
measure it. Then they move the same model into the browser with LiteRT.js: one
still image first, then a live camera with a real-time skeleton. Finally they
race their browser against their own backend and produce the latency table that
says when AI belongs on-device, in the cloud, or nowhere at all.

**Focus: the stack, not maths.** Attendees write runtime setup, tensors, canvas
drawing, the frame loop and HTTP timing. The pre- and post-processing maths
(letterboxing, decoding the output tensor, joint angles, statistics) is given
code in both languages: `MoveNet.kt` on the server, `pose-math.ts` in the
browser. The only calculations attendees write are one-liners they see on
screen immediately: keypoint × canvas size, a confidence threshold, and
"round trip − model time".

**The backend is prepared, not written.** It runs from a prebuilt jar (no
Gradle), and a ten-minute guided tour ([docs/backend-tour.md](docs/backend-tour.md))
maps each DJL call to the LiteRT.js call attendees write in Act 2. That keeps
the Kotlin visible without spending the first hour on a JVM toolchain.

[STACK.md](STACK.md) introduces every technology used; the presenter tours it at
the start.

---

## Before anyone writes code

```bash
make doctor
```

Nobody proceeds until this prints **READY**. It checks:
- Node and the npm dependencies;
- every model and wasm artifact, including *truncated* downloads (the classic
  room failure);
- the fixtures;
- **Java 21+, the prebuilt backend jar and the server ONNX model**;
- that ports 4200 and the backend port are free.

Each failure comes with the exact command that fixes it.

**Distribution matters more than anything else in this document.** A cold start
downloads about **350 MB** per attendee (npm ~212 MB compressed, models ~134
MB), plus the **169 MB backend jar**, plus a JDK 21 if they don't have one.
Thirty people fetching that over conference wifi is how you lose the first hour.

Hand out a USB stick or shared drive with:
- `frontend/node_modules/` and `frontend/public/` pre-seeded (models, wasm,
  fixtures);
- `backend/dist/backend.jar`, built with `make backend-jar`;
- JDK 21 installers for macOS / Windows / Linux.

Step zero is then *copy a folder*, not *npm install*. Put "install a JDK 21 and
Node 22 or 24" in the pre-lab email.

Assume nothing about the network during the workshop: every act runs offline.

---

## Timetable

| Time | Act | What happens |
|---|---|---|
| 0:00–0:15 | **Setup gate** | Copy the USB folder, `make doctor`, everybody green |
| 0:15–0:25 | **Why local + the stack** | Presenter: the finished demos (incl. 2 min of search/OCR: "what else runs on-device"), then [STACK.md](STACK.md) |
| 0:25–0:55 | **Act 1 — The model on the JVM** | `make backend`, code tour, `make measure-backend`, write the numbers down |
| 0:55–1:35 | **Act 2a — Into the browser: one still image** | `make step-1`: port DJL → LiteRT.js |
| 1:35–1:45 | Break | |
| 1:45–2:20 | **Act 2b — Live camera, real-time skeleton** | `make step-2`: canvas drawing + frame loop |
| 2:20–2:50 | **Act 3 — Race your own backend** | `make step-3`: latency breakdown, races at 0 / 50 / 150 ms |
| 2:50–3:00 | Close | On-device, cloud, or nowhere at all |

Three hours is tight. If an act runs long, cut its stretch goal, never Act 3:
the race is where the argument lands.

---

## Act 1 — The model on the JVM (30 min)

Two terminals, both left running for the rest of the lab:

```bash
make backend          # terminal 1: Spring Boot + DJL on :8080
make dev-frontend     # terminal 2: the Angular app on :4200, /api proxied to :8080
```

(If `make doctor` reported :8080 as taken, add `BACKEND_PORT=9099` to both.)

**Presenter-led tour (10 min)** of [docs/backend-tour.md](docs/backend-tour.md):
- `Criteria` + `optEngine("OnnxRuntime")`;
- the `@PostConstruct` warmup;
- the `synchronized` predictor;
- the translator's `UINT8 [1, 192, 192, 3]` tensor and the `[y, x, score]`
  decode.

End on the mapping table at the bottom of the tour: it is the plan for Act 2.

**Attendees measure it:**

```bash
make measure-backend
```

It sends the workshop still (`frontend/public/fixtures/pose-still.jpg`) 20 times
and prints the median / p95 **round trip** and **server model time**. Write both
on the results card. On a laptop the model takes ~6 ms and the round trip ~30 ms,
even on localhost. Ask the room where the other 24 ms went.

**Stretch**: `curl -F frame=@frontend/public/fixtures/pose-still.jpg
localhost:8080/api/infer/pose`. Read the JSON: 17 named keypoints, normalized
coordinates, and `inferenceMs`.

---

## Act 2a — Into the browser: one still image (40 min)

```bash
make step-1
```

Route: `/pose/still`. Model: the same MoveNet, as a float16 `.tflite`, run by
LiteRT.js.

The lesson: moving the model is a short, fixed lifecycle, and every step has a
DJL counterpart attendees saw running ten minutes ago.

**Core** — implement in `frontend/src/app/demos/pose/litert-setup.ts`, in order.
Each TODO names its DJL twin:

1. `startRuntime` — `loadLiteRt('/wasm/litert/')` (DJL: ONNX Runtime loading
   its natives)
2. `fetchModelBytes` — download the model; a 404 must say "run
   download-models.sh" (DJL: `optModelPath`)
3. `acceleratorsToTry` + `compileOnBestAccelerator` — `loadAndCompile` on
   WebGPU, fall back to wasm (DJL: `Criteria…loadModel()`, but the browser gets
   to choose its accelerator)
4. `runModel` — `new Tensor`, `model.run`, `await output.data()`, then
   `delete()` every tensor (DJL: `processInput`, `predict`, `processOutput`)

The page guides you: until a step is implemented, the error overlay names the
next TODO.

Checkpoint: the skeleton appears on the still, and the HUD shows the backend and
a real inference time. Then press **Compare with backend**. The same file goes to
the Act 1 service, its skeleton is drawn in amber under the browser's cyan, and
the page prints the largest difference. Same architecture, two runtimes,
answers a few pixels apart.

Grader: `litert-setup.spec.ts` runs each step against a **fake LiteRT.js** that
records every call (path, accelerator order, freed tensors). No GPU needed.

**Stretch**: `readInputSpec` (ask the model for its input shape instead of
hard-coding 192×192) and `warmup` (run one grey frame, reject NaN or all-zero
output: a backend that compiles is not a backend that works).

**Talking points**:
- why tensors need a manual `delete()` (the JVM's NDManager scope has no
  equivalent here);
- why `output.data()` is async (GPU readback, so time it or the HUD lies);
- the server needed uint8 input and this model needs int32 (each model file
  says so);
- why the two tiers differ by a few pixels at all (different resamplers in the
  letterbox).

---

## Act 2b — Live camera, real-time skeleton (35 min)

```bash
make step-2
```

Route: `/pose?fixture=1` (the bundled squat clip; switch to `/pose` for your
webcam once it works).

The lesson: real-time means decoupling drawing from inference, and doing neither
through the UI framework. The page repaints at 60 fps while the model runs as
fast as it can, never more than one inference at a time.

**Core** — implement in `frontend/src/app/demos/pose/live-loop.ts`:

- `drawSkeleton` — canvas 2D: a line per bone and a dot per keypoint. The model
  gives normalized coordinates, so a keypoint lands at `(x * width, y *
  height)`, and anything below the confidence threshold is skipped.
- `createFrameLoop` — every frame: schedule the next, draw the latest result,
  start an inference only if none is in flight; `stop()` cancels and drops late
  results.

Checkpoint: the skeleton tracks the squat clip and the fps counter moves.

Grader: `live-loop.spec.ts`, with a recording fake canvas and a manual
`requestAnimationFrame` clock.

**Stretch**: `createStatsThrottle` — the HUD's fps and average ms, published at
~2 Hz instead of 60, so the numbers are readable and the UI isn't re-rendered
every frame.

**Talking points**:
- why the loop runs outside Angular change detection (`runOutsideAngular`, see
  `pose.ts`);
- why one in-flight inference beats a queue (latency, not throughput);
- the WebGPU vs wasm badge, and what fps each laptop in the room gets.

---

## Act 3 — Race your own backend (30 min)

```bash
make step-3
```

Route: `/benchmark?fixture=1`. One frame from the clip goes 20× through LiteRT.js
in the browser and 20× through **your own** Act 1 backend, interleaved.

**Core** — implement in `frontend/src/app/benchmark/race-summary.ts`:

- `networkShare` — the part of the round trip that is not the model: `round
  trip − model time`, never below 0. One subtraction, and it *is* the lesson;
- `summarizeRace` — the local and backend summaries, using the given `median` /
  `p95`;
- `resultsRow` — the race as a row for the table below. The page shows it with
  a Copy button.

Then race three times, at **+0**, **+50** and **+150 ms** injected WAN latency
(the dropdown sets the backend's delay), and fill in the table:

| injected WAN | local backend | local median | local p95 | cloud median | cloud p95 | server model | network share |
|---|---|---|---|---|---|---|---|
| +0 ms | | | | | | | |
| +50 ms | | | | | | | |
| +150 ms | | | | | | | |

The local bar never moves; the backend's network share grows until it dominates.
On localhost at +0 the backend may even keep up. That's the point: the model was
never the slow part, the distance is.

Grader: `race-summary.spec.ts`.

**Stretch**: race the presenter's backend over the real Wi-Fi. Start the frontend
with `BACKEND_URL=http://<presenter-ip>:8080 make dev-frontend` and add that row
to the table. (Latency injection is per backend process, so on a shared backend
the presenter controls the dropdown.)

**Close (10 min): on-device, cloud, or nowhere at all.**

| On-device wins | The server still wins | Nowhere |
|---|---|---|
| privacy (the data never leaves) | big models (beyond a few hundred MB) | when a rule or a lookup would do |
| latency (no network in the loop) | shared state across users | when being wrong costs more than being slow |
| cost (the user's hardware pays) | anything you must not ship to a client | when nobody asked for it |
| offline | one known, consistent backend | |

---

## Bonus tracks (for the fast, and for after the lab)

Not on the timetable. Same mechanics (`make bonus-…`, `make verify-bonus-…`,
`make solve-bonus-…`), same "the page names the next step" guidance.

### Bonus: search — Meaning without a server (about 40 min)

```bash
make bonus-search
```

Route: `/search`. Model: all-MiniLM-L6-v2 (ONNX), Transformers.js, in a Worker.

The lesson: Act 2a's lifecycle again, one level up. Transformers.js wraps
ONNX Runtime Web and adds what language models need: a tokenizer, weight
variants (fp32 / q8), and hub-style model loading that you point at your own
server. Embeddings turn text into geometry; 384 floats per document is enough
to beat keyword search, with no index server anywhere. The model lives in a Web
Worker because a 20 MB model compiling on the main thread freezes the UI.

**Core** — implement in `frontend/src/app/demos/search/embedding-setup.ts`, in order:

1. `configureOffline` — forbid the Hugging Face Hub, serve models from
   `/models/` and ONNX Runtime from `/wasm/ort/`
2. `embeddingCandidates` — WebGPU with fp32 first, wasm with q8 as the fallback
3. `loadEmbedder` — `AutoTokenizer` once, then `AutoModel` per candidate; keep
   the first that survives a warmup embedding
4. `embedTexts` — tokenize (padding + truncation), run the model, and pass
   `last_hidden_state` + `attention_mask` to the given `sentenceEmbeddings`

The page guides you: until a step works, the search demo shows the next TODO
where the results would be.

Grader: `embedding-setup.spec.ts` runs each step against a **fake
Transformers.js** that records every call. One test replays a real recorded
forward pass and requires your `embedTexts` to reproduce Transformers.js' own
embeddings.

Checkpoint: a query with no shared words with its best match still ranks it
first — compare against the keyword baseline already in the UI.

**Stretch**: `hasUsableWebGPU` — `navigator.gpu` existing is not enough; ask for
an adapter. Then look at the HUD and explain which backend and dtype your
laptop picked.

**Talking points**: quantization as a deployment decision, not a detail (fp32 on
WebGPU because int8 only partially delegates to the GPU, q8 on wasm, a 4× size
difference); the tokenizer is part of the model; one vector per token, and why
pooling with the mask is part of the model's contract (the given
`pooling.ts`); why the one-line `pipeline()` hides exactly what you just wrote.
Expect a mixed room of `webgpu` and `wasm`. Never write an exercise that
asserts a backend.

### Bonus: OCR — Reading a document on-device (about 40 min)

```bash
make bonus-ocr
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

## Checkpoint mechanics

Five commands are all an attendee needs:

```bash
make doctor      # am I set up?          (run once, before anything)
make backend     # Act 1 onwards         (keep it running)
make step-1      # start an act          (also -2, -3; bonus: make bonus-search, bonus-ocr)
make verify-1    # am I done?            (also -2, -3, -bonus-search, -bonus-ocr)
make solve-1     # show me the answer    (same names as verify)
```

- **`make step-N`** checks out the checkpoint's tag on a fresh branch and
  prints the files to edit and the page to watch.
- **`make verify-N`** runs *only* that checkpoint's specs. This is the oracle:
  the exercise is done when its tests pass, so attendees unblock themselves
  instead of queueing at the front.
- **`make solve-N`** restores the reference implementation from `origin/main`.

**Nothing can lose an attendee's work**, which matters more than elegance when
thirty people are switching checkpoints at once:

- uncommitted changes are committed onto a `workshop-wip-<stamp>` branch, and
  the branch name is printed;
- an existing checkpoint branch is *renamed*, never reset, so its commits stay
  reachable;
- `solve` copies your attempt into `.workshop-backups/<stamp>/` (gitignored)
  before overwriting it.

Each exercise is a function body removed with its spec left in place, so the
grader already exists. What each checkpoint leaves failing:

| Tag | Files | Failing at the start |
|---|---|---|
| `step-1-start` | `pose/litert-setup.ts` | 19 of 24 (5 of them stretch) |
| `step-2-start` | `pose/live-loop.ts` | 13 of 16 (2 of them stretch) |
| `step-3-start` | `benchmark/race-summary.ts` | 7 of 8 |
| `bonus-search-start` | `search/embedding-setup.ts` | 13 of 18 (1 of them stretch) |
| `bonus-ocr-start` | `smartform/ocr-layout.ts`, `prompt-api.ts` | 22 of 37 (9 of them stretch) |

Only the current checkpoint is stubbed; the rest of the app is the finished
reference. So attendees always see their piece working *in context*, and a
broken unrelated route never generates support questions.

**Maintaining the checkpoints.**
- The tags are commits branching off `main`, and `main` always holds the
  complete solution.
- If you change an exercise module on `main`, re-cut the affected tag: check
  out the tag, replay your change, `git tag -f <tag>`, and force-push the tag.
- Freeze the content a week before the workshop and re-run the checks below.

Three graders and one fixture are recorded from real model output instead of
hand-made numbers. If you change a model, its weights or a fixture, regenerate
them from `frontend/` and commit the result:

```bash
node scripts/generate-still-fixture.mjs     # public/fixtures/pose-still.jpg (Acts 1, 2a)
node scripts/generate-pooling-fixture.mjs   # search/pooling.fixture.json
node scripts/generate-ocr-fixture.mjs       # smartform/ocr-layout.fixture.json
```

The server ONNX model is published once as a release asset (see the comment in
`scripts/download-models.sh`), so attendees never run the TensorFlow conversion.

**Verifying the checkpoints still work** (do this after any re-cut):

```bash
git checkout <tag>
npx tsc -p frontend/tsconfig.app.json --noEmit   # must be clean: stubs type-check
make verify-N                                    # must FAIL: the exercise is real
make solve-N && make verify-N                    # must PASS: the answer is right
```

---

## Facilitator notes

- **Fixture mode is the default.** Thirty webcams in a dim room is a worse bet
  than one on stage. `?fixture=1` runs the camera acts on the bundled clip,
  which also makes the race reproducible. Let people switch to a live camera
  once their code works.
- **Mixed backends are normal.** WebGPU availability varies wildly across
  laptops. The wasm fallback is a feature; say so early or you will answer the
  same question fifteen times. The first load on a laptop whose WebGPU fails its
  warmup takes ~10 s before wasm takes over.
- **Don't debug individual laptops.** Point at `make doctor`. If it says READY
  and the act still fails, that is a real bug worth everyone's attention.
- **Port conflicts are common.** VM and container proxies love `:8080`. `make
  doctor` spots them and prints the `BACKEND_PORT=9099` fix, which must be given
  to `make backend`, `make dev-frontend` and `make measure-backend` alike.
- **No JDK, no Act 1.** Anyone who arrives without a JDK 21 can still do Acts 2
  and 3 against the presenter's backend (`BACKEND_URL=…`, see the Act 3
  stretch).
- **Pin Node.** Tell attendees "Node 22 or 24" before they discover the
  EBADENGINE warning independently.
