# STACK.md — the on-device AI stack in this repo

Every demo here runs a real model **in the browser**, with nothing leaving the
machine. This page introduces the pieces that make that possible, what each
one is for, and the few calls you actually write. Read it before Block 1; the
presenter tours it at the start of the workshop.

---

## The picture

```
 your code (Angular service)
        │  tensors / text / images
        ▼
 ┌──────────────────────────────┐
 │ runtime library              │  LiteRT.js · Transformers.js · Tesseract.js
 │  (JavaScript API)            │
 ├──────────────────────────────┤
 │ execution backend            │  WebGPU (the GPU)  or  WebAssembly (the CPU)
 └──────────────────────────────┘
        ▲
        │  fetched once, from OUR origin
 model file  (.tflite · .onnx · .traineddata)
```

Three things are always true in this stack:

1. **A model is a file.** It is downloaded like an image and then cached. No
   server "hosts" it; the browser runs it.
2. **A runtime runs it.** Each model format has a runtime library with a small
   API: load, run, read the result.
3. **A backend executes it.** The runtime compiles the model for the GPU
   (WebGPU) when it can, and for the CPU (WebAssembly) when it cannot.

| Demo | Task | Runtime | Model | Format, size |
|---|---|---|---|---|
| `/pose` | Pose estimation | **LiteRT.js** | MoveNet Lightning | `.tflite`, 4.8 MB (fp16) |
| `/search` | Semantic search | **Transformers.js** on ONNX Runtime Web | all-MiniLM-L6-v2 | `.onnx`, 23 MB (q8) / 90 MB (fp32) |
| `/smartform` | Document reading | **Tesseract.js** | Tesseract LSTM | `.traineddata`, 5.6 MB (eng+deu) |
| `/smartform` (optional) | Field extraction | **Chrome Prompt API** | Gemini Nano | built into Chrome |

---

## WebGPU vs WebAssembly — the backend

| | WebGPU | WebAssembly (wasm) |
|---|---|---|
| Runs on | the GPU | the CPU (SIMD, sometimes threads) |
| Availability | Chrome/Edge desktop, newer Safari; often **not** in VMs or headless browsers | every modern browser |
| Speed | fastest for big models | fine for small ones (MoveNet: ~10 ms) |
| Gotcha | the browser can *have* WebGPU but no working device | slower, but it always works |

Every demo tries WebGPU first and **falls back to wasm**, and the HUD badge
says which one won. A mixed room is normal. The fallback is a feature, not a
failure.

Why "compiles" is not "works": a model can compile for WebGPU and still fail
(or return NaNs) on the first run. So every demo runs one **warmup** inference
before trusting a backend.

---

## LiteRT.js — Block 1

Google's runtime for `.tflite` models, the successor to TensorFlow Lite for
the web. Used for pose estimation. The whole lifecycle is five calls:

```ts
import { loadLiteRt, loadAndCompile, Tensor } from '@litertjs/core';

await loadLiteRt('/wasm/litert/');                  // 1. start the wasm runtime (once per page)
const model = await loadAndCompile(bytes, {          // 2. compile for an accelerator
  accelerator: 'webgpu',                             //    'webgpu' | 'wasm'
});
const input = new Tensor(pixels, [1, 192, 192, 3]);  // 3. wrap your data in a tensor
const [output] = await model.run(input);             // 4. run the model
const values = await output.data();                  //    read it back (async: may live on the GPU)
input.delete(); output.delete();                     // 5. free it — no garbage collector here
```

Things worth knowing:
- **Memory is manual.** Tensors hold native (wasm or GPU) memory. Forget
  `delete()` in a 30 fps loop and you leak 30 tensors a second.
- **The model describes itself.** `model.getInputDetails()` returns the input
  shape and dtype, so you don't have to hard-code 192×192.
- **Shape and layout are the contract.** MoveNet wants `[1, 192, 192, 3]`
  (batch, height, width, RGB) and returns `[1, 1, 17, 3]` (17 keypoints ×
  `[y, x, score]`). Pre- and post-processing are just getting data into and
  out of those shapes; in this repo that code is already written, in
  `pose-math.ts`.

In the repo: `frontend/src/app/demos/pose/litert-setup.ts` (the steps above,
which you write in Block 1) and `pose-engine.service.ts` (which runs them).

---

## Transformers.js + ONNX Runtime Web — Block 2

Hugging Face's JavaScript port of the Python `transformers` library. It runs
`.onnx` models with **ONNX Runtime Web** underneath, and brings the
tokenizers along. Used for embeddings.

