# PRESENTER.md — stage runbook

Everything runs from **one process, one command, zero network**. The only
feature that touches the network at runtime is the explicit cloud-comparison
call in the Local vs Cloud demo — and that goes to the same process.

## One-time prep (on the stage machine, while still online)

```bash
scripts/download-models.sh   # fetches + sha256-verifies every model, wasm
                             # bundle and the pose fixture clip; converts the
                             # server-side ONNX model (needs python3)
make build                   # ng build → embedded in backend/build/libs/app.jar
```

## Showtime

```bash
java -jar backend/build/libs/app.jar     # JDK 21
```

Open **http://localhost:8080** — the landing page links all four demos.

If :8080 is taken on the machine (VM proxies love it), run with
`--server.port=9099` and open that port instead.

## Keyboard shortcuts (work everywhere except while typing in a field)

| Key   | Action                                    |
|-------|-------------------------------------------|
| `1`   | Pose                                      |
| `2`   | Semantic Search                           |
| `3`   | Smart Form                                |
| `4`   | Local vs Cloud benchmark                  |
| `0`   | Landing page                              |
| `F`   | Toggle fullscreen                         |

## Fixture mode — the camera fallback

If stage lighting is hopeless or camera permission fails, append
**`?fixture=1`** to run on bundled media instead of the live camera
(an amber **FIXTURE** badge shows it's active):

- `http://localhost:8080/pose?fixture=1` — loops a bundled squat clip
  (`/fixtures/pose.webm`, fetched by `download-models.sh`).
- `http://localhost:8080/smartform?fixture=1` — scans a bundled sample
  receipt (`/fixtures/receipt.svg`, ships with the repo).

## Pre-talk checklist (run through the morning of the talk)

- [ ] **Models present + checksums pass**: re-run `scripts/download-models.sh`.
      Every line must say `already present and verified, skipping` (it
      sha256-verifies each artifact; with everything present it needs no
      network). Also confirm the ONNX conversion step reports the file present.
- [ ] **Jar is fresh**: `make build` after any code change; start
      `java -jar backend/build/libs/app.jar` and watch the log for
      `Pose predictor ready: engine=OnnxRuntime … warmup=… ms` — that line
      means the cloud tier is warm.
- [ ] **Camera permission granted**: open `/pose`, accept the browser's
      camera prompt, confirm the skeleton tracks you. Permission is
      per-origin — grant it for the exact host:port you'll present on.
- [ ] **WebGPU active**: the pose HUD badge must read `webgpu`, not `wasm`.
      If it says `wasm`, check `chrome://gpu` (hardware acceleration on,
      no driver blocklist). The demo still works on wasm, just slower.
- [ ] **Fixture mode tested**: open `/pose?fixture=1` (squat clip plays,
      skeleton tracks, FIXTURE badge visible) and `/smartform?fixture=1`
      (Scan document fills date/amount/currency/IBAN/vendor/email,
      `0 bytes uploaded` stays green).
- [ ] **Benchmark dry run**: on `/benchmark`, hit Race once; both bars render
      and the WAN-latency dropdown grows the cloud bar's network segment.
- [ ] **Shortcuts + fullscreen**: press `1 2 3 4 0`, then `F` on the landing
      page. Present in fullscreen.
- [ ] **Kill competing camera apps** (Zoom, Teams, OBS) — a busy camera shows
      as "already in use by another app".
- [ ] **Screen sane**: OS dark mode, Do Not Disturb on, display scaling such
      that the landing cards are readable from the back row.

## If something breaks mid-talk

| Symptom                              | Move                                              |
|--------------------------------------|---------------------------------------------------|
| Camera denied / black stage          | Add `?fixture=1` to the URL and carry on          |
| HUD badge says `wasm`                | Say it out loud — the fallback IS the story       |
| Cloud bar says unavailable           | Local tier still races; show local-only numbers   |
| Wrong URL typed                      | Any unknown path lands back on the landing page   |
