import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The CC BY 3.0 credit for the bundled squat clip and the still cut from it
 * (see public/fixtures/ATTRIBUTION.md). Shown wherever that media is on
 * screen: /pose?fixture=1, /pose/still and /benchmark?fixture=1.
 */
@Component({
  selector: 'app-fixture-credit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="credit">
      Video:
      <a
        href="https://commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm"
        target="_blank"
        rel="noopener"
        >“Squat - exercise demonstration video”</a
      >
      by
      <a href="https://www.youtube.com/@FitnessScapeFitness" target="_blank" rel="noopener"
        >FitnessScape</a
      >,
      <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener"
        >CC BY 3.0</a
      >
    </p>
  `,
  styles: `
    :host {
      display: block;
    }
    .credit {
      margin: 0.5rem 0 0;
      font-size: 0.72rem;
      color: #6b7f95;
    }
    a {
      color: #9fb0c2;
    }
  `,
})
export class FixtureCredit {}
