# Beyond the Chatbox — Devoxx 2026 live demos

Browser-side ML demos (LiteRT.js, Transformers.js, Tesseract.js) in Angular,
compared against a server-side "cloud" tier running on Spring Boot / Kotlin
via DJL. These are **live stage demos**: reliability beats elegance, and nothing
depends on network access at runtime except the explicit cloud-comparison call.
See [`CLAUDE.md`](CLAUDE.md) for the full engineering conventions.

## Repository layout

```
beyond-chatboxes/
├── frontend/            Angular 22 app — the browser-side ML demos live here
│   └── proxy.conf.json  dev proxy: forwards /api to the backend on :8080
├── backend/             Spring Boot 4 / Kotlin app
│                        - serves the built frontend from classpath:/static
│                        - hosts /api/* (health now; the cloud tier later)
├── scripts/
│   └── download-models.sh  build-time fetch of model/wasm artifacts (stub)
├── Makefile             dev / build / test entry points
└── CLAUDE.md            engineering conventions for the project
```

Two modules, one deployable: `make build` compiles the Angular app and embeds it
in the backend, so production is a single self-contained jar that serves both the
UI and the API from `http://localhost:8080`.

## Prerequisites

| Tool    | Version                | Notes                                                        |
|---------|------------------------|--------------------------------------------------------------|
| Node.js | 22 / 24 LTS (or 25)    | This repo was scaffolded on Node 25; Angular 22 emits an `EBADENGINE` warning on odd Node releases — harmless, builds pass. |
| JDK     | **21**                 | Backend is pinned to JDK 21. The Makefile points `JAVA_HOME` at SDKMAN's `21.0.2-open`; override with `make <target> JDK21=/path/to/jdk-21`. |
| Gradle  | via wrapper (9.5.1)    | Use `backend/gradlew`; no global Gradle needed.              |
| Angular | via `npx` (CLI 22)     | No global `@angular/cli` needed.                             |

The frontend uses **standalone bootstrap**, **zoneless** change detection,
**strict** TypeScript + **strict templates**, SCSS, and the **Vitest** unit-test
builder — all per `CLAUDE.md`.

## Development

Run the two modules in separate terminals:

```bash
make dev-backend     # Spring Boot on http://localhost:8080  (JDK 21)
make dev-frontend    # ng serve on   http://localhost:4200
```

During development you use the app at **http://localhost:4200**. Requests to
`/api/*` are transparently proxied to the backend on `:8080`
(see [`frontend/proxy.conf.json`](frontend/proxy.conf.json)), so there are no
CORS concerns and no hard-coded backend URLs in the frontend.

Quick check that the backend is up:

```bash
curl http://localhost:8080/api/health    # -> {"status":"UP"}
```

## Build

```bash
make build
```

This produces `backend/build/libs/app.jar` with the Angular app baked in
(`ng build` output is copied into the backend's `classpath:/static` and served
by Spring Boot, with SPA fallback for deep links).

## Stage setup — one command

After a one-time `scripts/download-models.sh` + `make build`:

```bash
java -jar backend/build/libs/app.jar
# then open http://localhost:8080
```

That single process serves the UI, all model/wasm artifacts, and the
`/api/*` cloud tier — no dev servers, no network dependency. (Use a JDK 21
`java`; e.g. `JAVA_HOME=$HOME/.sdkman/candidates/java/21.0.2-open` and
`$JAVA_HOME/bin/java`.) See [`PRESENTER.md`](PRESENTER.md) for the full
pre-talk checklist, keyboard shortcuts, and fixture fallback mode.

## Test

```bash
make test            # frontend (Vitest, once) + backend (JUnit)
# or individually:
make test-frontend
make test-backend
```

## Models

ML model files, wasm bundles and worker scripts are **served from our own
origin**, never a CDN at runtime. They are fetched at build time by
[`scripts/download-models.sh`](scripts/download-models.sh); each demo phase adds
its artifacts. Run `make help` to see all available targets.

The server-side pose "cloud tier" runs the **same MoveNet architecture** the
browser runs. Rather than ship a separate model, we convert our exact tflite to
ONNX once with [`scripts/convert-movenet-onnx.sh`](scripts/convert-movenet-onnx.sh)
(invoked automatically by `download-models.sh`; needs `python3`). It writes
`frontend/public/models/pose/movenet-singlepose-lightning.onnx`, which the
backend loads via the `app.pose.model-path` property (`APP_POSE_MODEL_PATH`).
Like all model artifacts, the ONNX file is **not committed** — it is produced at
build time. Without it, `POST /api/infer/pose` returns a clean `503` and the
benchmark degrades gracefully (local tier still runs; cloud shows "unavailable").

## Running the benchmark on stage

The **Local vs Cloud** benchmark (`/benchmark`) races the in-browser model
(LiteRT.js) against the server "cloud tier" (Spring Boot + DJL / ONNX Runtime)
on the *same* captured frame, and shows the latency distributions side by side.

**One-time setup** (produces the server model):

```bash
scripts/download-models.sh          # fetches the tflite + converts it to ONNX
# or just the conversion, if the tflite is already present:
scripts/convert-movenet-onnx.sh     # needs python3; writes the .onnx once
```

**On stage**, run the two modules (two terminals):

```bash
make dev-backend     # :8080 — logs "Pose predictor ready: engine=OnnxRuntime …"
make dev-frontend    # :4200 — /api proxied to :8080
```

Open **http://localhost:4200/benchmark**, then:

1. Stand in frame (the HUD badge shows the local backend: `webgpu` or `wasm`).
2. Hit **Race**. One frame is captured and run 20× locally and 20× against
   `POST /api/infer/pose`, interleaved. Responses are zod-validated before they
   touch the UI.
3. Read the two bars: **local** (cyan) vs **cloud** (coral). The cloud bar is
   split into the server-reported **inference** time and the **network share**
   (round trip − server inference). Median and p95 are shown for both.
4. Use the **WAN latency** dropdown (`0 / 50 / 150 ms`) to inject artificial
   distance server-side via `POST /api/latency-config` — the money shot is
   "same model, add 150 ms of distance" growing the cloud bar's network segment
   while local stays put.

If the backend is down or the ONNX model is missing, the local tier still races
and the cloud side shows a clear message instead of a blank screen.

Packaged jar note: the model path defaults to the repo checkout
(`../frontend/public/models/pose/...onnx`, relative to `backend/`). When running
the built jar elsewhere, point it at the file with
`APP_POSE_MODEL_PATH=/abs/path/to/movenet-singlepose-lightning.onnx`.
