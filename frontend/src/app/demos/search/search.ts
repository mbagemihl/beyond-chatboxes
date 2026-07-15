import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { EmbeddingIndexService } from './embedding-index.service';
import { Doc, ScoredDoc, keywordSearch } from './search-core';
import { SearchHud } from './search-hud/search-hud';
import seedDocs from './seed-docs.json';

/** The seed corpus, bundled into the JS so it is available offline. */
const DOCS: readonly Doc[] = seedDocs;

/** Search-as-you-type debounce (CLAUDE spec). */
const DEBOUNCE_MS = 150;
/** Result count for the keyword baseline (semantic top-K lives in the service). */
const TOP_K = 8;

/**
 * The semantic search demo. Thin and declarative: it owns only UI state (the
 * query text and the keyword-mode toggle) and delegates all embedding work to
 * {@link EmbeddingIndexService}, which runs the model in a Web Worker.
 *
 * Search-as-you-type: the raw query signal is debounced 150 ms through a tiny
 * RxJS bridge and converted back to a signal. A single effect reacts to the
 * debounced query, the mode toggle, and the index status, then writes results —
 * guarded by a sequence token so a slow semantic response cannot overwrite a
 * newer query.
 */
@Component({
  selector: 'app-search',
  imports: [SearchHud],
  templateUrl: './search.html',
  styleUrl: './search.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search {
  private readonly index = inject(EmbeddingIndexService);

  // --- UI state -------------------------------------------------------------
  protected readonly query = signal('');
  protected readonly keywordMode = signal(false);

  /** 150 ms-debounced view of {@link query}, via an RxJS bridge. */
  private readonly debouncedQuery = toSignal(
    toObservable(this.query).pipe(debounceTime(DEBOUNCE_MS)),
    { initialValue: '' },
  );

  private readonly resultsSignal = signal<ScoredDoc[]>([]);
  protected readonly results = this.resultsSignal.asReadonly();

  /** Bumped on every query; stale async responses are dropped by comparison. */
  private seq = 0;

  // --- Re-exposed service state for the template / HUD ----------------------
  protected readonly status = this.index.status;
  protected readonly backend = this.index.backend;
  protected readonly modelName = this.index.modelName;
  protected readonly progress = this.index.progress;
  protected readonly queryMs = this.index.lastQueryMs;
  protected readonly indexError = this.index.error;

  protected readonly totalDocs = DOCS.length;

  /** A blocking message to show over the stage, or null when usable. */
  protected readonly overlayMessage = computed<string | null>(() => {
    if (this.status() === 'error') {
      return this.indexError();
    }
    return null;
  });

  /** True while the corpus is still being embedded (non-blocking banner). */
  protected readonly isPreparing = computed(
    () => this.status() === 'loading' || this.status() === 'indexing',
  );

  constructor() {
    // Kick off model load + corpus embedding once, browser-side.
    afterNextRender(() => this.index.init(DOCS));

    // The single reactive query pipeline.
    effect(() => {
      const query = this.debouncedQuery();
      const keyword = this.keywordMode();
      const status = this.status();
      const token = ++this.seq;

      if (query.trim().length === 0) {
        this.resultsSignal.set([]);
        return;
      }

      if (keyword) {
        this.resultsSignal.set(keywordSearch(query, DOCS, TOP_K));
        return;
      }

      // Semantic search needs the index; if not ready yet, clear results and
      // wait — reading `status` above re-runs this effect once it flips to
      // 'ready', re-issuing the current query.
      if (status !== 'ready') {
        this.resultsSignal.set([]);
        return;
      }
      this.index
        .search(query)
        .then((scored) => {
          if (token === this.seq) {
            this.resultsSignal.set(scored);
          }
        })
        .catch((err) => console.error('[Search] query failed', err));
    });
  }

  protected toggleKeyword(): void {
    this.keywordMode.update((v) => !v);
  }

  protected onInput(value: string): void {
    this.query.set(value);
  }

  /** Clamp a raw similarity score to [0, 1] for the result bar width. */
  protected barWidth(score: number): string {
    return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
  }
}
