/**
 * Unit tests for embedding-setup.ts. No browser, no GPU, no model file: fakes
 * record every call, and one test replays a real recorded all-MiniLM-L6-v2
 * forward pass (pooling.fixture.json) through the fake model.
 */
import fixture from './pooling.fixture.json';
import {
  EmbeddingCandidate,
  ModelLike,
  SetupError,
  TokenizerLike,
  TransformersApi,
  TransformersEnv,
  configureOffline,
  embedTexts,
  embeddingCandidates,
  hasUsableWebGPU,
  loadEmbedder,
} from './embedding-setup';

/** A tensor-shaped value, as Transformers.js returns them. */
function tensor(data: ArrayLike<number | bigint>, dims: number[]) {
  return { data, dims };
}

/** A tokenizer that records its calls and marks every token as real. */
function fakeTokenizer(calls: { texts: string[]; options: object }[] = []): TokenizerLike {
  return (texts, options) => {
    calls.push({ texts, options });
    return {
      attention_mask: tensor(new BigInt64Array(texts.length * 2).fill(1n), [texts.length, 2]),
    };
  };
}

/** A model returning two 3-dim token vectors per text. */
function fakeModel(inputsSeen: Record<string, unknown>[] = []): ModelLike {
  return async (inputs) => {
    inputsSeen.push(inputs);
    const mask = inputs['attention_mask'] as { dims: number[] };
    const batch = mask.dims[0];
    return { last_hidden_state: tensor(new Float32Array(batch * 2 * 3).fill(1), [batch, 2, 3]) };
  };
}

class FakeTransformers implements TransformersApi {
  tokenizerLoads: string[] = [];
  modelLoads: EmbeddingCandidate[] = [];
  tokenizerFails = false;
  /** Per device: a model to return, or an Error to throw. */
  modelResult: Partial<Record<EmbeddingCandidate['device'], ModelLike | Error>> = {};

  async loadTokenizer(modelId: string): Promise<TokenizerLike> {
    this.tokenizerLoads.push(modelId);
    if (this.tokenizerFails) {
      throw new Error('tokenizer.json: 404');
    }
    return fakeTokenizer();
  }
  async loadModel(modelId: string, options: EmbeddingCandidate): Promise<ModelLike> {
    this.modelLoads.push(options);
    const result = this.modelResult[options.device] ?? fakeModel();
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }
}

const GPU: EmbeddingCandidate = { device: 'webgpu', dtype: 'fp32' };
const CPU: EmbeddingCandidate = { device: 'wasm', dtype: 'q8' };

describe('configureOffline', () => {
  function freshEnv(): TransformersEnv {
    return {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '/hf/',
      backends: { onnx: { wasm: {} } },
    };
  }

  it('forbids the Hugging Face Hub and serves models from /models/', () => {
    const env = freshEnv();
    configureOffline(env);
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.localModelPath).toBe('/models/');
  });

  it('loads ONNX Runtime from /wasm/ort/, single-threaded, without a proxy worker', () => {
    const env = freshEnv();
    configureOffline(env);
    expect(env.backends?.onnx?.wasm).toEqual({
      wasmPaths: '/wasm/ort/',
      numThreads: 1,
      proxy: false,
    });
  });

  it('copes with an env that has no wasm backend section', () => {
    const env: TransformersEnv = {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
    };
    expect(() => configureOffline(env)).not.toThrow();
    expect(env.allowRemoteModels).toBe(false);
  });
});

describe('embeddingCandidates', () => {
  it('prefers WebGPU with fp32, and keeps wasm q8 as the fallback', () => {
    expect(embeddingCandidates(true)).toEqual([GPU, CPU]);
  });

  it('goes straight to wasm q8 without a usable GPU', () => {
    expect(embeddingCandidates(false)).toEqual([CPU]);
  });
});

