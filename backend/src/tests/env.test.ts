import { describe, it, expect } from 'vitest';
import { validateEnv } from '../env.js';

// Minimal valid env for tests — all required fields set, mode consistent.
// NOTE: These are deliberately non-functional placeholder values that satisfy
// the key-format regex (sk_test_ / pk_test_ prefix) without being real secrets.
const FAKE_TEST_SK = 'sk_test_' + 'PLACEHOLDER_NOT_A_REAL_KEY_FOR_TESTING_ONLY';
const FAKE_TEST_PK = 'pk_test_' + 'PLACEHOLDER_NOT_A_REAL_KEY_FOR_TESTING_ONLY';
const FAKE_LIVE_SK = 'sk_live_' + 'PLACEHOLDER_NOT_A_REAL_KEY_FOR_TESTING_ONLY';
const FAKE_LIVE_PK = 'pk_live_' + 'PLACEHOLDER_NOT_A_REAL_KEY_FOR_TESTING_ONLY';

const validBase = {
  NODE_ENV: 'test' as const,
  PORT: '3000',
  DATABASE_URL: 'postgres://localhost/test',
  APP_BASE_URL: 'https://app.example.com',
  STRIPE_MODE: 'test' as const,
  STRIPE_PLATFORM_SECRET_KEY: FAKE_TEST_SK,
  STRIPE_PLATFORM_PUBLISHABLE_KEY: FAKE_TEST_PK,
  CRON_SECRET: 'a-32-character-or-longer-cron-secret-for-tests',
};

describe('env.validateEnv — Stripe mode guard (Spec §6)', () => {
  it('accepts a valid test-mode configuration', () => {
    expect(() => validateEnv(validBase)).not.toThrow();
    const env = validateEnv(validBase);
    expect(env.STRIPE_MODE).toBe('test');
  });

  it('rejects sk_live_ secret key when STRIPE_MODE=test', () => {
    expect(() =>
      validateEnv({
        ...validBase,
        STRIPE_PLATFORM_SECRET_KEY: FAKE_LIVE_SK,
      }),
    ).toThrow(/sk_test_/);
  });

  it('rejects pk_live_ publishable key when STRIPE_MODE=test', () => {
    expect(() =>
      validateEnv({
        ...validBase,
        STRIPE_PLATFORM_PUBLISHABLE_KEY: FAKE_LIVE_PK,
      }),
    ).toThrow(/pk_test_/);
  });

  it('rejects sk_test_ secret key when STRIPE_MODE=live', () => {
    expect(() =>
      validateEnv({
        ...validBase,
        STRIPE_MODE: 'live',
        STRIPE_PLATFORM_SECRET_KEY: FAKE_TEST_SK,
        STRIPE_PLATFORM_PUBLISHABLE_KEY: FAKE_LIVE_PK,
      }),
    ).toThrow(/sk_live_/);
  });

  it('rejects test connected-account IDs when STRIPE_MODE=live', () => {
    expect(() =>
      validateEnv({
        ...validBase,
        STRIPE_MODE: 'live',
        STRIPE_PLATFORM_SECRET_KEY: FAKE_LIVE_SK,
        STRIPE_PLATFORM_PUBLISHABLE_KEY: FAKE_LIVE_PK,
        STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID: 'acct_test_founder',
      }),
    ).toThrow(/live.*test|test.*live/i);
  });

  it('rejects a short CRON_SECRET', () => {
    expect(() =>
      validateEnv({
        ...validBase,
        CRON_SECRET: 'short',
      }),
    ).toThrow(/32/);
  });

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL: _, ...rest } = validBase;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
