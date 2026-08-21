# WORKSHOP.md — Running models on the edge (3 hours)

A hands-on workshop: attendees run real ML models **entirely in the browser**,
with nothing leaving the machine. The Angular app is pre-scaffolded — every
exercise is about the inference itself: getting pixels into a model, getting
meaning out of a tensor, and keeping the work off the UI thread.

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
| 0:15–0:25 | **Why local** | Presenter runs the finished demos. Privacy, latency, cost, offline |
| 0:25–1:10 | **Block 1 — Pixels in, keypoints out** | Pose estimation: pre/post-processing |
| 1:10–1:20 | Break | |
| 1:20–2:00 | **Block 2 — Meaning without a server** | Embeddings in a Web Worker |
| 2:00–2:40 | **Block 3 — Reading a document on-device** | OCR to structured data |
| 2:40–2:55 | **Finale — Local vs cloud** | Presenter-led benchmark, latency injection |
| 2:55–3:00 | Close | When to choose local, and when not to |

Three hours is genuinely tight. If a block runs long, cut its stretch goal, not
the setup gate and not the finale — the finale is where the argument lands.

---

## Block 1 — Pixels in, keypoints out (45 min)

Route: `/pose?fixture=1`. Model: MoveNet SinglePose Lightning, float16 tflite,
via LiteRT.js.

The lesson: a model is a function from one fixed-shape tensor to another, and
almost all the work is on either side of it. A 640×480 camera frame is not a
192×192 tensor, and the model's output is not a skeleton until you decode it.

**Core** — implement in `frontend/src/app/demos/pose/pose-math.ts`:

- `computeLetterbox` — fit the frame into the square input without distorting it
- `parseMoveNetOutput` — decode the raw output tensor into 17 scored keypoints
- `squareToSourceNorm` — map coordinates back out of letterbox space

Checkpoint: the skeleton tracks the person in the fixture clip, and the HUD shows
a real inference time.

**Stretch** — `angleABC`, `jointAngle`, `computeBodyAngles`: turn keypoints into
elbow and knee angles, so the demo says something a human cares about.

**Talking points**: why f16 rather than int8 here (coordinate precision becomes
visible jitter in joint angles); why the inference loop is decoupled from the
draw loop; why per-frame work must never touch change detection.

---

## Block 2 — Meaning without a server (40 min)

Route: `/search`. Model: all-MiniLM-L6-v2 (ONNX), Transformers.js, in a Worker.

The lesson: embeddings turn text into geometry, and 384 floats per document is
enough to beat keyword search — with no index server anywhere. Also the reason
the model lives in a Worker: a 21 MB model compiling on the main thread freezes
the UI, and attendees can *feel* the difference.

**Core**:

- `similarity.ts` → `cosineSimilarity`
- `search-core.ts` → `rankBySimilarity` (top-K over the corpus)

Checkpoint: a query with no shared words with its best match still ranks it
first — compare against the keyword baseline already in the UI.

**Stretch**: keep the query embedding warm and re-rank as you type; explain why
the sequence guard in the component prevents a slow response overwriting a newer
query.

**Talking points**: quantization as a deployment decision, not a detail — the
worker asks for `fp32` on WebGPU and `q8` on wasm, a 4× size difference for a
small quality cost. Expect a mixed room: some laptops report `webgpu`, most
report `wasm`. Never write an exercise that asserts a backend.

---

## Block 3 — Reading a document on-device (40 min)

Route: `/smartform?fixture=1`. Engine: Tesseract.js (wasm) in a Worker.

The lesson: OCR gives you a wall of noisy text; the value is in what you do with
it. And the privacy argument is visible on screen — the **0 bytes uploaded**
counter next to a scanned document is the most persuasive thing in the workshop.

**Core** — implement in `extract-fields.ts`:

- `parseMoney` — `1.234,56` and `1,234.56` are the same number in different locales
- `isValidIban` — ISO 7064 mod-97; a checksum is how you refuse to guess
- `extractAmount` — find the total without mistaking a date or an IBAN for money

Checkpoint: scanning the bundled receipt fills the form, every field carrying a
confidence badge, counter still reading zero.

**Stretch**: `extractDate` across formats, `extractVendor`, and the
non-destructive patch rule — never overwrite a field the user already edited.

**Talking points**: heuristics first, model second (the optional Chrome Prompt
API pass refines but is never required); why a wrong IBAN is worse than an empty
one.

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

**Working today:**

- **`make doctor`** — the setup gate described above.
- **`make verify-1`**, **`make verify-2`**, **`make verify-3`** — grade one
  block by running only its specs (19, 17 and 29 tests). This is the oracle:
  the exercise is done when its tests pass, so attendees unblock themselves
  instead of queueing at the front.

**Still to build:**

- **`step-N-start` / `step-N-done` tags** per block, with `main` staying the
  complete reference solution.
- **`make step-N`** — parks any local work on a `workshop-wip-<timestamp>`
  branch *and says so*, then checks out `step-N-start`. Never let an attendee
  discover git the hard way; the fallback path is the one that has to be smooth.
- **`make solve-N`** — jumps to `step-N-done` for anyone who falls behind.

Each exercise is made by removing an implementation and keeping its spec. The
repo already suits this unusually well: the interesting logic lives in pure,
framework-free modules — `pose-math.ts`, `similarity.ts`, `search-core.ts`,
`extract-fields.ts` — each with a spec beside it, 90 tests in total. Replace a
body with a signature and a `TODO`, and the exercise plus its grader already
exist.

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
