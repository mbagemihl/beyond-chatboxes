# Act 1: a tour of the pose backend

A ten-minute read of the Spring Boot + Kotlin service you start with
`lab backend`. You don't change it today. It's the map for Act 2: every
LiteRT.js step you write in the browser has a counterpart here.

All files are under `backend/src/main/kotlin/com/consid/beyondchatboxes/pose/`.

## 1. The request: `PoseController.kt`

- `POST /api/infer/pose` takes one image as a multipart part named `frame`
  (line 31), or as base64 JSON.
- `ImageIO.read` decodes the JPEG into a `BufferedImage` (line 44).
- After inference, the controller sleeps for the *injected WAN latency*
  (line 55). That is the knob you'll turn in Act 3.

Everything in this file is time the model never sees: upload, decode, HTTP.

## 2. Loading the model: `PoseInferenceService.kt`

```kotlin
val criteria = Criteria.builder()
    .setTypes(BufferedImage::class.java, FloatArray::class.java)
    .optModelPath(path)                 // the .onnx on disk
    .optTranslator(MoveNetTranslator()) // pre/post-processing, next section
    .optEngine("OnnxRuntime")           // which runtime executes the graph
    .build()
```

- **Lines 76–82:** `Criteria` describes the model; `loadModel()` and
  `newPredictor()` make it runnable.
- **`@PostConstruct` (line 55):** one warmup `predict` on a grey image
  (lines 92–94) happens at startup, so the first real request isn't slow.
  The log says `warmup=… ms`.
- **Line 124:** a single `Predictor` guarded by `synchronized`. One model
  instance serves every request, one at a time.
- **Lines 125–127:** `inferenceMs` times only `predict`. That is the
  *server model time* `lab measure` prints next to the round trip.

## 3. Tensors: `MoveNetTranslator.kt`

- **`processInput` (line 35):** letterboxes the image into 192×192 (via
  `MoveNet.letterbox`, line 37), then builds the input tensor:
  `ndManager.create(buffer, Shape(1, 192, 192, 3), DataType.UINT8)` (line 73).
  That is 1 image, 192×192 pixels, 3 colour channels, bytes 0–255.
- **`getBatchifier() = null` (line 33):** we add the batch dimension (the
  leading `1`) ourselves.
- **`processOutput` (line 77):** reads the output back as 51 floats: 17
  keypoints × `[y, x, score]`.

## 4. Decoding: `MoveNet.kt`

- **`letterbox` (line 53):** fits the frame into the square without
  distorting it, padding the rest with black.
- **`parseOutput` (line 89):** turns the 51 floats into 17 named keypoints,
  mapping them back from the padded square to the original frame. Note the
  order: `[y, x, score]`, not `[x, y, …]`.

This file is plain Kotlin, and its twin in the browser is
`frontend/src/app/demos/pose/pose-math.ts`. Both are given code: the same
maths on both tiers is exactly why their answers match in Act 2a.

## What moves to the browser in Act 2

| Here (DJL) | Browser (LiteRT.js, `litert-setup.ts`) |
|---|---|
| ONNX Runtime natives load on first use | step 1, `loadRuntime`: `loadLiteRt('/wasm/litert/')` |
| `optModelPath` reads the file | step 2, `modelBytesFrom`: the bytes of `fetch('/models/pose/…tflite')` |
| `Criteria…optEngine(...)…loadModel()` | step 4, `tryCompile`: `loadAndCompile(bytes, { accelerator })` |
| `@PostConstruct` warmup | step 5, `keepIfWarm`: run the warmup, free a model that fails it |
| `processInput`: `NDManager.create(…)` | given in `runModel`: `new Tensor(pixels, [1, 192, 192, 3])` |
| `predictor.predict` | step 6, `runTensor`: `model.run(tensor)` |
| `processOutput` | step 7, `readFirstOutput`: `await output.data()` |
| `close()` on predictor and model | step 8, `deleteAll`: `tensor.delete()` (and `model.delete()`) |

The browser has one choice the server doesn't: **which accelerator**
(WebGPU on the GPU, or wasm on the CPU). It also has one duty the JVM hides:
**freeing tensors by hand**.
