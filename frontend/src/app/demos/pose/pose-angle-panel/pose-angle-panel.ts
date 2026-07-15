import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { BodyAngles, JointAngle } from '../pose-math';

interface AngleRow {
  readonly label: string;
  readonly angle: JointAngle | null;
}

/**
 * Live joint-angle readout used on stage to analyze a bowling approach:
 * both elbows (shoulder-elbow-wrist) and both knees (hip-knee-ankle).
 *
 * Presentational + OnPush. When a joint's keypoints are not confident enough
 * the value is `null` and we render "—" rather than a misleading number.
 */
@Component({
  selector: 'app-pose-angle-panel',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel">
      <h2 class="title">Joint angles</h2>
      <ul class="rows">
        @for (row of rows(); track row.label) {
          <li class="row">
            <span class="joint">{{ row.label }}</span>
            @if (row.angle; as a) {
              <span class="deg">{{ a.degrees | number: '1.0-0' }}°</span>
              <span
                class="conf"
                [style.--conf]="a.confidence"
                [attr.title]="'confidence ' + (a.confidence | number: '1.0-2')"
              ></span>
            } @else {
              <span class="deg deg--none">—</span>
              <span class="conf conf--none"></span>
            }
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .panel {
      padding: 0.75rem 1rem;
      background: rgba(11, 18, 32, 0.82);
      border: 1px solid rgba(34, 211, 238, 0.25);
      border-radius: 0.6rem;
      color: #e5eef5;
      backdrop-filter: blur(4px);
      min-width: 15rem;
    }
    .title {
      margin: 0 0 0.6rem;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: #6b7f95;
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr auto 3.5rem;
      align-items: center;
      gap: 0.6rem;
    }
    .joint {
      font-size: 0.82rem;
      color: #cdd9e5;
    }
    .deg {
      font-family: 'SFMono-Regular', ui-monospace, 'Menlo', monospace;
      font-size: 1.05rem;
      font-variant-numeric: tabular-nums;
      color: #22d3ee;
      text-align: right;
    }
    .deg--none {
      color: #52627a;
    }
    /* Confidence meter: filled proportionally via the --conf custom property. */
    .conf {
      position: relative;
      height: 0.4rem;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.18);
      overflow: hidden;
    }
    .conf::after {
      content: '';
      position: absolute;
      inset: 0;
      width: calc(var(--conf, 0) * 100%);
      background: #22d3ee;
    }
    .conf--none::after {
      width: 0;
    }
  `,
})
export class PoseAnglePanel {
  readonly angles = input.required<BodyAngles | null>();

  protected readonly rows = computed<AngleRow[]>(() => {
    const a = this.angles();
    return [
      { label: 'Left elbow', angle: a?.leftElbow ?? null },
      { label: 'Right elbow', angle: a?.rightElbow ?? null },
      { label: 'Left knee', angle: a?.leftKnee ?? null },
      { label: 'Right knee', angle: a?.rightKnee ?? null },
    ];
  });
}
