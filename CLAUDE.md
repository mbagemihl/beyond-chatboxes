# Project: Beyond the Chatbox — Devoxx 2026 live demos

Browser-side ML demos (LiteRT.js, Transformers.js, Tesseract.js) in Angular,
with a Spring Boot/Kotlin backend that serves the app and acts as the
"cloud" comparison tier via DJL.

## Hard rules

- These are LIVE STAGE DEMOS. Reliability beats elegance. No feature may
  depend on network availability at runtime except the explicit
  "cloud comparison" benchmark call.
- Never fetch models from a CDN at runtime. All models, wasm bundles and
  worker scripts are served from our own origin (`/models/`, `/wasm/`).
  Provide a `scripts/download-models.sh` that fetches them at build time.
- Every demo must handle: camera permission denied, WebGPU unavailable
  (fall back to wasm and SHOW a badge saying so), model file missing
  (clear error, not a blank screen).
- Show the machinery on screen: every demo has a small HUD with
  inference time (ms), backend in use (webgpu/wasm), and model name.
  The HUD is part of the talk.

## Frontend conventions (Angular)

- Latest stable Angular via Angular CLI, strict TypeScript, strict
  templates (`strictTemplates: true`). No `any` — use `unknown` and narrow.
- Standalone components only, no NgModules. `ChangeDetectionStrategy.OnPush`
  everywhere; prefer the zoneless change detection scheduler if stable in
  the CLI version used — verify before committing to it.
- Signals for all component and service state (`signal`, `computed`,
  `effect`). Derive state with `computed` instead of duplicating it.
  RxJS only at true async boundaries (HttpClient, camera events); convert
  to signals at the edge with `toSignal`.
- `inject()` function style, no constructor parameter injection in
  components. Business/ML logic lives in injectable services
  (`CameraService`, `PoseEngine`, `EmbeddingIndexService`, `OcrService`)
  — components stay thin and declarative.
- Per-frame work (pose loop) never triggers change detection. Run the
  `requestAnimationFrame` loop via `NgZone.runOutsideAngular` (or rely on
  zoneless mode), draw to a canvas obtained with `viewChild`, and push only
  low-frequency stats (fps, avg ms) into signals, throttled to ~2 Hz.
- New control flow syntax (`@if`, `@for`) in templates.
- The smart form uses strictly Typed Reactive Forms.
- Validate every backend response with zod before it enters a signal.
- Angular templates escape interpolated text by default — never use
  `[innerHTML]` with untrusted content.

## Backend conventions

- Spring Boot 3.x, Kotlin, JDK 21, Gradle Kotlin DSL.
- Constructor injection, immutable `val` everywhere possible.
- Bean Validation (`jakarta.validation`) on all request DTOs.
- Integration tests use a fixed `Clock` bean.
- DJL with the ONNX Runtime engine for server-side inference. Keep the
  DJL `Predictor` warm (initialize at startup, log a warmup inference).

## Testing

- Frontend: unit tests for pure logic (angle math, cosine similarity,
  field extraction heuristics) and for services with TestBed. Use the CLI
  default test runner; if the CLI version offers the Vitest builder as
  stable, prefer it. Playwright smoke test that each demo route renders
  without console errors (mock camera with a fixture video via
  launch flags `--use-fake-device-for-media-stream`
  `--use-file-for-fake-video-capture`).
- Backend: JUnit 5 + MockMvc for the API; one integration test that runs
  a real inference on a bundled test image.
- Pure functions (joint-angle math, similarity, regex extractors) are
  written as standalone modules so they are trivially unit-testable
  without TestBed.

## What NOT to do

- No NgRx or other global state libraries — signals in services suffice.
- No CSS frameworks; plain SCSS, dark theme (#0B1220 bg, #22D3EE accent)
  to match the slide deck.
- Do not add features beyond the spec of the current phase.
```

---