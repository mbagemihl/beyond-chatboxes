import { Injectable, signal } from '@angular/core';
import { Doc, ScoredDoc, docText, rankBySimilarity } from './search-core';
import { EmbeddingBackend, WorkerRequest, WorkerResponse } from './embedding-protocol';

/** Lifecycle surfaced to the UI. `indexing` = model up, embedding the corpus. */
export type IndexStatus = 'idle' | 'loading' | 'indexing' | 'ready' | 'error';

/** How many docs to embed per worker round-trip (keeps progress smooth). */
const EMBED_CHUNK = 8;
/** How many results to return from a semantic query. */
const TOP_K = 8;

/** Resolved value of one embed round-trip. */
interface EmbedResult {
  readonly vectors: number[][];
  readonly ms: number;
}

/**
 * Owns the embedding {@link Worker} and the in-memory vector index.
 *
 * Responsibilities:
 *   - spin up the worker and drive it through model load -> corpus embedding,
 *     exposing progress (embedded / total) and the chosen backend as signals;
 *   - keep the doc vectors in memory (aligned 1:1 with the docs);
 *   - answer `search(query)` by embedding the query in the worker and ranking
 *     with the pure {@link rankBySimilarity} (cosine similarity).
 *
 * Root-scoped and NOT torn down on component destroy: revisiting the demo route
 * reuses the warm index, so the second on-stage run is instant.
 */
@Injectable({ providedIn: 'root' })
export class EmbeddingIndexService {
  private readonly statusSignal = signal<IndexStatus>('idle');
  private readonly errorSignal = signal<string | null>(null);
  private readonly backendSignal = signal<EmbeddingBackend | null>(null);
  private readonly modelNameSignal = signal<string | null>(null);
  private readonly progressSignal = signal<{ embedded: number; total: number }>({
    embedded: 0,
    total: 0,
  });
  private readonly lastQueryMsSignal = signal(0);

  /** 'idle' | 'loading' | 'indexing' | 'ready' | 'error'. */
  readonly status = this.statusSignal.asReadonly();
  /** Human-readable error when status is 'error'. */
  readonly error = this.errorSignal.asReadonly();
  /** Active accelerator once the model is loaded, else null. */
  readonly backend = this.backendSignal.asReadonly();
  /** Model display name for the HUD (includes dtype), or null before ready. */
  readonly modelName = this.modelNameSignal.asReadonly();
  /** Corpus embedding progress. */
  readonly progress = this.progressSignal.asReadonly();
  /** Embedding time (ms) of the most recent query — the headline HUD stat. */
  readonly lastQueryMs = this.lastQueryMsSignal.asReadonly();

  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (r: EmbedResult) => void; reject: (e: Error) => void }
  >();

  private docs: readonly Doc[] = [];
  private docVectors: number[][] = [];

  /**
   * Create the worker and begin loading + indexing. Idempotent: a second call
   * (e.g. re-navigating to the route) is a no-op and keeps the warm index.
   * Browser-only — a no-op if Web Workers are unavailable (SSR / prerender).
   */
  init(docs: readonly Doc[]): void {
    if (this.worker || typeof Worker === 'undefined') {
      return;
    }
    this.docs = docs;
    this.statusSignal.set('loading');
    this.errorSignal.set(null);
    this.progressSignal.set({ embedded: 0, total: docs.length });

    const worker = new Worker(new URL('./embedding.worker', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data);
    worker.onerror = (event) => {
      this.fail(`The embedding worker failed to start: ${event.message || 'unknown error'}`);
    };
    this.worker = worker;
    this.send({ type: 'init' });
  }

  /**
   * Embed `query` in the worker and return the top matching documents by cosine
   * similarity, high score first. Returns `[]` until the index is ready or if
   * the query is blank.
   */
  async search(query: string): Promise<ScoredDoc[]> {
    if (this.statusSignal() !== 'ready' || query.trim().length === 0) {
      return [];
    }
    const { vectors, ms } = await this.embedBatch([query]);
    this.lastQueryMsSignal.set(ms);
    return rankBySimilarity(vectors[0], this.docs, this.docVectors, TOP_K);
  }

  // --- worker plumbing ------------------------------------------------------

  private onMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'ready':
        this.backendSignal.set(msg.backend);
        this.modelNameSignal.set(msg.modelName);
        void this.indexCorpus();
        break;
      case 'init-error':
        this.fail(msg.error);
        break;
      case 'embedded': {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          entry.resolve({ vectors: msg.vectors, ms: msg.ms });
        }
        break;
      }
      case 'embed-error': {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          entry.reject(new Error(msg.error));
        }
        break;
      }
    }
  }

  /** Embed the whole corpus in chunks, updating progress after each chunk. */
  private async indexCorpus(): Promise<void> {
    this.statusSignal.set('indexing');
    const texts = this.docs.map(docText);
    const vectors: number[][] = [];
    try {
      for (let i = 0; i < texts.length; i += EMBED_CHUNK) {
        const batch = texts.slice(i, i + EMBED_CHUNK);
        const { vectors: v } = await this.embedBatch(batch);
        vectors.push(...v);
        this.progressSignal.set({
          embedded: vectors.length,
          total: texts.length,
        });
      }
      this.docVectors = vectors;
      this.statusSignal.set('ready');
    } catch (err) {
      this.fail(`Failed to embed the document corpus: ${this.messageOf(err)}`);
    }
  }

  private embedBatch(texts: readonly string[]): Promise<EmbedResult> {
    const worker = this.worker;
    if (!worker) {
      return Promise.reject(new Error('Worker not initialized.'));
    }
    const id = this.nextId++;
    return new Promise<EmbedResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: 'embed', id, texts });
    });
  }

  private send(request: WorkerRequest): void {
    this.worker?.postMessage(request);
  }

  private fail(message: string): void {
    this.errorSignal.set(message);
    this.statusSignal.set('error');
    for (const { reject } of this.pending.values()) {
      reject(new Error(message));
    }
    this.pending.clear();
  }

  private messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
