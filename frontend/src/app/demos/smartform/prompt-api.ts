/**
 * prompt-api.ts — OPTIONAL on-device field mapping via Chrome's built-in Prompt
 * API (`LanguageModel`, a.k.a. window.ai). When the browser exposes a usable
 * language model we ask it to map messy OCR text onto our expense fields; when
 * it does not, the demo falls back entirely to the pure heuristics in
 * {@link ./extract-fields}. The heuristic path is fully standalone — this file
 * only ever *refines* it, and only where the heuristic is weak or empty.
 *
 * Nothing here touches the network: the Prompt API runs a model on-device
 * (Gemini Nano), consistent with the "no runtime CDN / offline-first" rule. Any
 * failure (unavailable, download pending, bad output) degrades silently to the
 * heuristic result.
 */
import { Confidence, ExtractedFields, FieldKey, extractDate, isValidIban } from './extract-fields';

// --- Minimal typings for the experimental Prompt API ------------------------
// The API is not in lib.dom yet; we declare only the sliver we use and read it
// off globalThis with narrowing (no `any`, per CLAUDE.md).

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy(): void;
}

interface LanguageModelStatic {
  availability(): Promise<Availability>;
  create(options?: {
    initialPrompts?: { role: string; content: string }[];
  }): Promise<LanguageModelSession>;
}

function getLanguageModel(): LanguageModelStatic | null {
  const candidate = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  if (
    candidate &&
    typeof candidate === 'object' &&
    'availability' in candidate &&
    'create' in candidate
  ) {
    return candidate as LanguageModelStatic;
  }
  return null;
}

/** True if a usable on-device language model is present (and not just declared). */
export async function isPromptApiAvailable(): Promise<boolean> {
  const lm = getLanguageModel();
  if (!lm) {
    return false;
  }
  try {
    return (await lm.availability()) === 'available';
  } catch {
    return false;
  }
}

/** The raw string values the model is asked to return (unknown until narrowed). */
export type PromptFields = Partial<Record<FieldKey, string>>;

const SYSTEM_PROMPT =
  'You extract structured fields from the raw OCR text of an expense receipt. ' +
  'Reply with ONLY a compact JSON object using these keys: ' +
  'date (ISO yyyy-mm-dd), amount (number, no currency symbol, dot decimal), ' +
  'currency (ISO 4217 code), iban, vendor (the business name), email. ' +
  'Use null for any field you cannot find. No prose, no code fences.';

/**
 * Ask the on-device model to map `text` to fields. Returns `{}` if the API is
 * unavailable or the response cannot be parsed — callers must treat this as a
 * best-effort hint, never a requirement.
 */
export async function mapFieldsWithPromptApi(text: string): Promise<PromptFields> {
  const lm = getLanguageModel();
  if (!lm) {
    return {};
  }
  let session: LanguageModelSession | null = null;
  try {
    if ((await lm.availability()) !== 'available') {
      return {};
    }
    session = await lm.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    });
    const raw = await session.prompt(text);
    return parsePromptJson(raw);
  } catch {
    return {};
  } finally {
    session?.destroy();
  }
}

/** Extract and narrow the first JSON object in the model's reply. */
export function parsePromptJson(raw: string): PromptFields {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const keys: FieldKey[] = ['date', 'amount', 'currency', 'iban', 'vendor', 'email'];
  const out: PromptFields = {};
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      out[key] = value.trim();
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * Merge model output into the heuristic result — pure, so it is unit-testable
 * without the browser API. The contract enforces "proactive, never destructive":
 *
 *   - a `high`-confidence heuristic value is NEVER overridden by the model;
 *   - the model only fills fields the heuristic left empty (or only guessed at
 *     with `low`/`medium` confidence, e.g. vendor);
 *   - model-supplied values are re-validated with the same pure checks (IBAN
 *     checksum, date/amount normalization) so a hallucination cannot slip in.
 *
 * Model-derived values are tagged `medium` — trustworthy enough to propose,
 * honest that a language model produced them.
 */
export function mergeFields(heuristic: ExtractedFields, ai: PromptFields): ExtractedFields {
  const merged: {
    -readonly [K in keyof ExtractedFields]: ExtractedFields[K];
  } = { ...heuristic };
  const AI: Confidence = 'medium';

  const canOverride = (key: FieldKey): boolean => heuristic[key]?.confidence !== 'high';

  if (ai.date && canOverride('date')) {
    const normalized = extractDate(ai.date);
    if (normalized) {
      merged.date = { value: normalized.value, confidence: AI };
    }
  }
  if (ai.amount && canOverride('amount')) {
    const n = Number(ai.amount.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) {
      merged.amount = { value: n, confidence: AI };
    }
  }
  if (ai.currency && canOverride('currency')) {
    const code = ai.currency.toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) {
      merged.currency = { value: code, confidence: AI };
    }
  }
  if (ai.iban && canOverride('iban')) {
    const compact = ai.iban.replace(/\s+/g, '').toUpperCase();
    if (isValidIban(compact)) {
      merged.iban = { value: compact, confidence: AI };
    }
  }
  if (ai.email && canOverride('email') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ai.email)) {
    merged.email = { value: ai.email.toLowerCase(), confidence: AI };
  }
  // Vendor is the heuristic's weakest field, so the model is allowed to replace
  // anything below `high` here — this is where it helps most.
  if (ai.vendor && canOverride('vendor')) {
    merged.vendor = { value: ai.vendor, confidence: AI };
  }

  return merged;
}
