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

This produces `backend/build/libs/backend-*.jar` with the Angular app baked in.
Run it:

```bash
JAVA_HOME=$HOME/.sdkman/candidates/java/21.0.2-open \
  java -jar backend/build/libs/backend-*.jar
# then open http://localhost:8080
```

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
[`scripts/download-models.sh`](scripts/download-models.sh) (a stub today; each
demo phase adds its artifacts). Run `make help` to see all available targets.
