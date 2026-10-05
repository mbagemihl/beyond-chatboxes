/**
 * Unit tests for litert-setup.ts. No browser, no GPU, no model file: a fake
 * LiteRT.js ({@link FakeLiteRt}) records every call, so each test checks that
 * a step uses the library the way the real one needs to be used.
 */
import type { TypedArray } from '@litertjs/core';
import {
  Accelerator,
  LiteRtApi,
  ModelLike,
  SetupError,
  TensorLike,
  acceleratorsToTry,
  allocInput,
  compileOnBestAccelerator,
  fetchModelBytes,
  readInputSpec,
  runModel,
  startRuntime,
  warmup,
} from './litert-setup';

class FakeTensor implements TensorLike {
  deleted = false;
  constructor(readonly values: ArrayLike<number>) {}
  async data(): Promise<ArrayLike<number>> {
    return this.values;
  }
  delete(): void {
    this.deleted = true;
  }
}

class FakeModel implements ModelLike {
  deleted = false;
  runs = 0;
  inputs: TensorLike[] = [];
  outputs: FakeTensor[] = [];
  constructor(
    private readonly output: () => ArrayLike<number>[] = () => [[0.5, 0.25, 0.9]],
    private readonly details = [{ shape: [1, 192, 192, 3], dtype: 'int32' }],
    private readonly named = false,
  ) {}
  getInputDetails() {
    return this.details;
  }
  async run(input: TensorLike): Promise<TensorLike[] | Record<string, TensorLike>> {
    this.runs++;
    this.inputs.push(input);
    const outs = this.output().map((v) => new FakeTensor(v));
    this.outputs.push(...outs);
    return this.named ? Object.fromEntries(outs.map((t, i) => [`out${i}`, t])) : outs;
  }
  delete(): void {
    this.deleted = true;
  }
}

class FakeLiteRt implements LiteRtApi {
  loads: string[] = [];
  compiles: Accelerator[] = [];
  tensors: { tensor: FakeTensor; data: TypedArray; shape: number[] }[] = [];
  global: Promise<unknown> | undefined;
  webgpu = true;
  loadFails = false;
  /** Per accelerator: a model to return, or an Error to throw. */
  compileResult: Partial<Record<Accelerator, ModelLike | Error>> = {};

  async loadLiteRt(wasmPath: string): Promise<unknown> {
    this.loads.push(wasmPath);
    if (this.loadFails) {
      throw new Error('404 litert_wasm_internal.js');
    }
    return {};
  }
  getGlobalLiteRtPromise(): Promise<unknown> | undefined {
    return this.global;
  }
  isWebGPUSupported(): boolean {
    return this.webgpu;
  }
  async loadAndCompile(
    _model: Uint8Array,
    options: { accelerator: Accelerator },
  ): Promise<ModelLike> {
    this.compiles.push(options.accelerator);
    const result = this.compileResult[options.accelerator] ?? new FakeModel();
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }
  createTensor(data: TypedArray, shape: number[]): TensorLike {
    const tensor = new FakeTensor(data);
    this.tensors.push({ tensor, data, shape });
    return tensor;
  }
}

function response(status: number, body = new Uint8Array([1, 2, 3])): Response {
  return new Response(status === 200 ? body : null, { status });
}

const BYTES = new Uint8Array([9, 9, 9]);
const alwaysWarm = async () => true;

