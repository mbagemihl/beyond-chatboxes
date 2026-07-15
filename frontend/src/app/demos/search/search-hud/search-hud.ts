import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { EmbeddingBackend } from '../embedding-protocol';
import { IndexStatus } from '../embedding-index.service';

/**
 * The on-screen HUD for the search demo — deliberately visible, it is part of
 * the talk. Shows the machinery: query embedding latency, which accelerator the
 * worker chose, the model name, and the worker/index status (idle → loading →
 * indexing → ready).
 *
 * Purely presentational: every value arrives via signal inputs, so it stays
 * OnPush and re-renders only when the parent pushes new state.
 */
@Component({
  selector: 'app-search-hud',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hud" role="status" aria-live="polite">
      <div class="stat">
        <span class="label">embed</span>
        <span class="value">{{ queryMs() | number: '1.0-1' }}<small>ms</small></span>
      </div>
      <div class="stat">
        <span class="label">backend</span>
        <span class="badge" [class.badge--wasm]="isWasm()" [class.badge--gpu]="isGpu()">
          {{ backend() ?? '…' }}
        </span>
      </div>
      <div class="stat">
        <span class="label">worker</span>
        <span class="badge" [class]="'badge--' + statusKind()">{{ status() }}</span>
      </div>
      <div class="stat model">
        <span class="label">model</span>
        <span class="value model-name">{{ modelName() ?? 'all-MiniLM-L6-v2' }}</span>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .hud {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      align-items: center;
      padding: 0.6rem 0.9rem;
      background: rgba(11, 18, 32, 0.82);
      border: 1px solid rgba(34, 211, 238, 0.25);
      border-radius: 0.6rem;
      font-family: 'SFMono-Regular', ui-monospace, 'Menlo', monospace;
      color: #e5eef5;
      backdrop-filter: blur(4px);
    }
    .stat {
      display: flex;
      flex-direction: column;
      line-height: 1.15;
    }
    .label {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6b7f95;
    }
    .value {
      font-size: 1.1rem;
      font-variant-numeric: tabular-nums;
      color: #22d3ee;
    }
    .value small {
      font-size: 0.65rem;
      color: #6b7f95;
      margin-left: 0.1rem;
    }
    .model-name {
      font-size: 0.8rem;
      color: #e5eef5;
    }
    .badge {
      display: inline-block;
      margin-top: 0.1rem;
      padding: 0.1rem 0.5rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      width: fit-content;
    }
    .badge--gpu,
    .badge--ready {
      background: rgba(34, 211, 238, 0.18);
      color: #22d3ee;
      border: 1px solid rgba(34, 211, 238, 0.6);
    }
    /* Amber: WebGPU unavailable / still working. */
    .badge--wasm,
    .badge--busy {
      background: rgba(245, 158, 11, 0.16);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.6);
    }
    .badge--error {
      background: rgba(239, 68, 68, 0.16);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.6);
    }
  `,
})
export class SearchHud {
  readonly queryMs = input.required<number>();
  readonly backend = input.required<EmbeddingBackend | null>();
  readonly modelName = input.required<string | null>();
  readonly status = input.required<IndexStatus>();

  protected readonly isWasm = computed(() => this.backend() === 'wasm');
  protected readonly isGpu = computed(() => this.backend() === 'webgpu');

  /** Collapse the status into a badge colour bucket. */
  protected readonly statusKind = computed<'ready' | 'busy' | 'error'>(() => {
    const s = this.status();
    if (s === 'ready') {
      return 'ready';
    }
    if (s === 'error') {
      return 'error';
    }
    return 'busy';
  });
}
