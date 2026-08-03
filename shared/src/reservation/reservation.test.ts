import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  normalizePhone,
  normalizeDedupInputs,
  isMergeSignal,
  MERGE_SIGNALS,
} from './dedup.js';
import { validateSurvey, SURVEY_WHY_MAX_LENGTH } from './survey.js';

describe('dedup normalization (§4.1)', () => {
  it('lowercases and trims email', () => {
    expect(normalizeEmail('  Dana@Example.COM ')).toBe('dana@example.com');
  });

  it('reduces a US phone to ten digits regardless of formatting', () => {
    expect(normalizePhone('+1 (415) 555-0100')).toBe('4155550100');
    expect(normalizePhone('415-555-0100')).toBe('4155550100');
    expect(normalizePhone('14155550100')).toBe('4155550100');
  });

  it('produces the same key for the same person written two ways', () => {
    const a = normalizeDedupInputs({ email: 'A@B.com', phone: '(415) 555-0100' });
    const b = normalizeDedupInputs({ email: 'a@b.com ', phone: '+1 415 555 0100' });
    expect(a).toEqual(b);
  });

  it('treats IP and device as risk-only, never merge signals', () => {
    expect(isMergeSignal('ip')).toBe(false);
    expect(isMergeSignal('device')).toBe(false);
    expect(isMergeSignal('email')).toBe(true);
    expect(isMergeSignal('payment_fingerprint')).toBe(true);
    expect([...MERGE_SIGNALS]).not.toContain('ip');
  });
});

describe('demand survey (§19 step 2)', () => {
  it('accepts a valid answer pair', () => {
    const r = validateSurvey({ why: '  I need focus  ', recommend: 8 });
    expect(r).toEqual({ ok: true, value: { why: 'I need focus', recommend: 8 } });
  });

  it('requires the free-text answer', () => {
    expect(validateSurvey({ why: '   ', recommend: 5 })).toMatchObject({ ok: false, field: 'why' });
  });

  it('enforces the visible character limit', () => {
    const long = 'x'.repeat(SURVEY_WHY_MAX_LENGTH + 1);
    expect(validateSurvey({ why: long, recommend: 5 })).toMatchObject({ ok: false, field: 'why' });
  });

  it('rejects a rating outside 1–10 or non-integer', () => {
    expect(validateSurvey({ why: 'ok', recommend: 0 })).toMatchObject({ ok: false, field: 'recommend' });
    expect(validateSurvey({ why: 'ok', recommend: 11 })).toMatchObject({ ok: false, field: 'recommend' });
    expect(validateSurvey({ why: 'ok', recommend: 4.5 })).toMatchObject({ ok: false, field: 'recommend' });
  });

  it('coerces a numeric string rating', () => {
    expect(validateSurvey({ why: 'ok', recommend: '7' })).toMatchObject({ ok: true });
  });
});
