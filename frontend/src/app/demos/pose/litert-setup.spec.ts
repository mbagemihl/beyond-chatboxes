/**
 * Unit tests for litert-setup.ts, one block per step, in the order you
 * implement them. No browser, no GPU, no model file: a fake LiteRT.js
 * ({@link FakeLiteRt}) records every call, so each test checks that a step uses
 * the library the way the real one needs to be used.
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
  deleteAll,
  fetchModelBytes,
  isUsableOutput,
  keepIfWarm,
  loadRuntime,
  modelBytesFrom,
  readFirstOutput,
  readInputSpec,
  runModel,
  runTensor,
  startRuntime,
  tryCompile,
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

describe('Step 1 · loadRuntime', () => {
  it('loads the wasm runtime from our own origin', async () => {
    const api = new FakeLiteRt();
    await loadRuntime(api, '/wasm/litert/');
    expect(api.loads).toEqual(['/wasm/litert/']);
  });

  it('reuses a runtime that is already loading instead of loading it twice', async () => {
    const api = new FakeLiteRt();
    api.global = Promise.resolve({});
    await loadRuntime(api, '/wasm/litert/');
    expect(api.loads).toEqual([]);
  });
});

describe('Step 2 · modelBytesFrom', () => {
  it('returns the file as bytes', async () => {
    const bytes = await modelBytesFrom(response(200), '/models/m.tflite');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('says the model is missing on a 404, and how to get it', async () => {
    const err = await modelBytesFrom(response(404), '/models/m.tflite').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(String(err)).toContain('404');
    expect(String(err)).toContain('lab download');
  });
});

describe('Step 3 · acceleratorsToTry', () => {
  it('tries WebGPU first, then wasm, when the browser has WebGPU', () => {
    expect(acceleratorsToTry(new FakeLiteRt())).toEqual(['webgpu', 'wasm']);
  });

  it('goes straight to wasm without WebGPU', () => {
    const api = new FakeLiteRt();
    api.webgpu = false;
    expect(acceleratorsToTry(api)).toEqual(['wasm']);
  });
});

describe('Step 4 · tryCompile', () => {
  it('compiles the model for the given accelerator', async () => {
    const api = new FakeLiteRt();
    const model = new FakeModel();
    api.compileResult.webgpu = model;
    expect(await tryCompile(api, BYTES, 'webgpu')).toBe(model);
    expect(api.compiles).toEqual(['webgpu']);
  });

  it('returns null (and warns) when compiling fails', async () => {
    const api = new FakeLiteRt();
    api.compileResult.webgpu = new Error('no adapter');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await tryCompile(api, BYTES, 'webgpu')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('Step 5 · keepIfWarm', () => {
  it('keeps a model that passes its warmup', async () => {
    const model = new FakeModel();
    expect(await keepIfWarm(model, alwaysWarm)).toBe(true);
    expect(model.deleted).toBe(false);
  });

  it('frees a model that fails its warmup', async () => {
    const model = new FakeModel();
    expect(await keepIfWarm(model, async () => false)).toBe(false);
    expect(model.deleted).toBe(true);
  });
});

describe('Step 6 · runTensor', () => {
  it('runs the model on the input tensor', async () => {
    const model = new FakeModel();
    const input = new FakeTensor([1]);
    const outputs = await runTensor(model, input);
    expect(model.inputs).toEqual([input]);
    expect(outputs.length).toBe(1);
  });

  it('turns named outputs into a list too', async () => {
    const model = new FakeModel(() => [[1], [2]], undefined, true);
    const outputs = await runTensor(model, new FakeTensor([1]));
    expect(outputs).toEqual(model.outputs);
  });
});

describe('Step 7 · readFirstOutput', () => {
  it("reads the first output's values", async () => {
    const values = await readFirstOutput([new FakeTensor([0.5, 0.9]), new FakeTensor([7])]);
    expect(Array.from(values)).toEqual([0.5, 0.9]);
  });

  it('fails clearly when there is no output', async () => {
    await expect(readFirstOutput([])).rejects.toBeInstanceOf(SetupError);
  });
});

describe('Step 8 · deleteAll', () => {
  it('deletes every tensor', () => {
    const tensors = [new FakeTensor([1]), new FakeTensor([2])];
    deleteAll(tensors);
    expect(tensors.map((t) => t.deleted)).toEqual([true, true]);
  });
});

describe('All steps together (given code)', () => {
  it('startRuntime explains a load failure and says where it looked', async () => {
    const api = new FakeLiteRt();
    api.loadFails = true;
    const err = await startRuntime(api, '/wasm/litert/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(String(err)).toContain('/wasm/litert/');
  });

  it('fetchModelBytes turns a network failure into a SetupError', async () => {
    const err = await fetchModelBytes('/models/m.tflite', async () => {
      throw new TypeError('Failed to fetch');
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
  });

  it('compileOnBestAccelerator falls back to wasm when WebGPU fails warmup', async () => {
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

  it('compileOnBestAccelerator throws a SetupError when nothing works', async () => {
    const api = new FakeLiteRt();
    api.compileResult.webgpu = new Error('no adapter');
    api.compileResult.wasm = new Error('bad model');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = await compileOnBestAccelerator(api, BYTES, ['webgpu', 'wasm'], alwaysWarm).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SetupError);
    vi.restoreAllMocks();
  });

  it('runModel feeds a tensor of the given shape and returns the first output', async () => {
    const api = new FakeLiteRt();
    const pixels = new Int32Array(12);
    const result = await runModel(api, new FakeModel(), pixels, [1, 2, 2, 3]);
    expect(api.tensors[0].data).toBe(pixels);
    expect(api.tensors[0].shape).toEqual([1, 2, 2, 3]);
    expect(Array.from(result.output)).toEqual([0.5, 0.25, 0.9]);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('runModel frees the input and every output, even when the model throws', async () => {
    const api = new FakeLiteRt();
    const model = new FakeModel(() => [[1], [2]]);
    await runModel(api, model, new Int32Array(3), [1, 3]);
    expect(api.tensors[0].tensor.deleted).toBe(true);
    expect(model.outputs.map((t) => t.deleted)).toEqual([true, true]);

    const failing = new FakeModel(() => {
      throw new Error('device lost');
    });
    await expect(runModel(api, failing, new Int32Array(3), [1, 3])).rejects.toThrow('device lost');
    expect(api.tensors[1].tensor.deleted).toBe(true);
  });
});

describe('Stretch 1 · readInputSpec', () => {
  it('reads size and dtype from the model', () => {
    const model = new FakeModel(undefined, [{ shape: [1, 256, 256, 3], dtype: 'float32' }]);
    expect(readInputSpec(model, 192)).toEqual({ size: 256, dtype: 'float32' });
  });

  it('falls back when the model gives no details', () => {
    expect(readInputSpec(new FakeModel(undefined, []), 192)).toEqual({ size: 192, dtype: 'int32' });
  });

  it('allocates a buffer of the matching element type (given)', () => {
    expect(allocInput('uint8', 4)).toBeInstanceOf(Uint8Array);
    expect(allocInput('float32', 4)).toBeInstanceOf(Float32Array);
    expect(allocInput('int32', 4).length).toBe(4);
  });
});

describe('Stretch 2 · isUsableOutput', () => {
  it('accepts finite values that are not all zero', () => {
    expect(isUsableOutput([0, 0.5, 0.9])).toBe(true);
  });

  it('rejects NaN or Infinity (a broken GPU path)', () => {
    expect(isUsableOutput([0.1, NaN])).toBe(false);
    expect(isUsableOutput([0.1, Infinity])).toBe(false);
  });

  it('rejects all-zero output', () => {
    expect(isUsableOutput([0, 0, 0])).toBe(false);
  });

  it('warmup runs one grey frame of the model input shape (given)', async () => {
    const api = new FakeLiteRt();
    expect(await warmup(api, new FakeModel(), { size: 2, dtype: 'int32' })).toBe(true);
    expect(api.tensors[0].shape).toEqual([1, 2, 2, 3]);
    expect(Array.from(api.tensors[0].data)).toEqual(new Array(12).fill(128));
  });
});