describe('startRuntime', () => {
  it('loads the wasm runtime from our own origin', async () => {
    const api = new FakeLiteRt();
    await startRuntime(api, '/wasm/litert/');
    expect(api.loads).toEqual(['/wasm/litert/']);
  });

  it('reuses a runtime that is already loading instead of loading it twice', async () => {
    const api = new FakeLiteRt();
    api.global = Promise.resolve({});
    await startRuntime(api, '/wasm/litert/');
    expect(api.loads).toEqual([]);
  });

  it('turns a load failure into a SetupError that says where it looked', async () => {
    const api = new FakeLiteRt();
    api.loadFails = true;
    const err = await startRuntime(api, '/wasm/litert/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(String(err)).toContain('/wasm/litert/');
  });
});

describe('fetchModelBytes', () => {
  // These tests hand in their own fetchFn. An implementation that calls the
  // global fetch() instead would hit Node's real fetch, which fails with a
  // baffling "Failed to parse URL from /models/m.tflite" — so make that
  // mistake say what it is.
  beforeEach(() => {
    vi.stubGlobal('fetch', () => {
      throw new Error(
        'fetchModelBytes called the global fetch(). Use the fetchFn parameter instead, ' +
          'so the test can hand in its own response.',
      );
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns the file as bytes', async () => {
    const bytes = await fetchModelBytes('/models/m.tflite', async () => response(200));
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('says the model is missing on a 404, and how to get it', async () => {
    const err = await fetchModelBytes('/models/m.tflite', async () => response(404)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SetupError);
    expect(String(err)).toContain('404');
    expect(String(err)).toContain('download-models.sh');
  });

  it('turns a network failure into a SetupError', async () => {
    const err = await fetchModelBytes('/models/m.tflite', async () => {
      throw new TypeError('Failed to fetch');
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
  });
});

describe('acceleratorsToTry', () => {
  it('tries WebGPU first, then wasm, when the browser has WebGPU', () => {
    expect(acceleratorsToTry(new FakeLiteRt())).toEqual(['webgpu', 'wasm']);
  });

  it('goes straight to wasm without WebGPU', () => {
    const api = new FakeLiteRt();
    api.webgpu = false;
    expect(acceleratorsToTry(api)).toEqual(['wasm']);
  });
});

describe('compileOnBestAccelerator', () => {
  it('uses the first accelerator that compiles and warms up', async () => {
    const api = new FakeLiteRt();
    const ready = await compileOnBestAccelerator(api, BYTES, ['webgpu', 'wasm'], alwaysWarm);
    expect(ready.accelerator).toBe('webgpu');
    expect(api.compiles).toEqual(['webgpu']);
  });

  it('falls back to wasm when WebGPU fails to compile', async () => {
    const api = new FakeLiteRt();
    api.compileResult.webgpu = new Error('no adapter');
    const ready = await compileOnBestAccelerator(api, BYTES, ['webgpu', 'wasm'], alwaysWarm);
    expect(ready.accelerator).toBe('wasm');
    expect(api.compiles).toEqual(['webgpu', 'wasm']);
  });

  it('falls back when WebGPU compiles but fails warmup — and frees that model', async () => {
    const api = new FakeLiteRt();
    const gpuModel = new FakeModel();
    api.compileResult.webgpu = gpuModel;
    const ready = await compileOnBestAccelerator(
      api,
      BYTES,
      ['webgpu', 'wasm'],
      async (m) => m !== gpuModel,
    );
    expect(ready.accelerator).toBe('wasm');
    expect(gpuModel.deleted).toBe(true);
  });

  it('throws a SetupError when nothing works', async () => {
    const api = new FakeLiteRt();
    api.compileResult.webgpu = new Error('no adapter');
    api.compileResult.wasm = new Error('bad model');
    const err = await compileOnBestAccelerator(api, BYTES, ['webgpu', 'wasm'], alwaysWarm).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SetupError);
  });
});

describe('runModel', () => {
  it('feeds the input as a tensor of the given shape', async () => {
    const api = new FakeLiteRt();
    const pixels = new Int32Array(12);
    await runModel(api, new FakeModel(), pixels, [1, 2, 2, 3]);
    expect(api.tensors.length).toBe(1);
    expect(api.tensors[0].data).toBe(pixels);
    expect(api.tensors[0].shape).toEqual([1, 2, 2, 3]);
  });

  it('returns the first output and a timing', async () => {
    const result = await runModel(new FakeLiteRt(), new FakeModel(), new Int32Array(3), [1, 3]);
    expect(Array.from(result.output)).toEqual([0.5, 0.25, 0.9]);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('also accepts named outputs', async () => {
    const model = new FakeModel(undefined, undefined, true);
    const result = await runModel(new FakeLiteRt(), model, new Int32Array(3), [1, 3]);
    expect(Array.from(result.output)).toEqual([0.5, 0.25, 0.9]);
  });

  it('deletes the input and EVERY output tensor', async () => {
    const api = new FakeLiteRt();
    const model = new FakeModel(() => [[1], [2]]);
    await runModel(api, model, new Int32Array(3), [1, 3]);
    expect(api.tensors[0].tensor.deleted).toBe(true);
    expect(model.outputs.map((t) => t.deleted)).toEqual([true, true]);
  });

  it('still deletes the input when the model throws', async () => {
    const api = new FakeLiteRt();
    const model = new FakeModel(() => {
      throw new Error('device lost');
    });
    await expect(runModel(api, model, new Int32Array(3), [1, 3])).rejects.toThrow('device lost');
    expect(api.tensors[0].tensor.deleted).toBe(true);
  });
});

describe('readInputSpec (stretch)', () => {
  it('reads size and dtype from the model', () => {
    const model = new FakeModel(undefined, [{ shape: [1, 256, 256, 3], dtype: 'float32' }]);
    expect(readInputSpec(model, 192)).toEqual({ size: 256, dtype: 'float32' });
  });

  it('falls back when the model gives no details', () => {
    expect(readInputSpec(new FakeModel(undefined, []), 192)).toEqual({ size: 192, dtype: 'int32' });
  });

  it('allocates a buffer of the matching element type', () => {
    expect(allocInput('uint8', 4)).toBeInstanceOf(Uint8Array);
    expect(allocInput('float32', 4)).toBeInstanceOf(Float32Array);
    expect(allocInput('int32', 4).length).toBe(4);
  });
});

describe('warmup (stretch)', () => {
  const spec = { size: 2, dtype: 'int32' as const };

  it('runs one grey frame of the model input shape', async () => {
    const api = new FakeLiteRt();
    expect(await warmup(api, new FakeModel(), spec)).toBe(true);
    expect(api.tensors[0].shape).toEqual([1, 2, 2, 3]);
    expect(Array.from(api.tensors[0].data)).toEqual(new Array(12).fill(128));
  });

  it('rejects NaN output (a broken GPU path)', async () => {
    expect(await warmup(new FakeLiteRt(), new FakeModel(() => [[0.1, NaN]]), spec)).toBe(false);
  });

  it('rejects all-zero output', async () => {
    expect(await warmup(new FakeLiteRt(), new FakeModel(() => [[0, 0, 0]]), spec)).toBe(false);
  });

  it('rejects a model that throws', async () => {
    const model = new FakeModel(() => {
      throw new Error('device lost');
    });
    expect(await warmup(new FakeLiteRt(), model, spec)).toBe(false);
  });
});
