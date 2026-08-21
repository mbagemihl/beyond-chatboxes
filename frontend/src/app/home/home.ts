import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DEMOS } from '../demo-registry';

/**
 * The landing page: four big cards, one per demo, readable from the back of
 * the room. Each card shows the keyboard shortcut (1–4) that also opens it
 * from anywhere in the app (see the App root's key handling).
 */
@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  protected readonly demos = DEMOS;
}
