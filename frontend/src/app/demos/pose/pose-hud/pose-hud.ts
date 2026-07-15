import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PoseBackend } from '../pose-engine.service';

/**
 * The on-screen HUD — deliberately visible, it is part of the talk. Shows the
 * machinery: frames per second, per-inference latency (a rolling average fed
 * from the parent), which accelerator is running, and the model name.
 *
 * Purely presentational: every value arrives via signal inputs, so this stays
 * OnPush and re-renders only when the parent pushes new (throttled) stats.
 */
@Component({
  selector: 'app-pose-hud',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hud" role="status" aria-live="polite">
      <div class="stat">
        <span class="label">fps</span>
        <span class="value">{{ fps() | number: '1.0-0' }}</span>
      </div>
      <div class="stat">
        <span class="label">inference</span>
        <span class="value">{{ inferenceMs() | number: '1.0-1' }}<small>ms</small></span>
      </div>
      <div class="stat">
        <span class="label">backend</span>
        <span class="badge" [class.badge--wasm]="isWasm()" [class.badge--gpu]="!isWasm()">
          {{ backend() ?? '…' }}
        </span>
      </div>
      <div class="stat model">
        <span class="label">model</span>
        <span class="value model-name">{{ modelName() }}</span>
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
    .badge--gpu {
      background: rgba(34, 211, 238, 0.18);
      color: #22d3ee;
      border: 1px solid rgba(34, 211, 238, 0.6);
    }
    /* Amber: WebGPU unavailable, running on the wasm CPU fallback. */
    .badge--wasm {
      background: rgba(245, 158, 11, 0.16);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.6);
    }
  `,
})
export class PoseHud {
  readonly fps = input.required<number>();
  readonly inferenceMs = input.required<number>();
  readonly backend = input.required<PoseBackend | null>();
  readonly modelName = input.required<string>();

  protected readonly isWasm = computed(() => this.backend() === 'wasm');
}