describe('loadEmbedder', () => {
  it('loads the tokenizer once and the model on the first candidate', async () => {
    const api = new FakeTransformers();
    const embedder = await loadEmbedder(api, 'Xenova/all-MiniLM-L6-v2', [GPU, CPU]);
    expect(api.tokenizerLoads).toEqual(['Xenova/all-MiniLM-L6-v2']);
    expect(api.modelLoads).toEqual([GPU]);
    expect(embedder.candidate).toEqual(GPU);
  });

  it('falls back to wasm when the WebGPU model fails to load', async () => {
    const api = new FakeTransformers();
    api.modelResult.webgpu = new Error('no adapter');
    const embedder = await loadEmbedder(api, 'm', [GPU, CPU]);
    expect(embedder.candidate).toEqual(CPU);
    expect(api.modelLoads).toEqual([GPU, CPU]);
  });

  it('falls back when the WebGPU model loads but fails its warmup run', async () => {
    const api = new FakeTransformers();
    api.modelResult.webgpu = async () => {
      throw new Error('device lost');
    };
    const embedder = await loadEmbedder(api, 'm', [GPU, CPU]);
    expect(embedder.candidate).toEqual(CPU);
  });

  it('reports a missing tokenizer as a SetupError, without trying any backend', async () => {
    const api = new FakeTransformers();
    api.tokenizerFails = true;
    const err = await loadEmbedder(api, 'm', [GPU, CPU]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(api.modelLoads).toEqual([]);
  });

  it('throws a SetupError naming the last failure when no backend works', async () => {
    const api = new FakeTransformers();
    api.modelResult.webgpu = new Error('no adapter');
    api.modelResult.wasm = new Error('bad model');
    const err = await loadEmbedder(api, 'm', [GPU, CPU]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(String(err)).toContain('bad model');
  });
});

describe('embedTexts', () => {
  it('tokenizes with padding and truncation, and feeds the result to the model', async () => {
    const calls: { texts: string[]; options: object }[] = [];
    const seen: Record<string, unknown>[] = [];
    const embedder = { tokenizer: fakeTokenizer(calls), model: fakeModel(seen), candidate: CPU };
    await embedTexts(embedder, ['a', 'b']);
    expect(calls).toEqual([{ texts: ['a', 'b'], options: { padding: true, truncation: true } }]);
    expect(seen.length).toBe(1);
    expect(seen[0]['attention_mask']).toBeDefined();
  });

  it('returns one unit-length vector per text', async () => {
    const embedder = { tokenizer: fakeTokenizer(), model: fakeModel(), candidate: CPU };
    const vectors = await embedTexts(embedder, ['a', 'b', 'c']);
    expect(vectors.length).toBe(3);
    vectors.forEach((v) => expect(Math.hypot(...v)).toBeCloseTo(1, 6));
  });

  it("reproduces Transformers.js' own embeddings on a real recorded model output", async () => {
    const [batch, seq] = fixture.dims;
    const embedder = {
      tokenizer: (() => ({ attention_mask: tensor(fixture.mask, [batch, seq]) })) as TokenizerLike,
      model: (async () => ({
        last_hidden_state: tensor(fixture.hidden, fixture.dims),
      })) as ModelLike,
      candidate: CPU,
    };
    const vectors = await embedTexts(embedder, fixture.texts);
    vectors.forEach((v, i) =>
      v.forEach((x, j) => expect(x).toBeCloseTo(fixture.expected[i][j], 4)),
    );
  });

  it('throws a SetupError when the model output has no last_hidden_state', async () => {
    const embedder = {
      tokenizer: fakeTokenizer(),
      model: (async () => ({})) as ModelLike,
      candidate: CPU,
    };
    await expect(embedTexts(embedder, ['a'])).rejects.toBeInstanceOf(SetupError);
  });
});

describe('hasUsableWebGPU (stretch)', () => {
  it('is false when the browser has no navigator.gpu', async () => {
    expect(await hasUsableWebGPU({})).toBe(false);
  });

  it('is false when navigator.gpu exists but hands out no adapter (headless, VMs)', async () => {
    expect(await hasUsableWebGPU({ gpu: { requestAdapter: async () => null } })).toBe(false);
  });

  it('is false when requestAdapter throws', async () => {
    const gpu = {
      requestAdapter: async () => {
        throw new Error('blocked');
      },
    };
    expect(await hasUsableWebGPU({ gpu })).toBe(false);
  });

  it('is true with a real adapter', async () => {
    expect(await hasUsableWebGPU({ gpu: { requestAdapter: async () => ({}) } })).toBe(true);
  });
});
