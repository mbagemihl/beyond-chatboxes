// generate-pooling-fixture.mjs — records one real all-MiniLM-L6-v2 forward pass
// for pooling.spec.ts: the raw per-token output, the attention mask, and what
// Transformers.js' own `pooling: 'mean', normalize: true` pipeline makes of it.
// The spec then checks that our pooling reproduces the library exactly.
//
// Run from frontend/ after scripts/download-models.sh:
//   node scripts/generate-pooling-fixture.mjs
import { writeFileSync } from 'node:fs';
import { AutoModel, AutoTokenizer, env, pipeline } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.localModelPath = new URL('../public/models/', import.meta.url).pathname;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
// Very different lengths on purpose: the short text is mostly padding.
const TEXTS = ['Sick leave', 'Who do I talk to when I feel unwell during the conference?'];
const round = (x) => Number(x.toPrecision(6));

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: 'q8' });
const inputs = tokenizer(TEXTS, { padding: true, truncation: true });
const { last_hidden_state: hidden } = await model(inputs);

const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
const expected = (await extractor(TEXTS, { pooling: 'mean', normalize: true })).tolist();

const fixture = {
  texts: TEXTS,
  dims: hidden.dims,
  mask: Array.from(inputs.attention_mask.data, Number),
  hidden: Array.from(hidden.data, round),
  expected: expected.map((v) => v.map(round)),
};
const out = new URL('../src/app/demos/search/pooling.fixture.json', import.meta.url);
writeFileSync(out, JSON.stringify(fixture) + '\n');
console.log(`wrote ${out.pathname} (dims ${hidden.dims.join('x')})`);
