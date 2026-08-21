import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { CameraService } from '../pose/camera.service';
import { OcrService } from './ocr.service';
import { NetworkMonitorService } from './network-monitor.service';
import { SmartformHud } from './smartform-hud/smartform-hud';
import {
  Confidence,
  ExtractedFields,
  FieldKey,
  extractFields,
  isValidIban,
} from './extract-fields';
import { isPromptApiAvailable, mapFieldsWithPromptApi, mergeFields } from './prompt-api';

/** Currencies the form's <select> offers (matches the extractor's ISO codes). */
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;

/** Higher-resolution, rear-preferred capture — small receipt text needs pixels. */
const SCAN_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  facingMode: { ideal: 'environment' },
};

/** Strictly-typed reactive form model for the expense report. */
interface ExpenseForm {
  date: FormControl<string>;
  amount: FormControl<number | null>;
  currency: FormControl<string>;
  iban: FormControl<string>;
  vendor: FormControl<string>;
  email: FormControl<string>;
}

/** Reactive-forms validator: a non-empty IBAN must pass the mod-97 checksum. */
function ibanValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value?.trim();
  if (!value) {
    return null; // emptiness is `required`'s job
  }
  return isValidIban(value) ? null : { iban: true };
}

/**
 * The smart-form demo. On the left, a plain expense report built with strictly
 * Typed Reactive Forms; on the right, a live camera and a "Scan document"
 * button. Scanning grabs a frame, OCRs it entirely on-device (Tesseract.js in a
 * worker), maps the text to fields with the pure {@link extractFields}
 * heuristics (optionally refined by Chrome's on-device Prompt API), and patches
 * the form — but ONLY fields the user has not already edited, each tagged with a
 * confidence badge. "Proactive, never destructive."
 *
 * A live "0 bytes uploaded" counter proves the image never leaves the browser.
 */