```ts
import { AutoTokenizer, AutoModel, env } from '@huggingface/transformers';

env.allowRemoteModels = false;             // never fetch from the Hugging Face Hub
env.localModelPath = '/models/';           // our own origin instead

const tokenizer = await AutoTokenizer.from_pretrained('Xenova/all-MiniLM-L6-v2');
const model = await AutoModel.from_pretrained('Xenova/all-MiniLM-L6-v2', {
  device: 'webgpu',                        // or 'wasm'
  dtype: 'fp32',                           // or 'q8': 4× smaller weights
});
const inputs = tokenizer(texts, { padding: true, truncation: true });
const { last_hidden_state } = await model(inputs);   // one vector per TOKEN
```

- **The tokenizer is part of the model.** Text becomes token IDs first, and
  the model only understands the IDs it was trained with.
- **`dtype` is quantization.** `fp32` is full precision; `q8` stores weights
  as 8-bit integers: 4× smaller, faster on CPU, slightly less accurate.
- **The model outputs one vector per token**, not per sentence. Averaging them
  (skipping padding, via the `attention_mask`) and normalizing to unit length
  is part of the model's contract; that code is given, in `pooling.ts`.
- There is also a one-line `pipeline('feature-extraction', …)` that hides all
  of this. We don't use it, so you can see each step.

In the repo: `search/embedding-setup.ts` (the steps above, which you write in
Block 2), `search/embedding.worker.ts` (which runs them), `search/pooling.ts`.

---

## Tesseract.js — Block 3

The classic open-source OCR engine, compiled to WebAssembly. No WebGPU path:
it is always wasm.

```ts
import { createWorker } from 'tesseract.js';

const worker = await createWorker(['eng', 'deu'], 1, {
  workerPath: '/wasm/tesseract/worker.min.js',
  corePath: '/wasm/tesseract/',
  langPath: '/models/tesseract/',          // the .traineddata "models"
});
const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
// data.text   — the flat text
// data.blocks — paragraphs → lines → words, each with a bbox and a confidence
```

The flat text is the least useful part: the layout tree tells you **where**
each word is and **how sure** the model was about it. That is Block 3.

In the repo: `smartform/ocr.service.ts`, `smartform/ocr-layout.ts`.

---

## Chrome Prompt API — Block 3 stretch

A small LLM (Gemini Nano) built into Chrome, reached through `LanguageModel`.
It runs fully on-device, but only in Chrome with the model already downloaded
(several GB), so the demo treats it as an optional upgrade.

```ts
if ((await LanguageModel.availability()) === 'available') {
  const session = await LanguageModel.create({ initialPrompts: [{ role: 'system', content: '…' }] });
  const reply = await session.prompt(input, { responseConstraint: jsonSchema });
}
```

`responseConstraint` makes the model reply in JSON that matches a schema. You
still validate the reply (with zod), because an LLM's output is untrusted
input.

In the repo: `smartform/prompt-api.ts`.

---

## Web Workers — keeping the page responsive

JavaScript runs your UI on one thread. Compiling a 20 MB model or running OCR
there freezes the page for seconds. A **Web Worker** is a second thread with
no DOM: the model lives there, and the page talks to it with `postMessage`.

- `/search` runs Transformers.js in `embedding.worker.ts`.
- `/smartform` runs Tesseract.js in its own worker.
- `/pose` stays on the main thread: its preprocessing draws `<video>` frames
  onto a canvas there, and MoveNet is small enough (~10 ms) not to stutter the
  page. Moving it to a worker would mean shipping every frame across as an
  `ImageBitmap`.

---

## Offline by design — where every file comes from

Nothing is fetched from a CDN at runtime. Everything is served from our own
origin, so the demos work with the network cable pulled out:

| Path | What | Put there by |
|---|---|---|
| `/wasm/litert/`, `/wasm/ort/`, `/wasm/tesseract/` | runtime binaries | `npm install` (postinstall copies them out of `node_modules`) |
| `/models/pose/`, `/models/Xenova/…`, `/models/tesseract/` | model files | `scripts/download-models.sh` |
| `/fixtures/` | sample video + receipt | the repo / `download-models.sh` |

`make doctor` checks all of them (including truncated downloads) before you
start.

---

## The app shell (not the topic, but useful to know)

The Angular app is pre-built, so you won't write Angular today. What helps to
know:
- **Services own the ML** (`PoseEngine`, `EmbeddingIndexService`,
  `OcrService`); components only display state.
- **State is signals**: `backend()`, `status()`, `lastMs()`. The HUD reads
  them.
- **The pose loop runs outside change detection**: every frame is drawn
  straight to a `<canvas>`, and only the fps/ms stats reach the UI, about twice
  a second.

---

## When to run on the device, and when not to

| Local wins | The server still wins |
|---|---|
| Privacy: the data never leaves | Big models (beyond a few hundred MB) |
| Latency: no network round trip | Shared state across users |
| Cost: the user's hardware pays | Anything you must not ship to a client |
| Offline: works on a plane | Consistent hardware, one known backend |

The finale benchmark makes the latency point live: the same model locally and
on a server, with injected network delay.
