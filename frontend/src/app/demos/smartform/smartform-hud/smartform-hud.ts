import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { OcrStatus } from '../ocr.service';

/**
 * On-screen HUD for the smart-form demo — deliberately visible, it is part of
 * the talk. Shows the machinery: OCR latency, the backend (Tesseract is always
 * WebAssembly), the engine status, the model/languages, and whether the
 * optional on-device Prompt API is assisting.
 *
 * Purely presentational: every value arrives via signal inputs, so it stays
 * OnPush and re-renders only when the parent pushes new state.
 */
@Component({
  selector: 'app-smartform-hud',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hud" role="status" aria-live="polite">
      <div class="stat">
        <span class="label">ocr</span>
        <span class="value">{{ ocrMs() | number: '1.0-0' }}<small>ms</small></span>
      </div>
      <div class="stat">
        <span class="label">backend</span>
        <span class="badge badge--wasm">{{ backend() }}</span>
      </div>
      <div class="stat">
        <span class="label">engine</span>
        <span class="badge" [class]="'badge--' + statusKind()">{{ status() }}</span>
      </div>
      <div class="stat">
        <span class="label">assist</span>
        <span class="badge" [class.badge--gpu]="promptApi()" [class.badge--muted]="!promptApi()">
          {{ promptApi() ? 'Prompt API' : 'heuristic' }}
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
    .badge--gpu,
    .badge--ready {
      background: rgba(34, 211, 238, 0.18);
      color: #22d3ee;
      border: 1px solid rgba(34, 211, 238, 0.6);
    }
    /* Amber: WebAssembly / still working. */
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
    .badge--muted {
      background: rgba(107, 127, 149, 0.14);
      color: #8fa1b5;
      border: 1px solid rgba(107, 127, 149, 0.4);
    }
  `,
})
export class SmartformHud {
  readonly ocrMs = input.required<number>();
  readonly backend = input.required<'wasm'>();
  readonly status = input.required<OcrStatus>();
  readonly modelName = input.required<string>();
  readonly promptApi = input.required<boolean>();

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