@Component({
  selector: 'app-smartform',
  imports: [ReactiveFormsModule, SmartformHud],
  templateUrl: './smartform.html',
  styleUrl: './smartform.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Smartform {
  private readonly camera = inject(CameraService);
  private readonly ocr = inject(OcrService);
  private readonly network = inject(NetworkMonitorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);

  private readonly videoRef = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly captureRef = viewChild.required<ElementRef<HTMLCanvasElement>>('capture');
  /** Only rendered in fixture mode, hence optional. */
  private readonly fixtureImgRef = viewChild<ElementRef<HTMLImageElement>>('fixtureImg');

  /** `?fixture=1` — scan a bundled sample receipt instead of the live camera. */
  protected readonly fixtureMode =
    this.route.snapshot.queryParamMap.get('fixture') === '1';
  /** Set once the bundled receipt image has decoded (enables the scan button). */
  protected readonly fixtureReady = signal(false);
  /** Clear message when the bundled receipt fails to load — never a blank stage. */
  protected readonly fixtureError = signal<string | null>(null);

  protected readonly currencies = CURRENCIES;

  /** The strictly-typed expense form. */
  protected readonly form = new FormGroup<ExpenseForm>({
    date: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{4}-\d{2}-\d{2}$/)],
    }),
    amount: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    currency: new FormControl('EUR', { nonNullable: true, validators: [Validators.required] }),
    iban: new FormControl('', { nonNullable: true, validators: [ibanValidator] }),
    vendor: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
  });

  // --- Auto-fill provenance: which fields we filled and how confidently -------
  private readonly badgesSignal = signal<Partial<Record<FieldKey, Confidence>>>({});
  protected readonly badges = this.badgesSignal.asReadonly();

  /** The raw recognized text, shown in a small transcript panel for the talk. */
  protected readonly recognizedText = signal('');
  protected readonly ocrConfidence = signal(0);
  protected readonly promptApiActive = signal(false);

  // --- Re-exposed service state for the template / HUD ------------------------
  protected readonly ocrStatus = this.ocr.status;
  protected readonly ocrError = this.ocr.error;
  protected readonly ocrBackend = this.ocr.backend;
  protected readonly ocrModel = this.ocr.modelName;
  protected readonly ocrMs = this.ocr.lastMs;
  protected readonly ocrProgress = this.ocr.progress;
  protected readonly cameraStatus = this.camera.status;
  protected readonly cameraError = this.camera.error;
  protected readonly bytesUploaded = this.network.bytesUploaded;
  protected readonly requestCount = this.network.requestCount;

  protected readonly isRecognizing = computed(() => this.ocrStatus() === 'recognizing');
  protected readonly cameraReady = computed(() => this.cameraStatus() === 'granted');
  /** The scan source that must be ready: fixture image or live camera. */
  protected readonly scanReady = computed(() =>
    this.fixtureMode ? this.fixtureReady() : this.cameraReady(),
  );

  /** A blocking message to show over the camera stage, or null when usable. */
  protected readonly cameraOverlay = computed<string | null>(() => {
    if (this.fixtureMode) {
      // No camera involved — only a missing fixture or an OCR failure block.
      return this.fixtureError() ?? (this.ocrStatus() === 'error' ? this.ocrError() : null);
    }
    const cam = this.cameraStatus();
    if (cam === 'denied' || cam === 'unsupported' || cam === 'error') {
      return this.cameraError();
    }
    if (cam === 'requesting') {
      return 'Requesting camera…';
    }
    if (this.ocrStatus() === 'error') {
      return this.ocrError();
    }
    return null;
  });

  constructor() {
    afterNextRender(() => this.setup());
    this.destroyRef.onDestroy(() => this.teardown());
  }

  private setup(): void {
    // Warm the OCR worker and open the camera in parallel; neither blocks the
    // other, and each maps its own failures to a visible status. In fixture
    // mode the camera is never touched — no permission prompt on stage.
    void this.ocr.init();
    if (!this.fixtureMode) {
      void this.camera.start(this.videoRef().nativeElement, SCAN_CONSTRAINTS);
    }
    void isPromptApiAvailable().then((ok) => this.promptApiActive.set(ok));
  }

  protected onFixtureLoad(): void {
    this.fixtureError.set(null);
    this.fixtureReady.set(true);
  }

  protected onFixtureError(): void {
    this.fixtureReady.set(false);
    this.fixtureError.set(
      'Fixture receipt missing (/fixtures/receipt.svg). It ships with the repo — check the build.',
    );
  }

  private teardown(): void {
    this.camera.stop(this.videoRef().nativeElement);
    // Keep the OCR worker warm across route changes (root-scoped service); do
    // not terminate here so the second on-stage run stays fast.
  }

  /**
   * Grab the current camera frame and run the full local pipeline:
   * OCR → heuristic extraction → optional Prompt API refinement → non-destructive
   * form patch. The network counter is reset first so the "0 bytes uploaded"
   * badge reflects exactly this scan.
   */
  protected async scan(): Promise<void> {
    if (this.isRecognizing() || !this.scanReady()) {
      return;
    }
    const canvas = this.captureRef().nativeElement;
    // Scan source: the bundled receipt image in fixture mode, else the camera.
    const source = this.fixtureMode ? this.fixtureImgRef()?.nativeElement : this.videoRef().nativeElement;
    if (!source) {
      return;
    }
    const w = source instanceof HTMLImageElement ? source.naturalWidth : source.videoWidth;
    const h = source instanceof HTMLImageElement ? source.naturalHeight : source.videoHeight;
    if (w === 0 || h === 0) {
      return; // frames not flowing / image not decoded yet
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.drawImage(source, 0, 0, w, h);

    this.network.reset();
    try {
      const result = await this.ocr.recognize(canvas);
      this.recognizedText.set(result.text.trim());
      this.ocrConfidence.set(result.confidence);

      let fields = extractFields(result.text);
      if (this.promptApiActive()) {
        const ai = await mapFieldsWithPromptApi(result.text);
        fields = mergeFields(fields, ai);
      }
      this.applyExtraction(fields);
    } catch {
      /* ocr.error signal already carries the message for the overlay */
    }
  }

  /**
   * Patch the form with extracted values — but never touch a control the user
   * has already edited (`dirty`). Programmatic `setValue` leaves the control
   * pristine, so a re-scan refreshes auto-filled fields yet respects manual
   * edits. Records each filled field's confidence for its badge.
   */
  private applyExtraction(fields: ExtractedFields): void {
    const c = this.form.controls;
    const badges: Partial<Record<FieldKey, Confidence>> = { ...this.badgesSignal() };

    if (fields.date && c.date.pristine) {
      c.date.setValue(fields.date.value);
      badges.date = fields.date.confidence;
    }
    if (fields.amount && c.amount.pristine) {
      c.amount.setValue(fields.amount.value);
      badges.amount = fields.amount.confidence;
    }
    if (fields.currency && c.currency.pristine) {
      c.currency.setValue(fields.currency.value);
      badges.currency = fields.currency.confidence;
    }
    if (fields.iban && c.iban.pristine) {
      c.iban.setValue(fields.iban.value);
      badges.iban = fields.iban.confidence;
    }
    if (fields.vendor && c.vendor.pristine) {
      c.vendor.setValue(fields.vendor.value);
      badges.vendor = fields.vendor.confidence;
    }
    if (fields.email && c.email.pristine) {
      c.email.setValue(fields.email.value);
      badges.email = fields.email.confidence;
    }
    this.badgesSignal.set(badges);
  }

  /** Badge for a field, shown only while the value is still the auto-filled one. */
  protected badgeFor(key: FieldKey): Confidence | null {
    return this.form.controls[key].pristine ? (this.badges()[key] ?? null) : null;
  }

  protected onSubmit(): void {
    this.form.markAllAsTouched();
  }
}
