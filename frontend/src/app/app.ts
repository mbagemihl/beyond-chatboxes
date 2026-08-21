import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { DEMOS } from './demo-registry';

/**
 * Root shell. Owns the stage keyboard shortcuts:
 *   1–4  jump to a demo (same order as the landing-page cards)
 *   0    back to the landing page
 *   F    toggle fullscreen
 *
 * Shortcuts are ignored while typing in a form control (the smart form!) and
 * when any modifier is held, so browser/system shortcuts keep working.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class App {
  private readonly router = inject(Router);

  protected onKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) {
      return;
    }
    if (isTypingTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'f') {
      event.preventDefault();
      void this.toggleFullscreen();
      return;
    }
    if (key === '0') {
      event.preventDefault();
      void this.router.navigateByUrl('/');
      return;
    }
    const index = Number.parseInt(key, 10) - 1;
    const demo = DEMOS[index];
    if (demo) {
      event.preventDefault();
      void this.router.navigate(['/', demo.path]);
    }
  }

  private async toggleFullscreen(): Promise<void> {
    // Fullscreen can be rejected (permissions, odd embeds); on stage that must
    // never surface as an error — it just does nothing.
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* ignore — F is a convenience, not a feature */
    }
  }
}

/** True when the key press belongs to a text-entry element. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}
