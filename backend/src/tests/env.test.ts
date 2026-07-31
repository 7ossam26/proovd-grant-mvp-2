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
  BETTER_AUTH_SECRET: 'a-32-character-or-longer-better-auth-secret-for-tests',
  ADMIN_REAUTH_WINDOW_SECONDS: '300',
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

describe('env.validateEnv — auth configuration (Spec §5, §6, §28.2)', () => {
  it('rejects a short BETTER_AUTH_SECRET', () => {
    expect(() => validateEnv({ ...validBase, BETTER_AUTH_SECRET: 'short' })).toThrow(/32/);
  });

  // §6 names "Admin MFA and reauthentication window" as a setting but fixes no
  // number. The app therefore has no default: it refuses to boot until the
  // operator states one, rather than inventing a commercial rule (§1 rule 6).
  it('refuses to boot without an explicit ADMIN_REAUTH_WINDOW_SECONDS', () => {
    const { ADMIN_REAUTH_WINDOW_SECONDS: _, ...rest } = validBase;
    expect(() => validateEnv(rest)).toThrow(/ADMIN_REAUTH_WINDOW_SECONDS/);
  });

  it('rejects a non-positive reauthentication window', () => {
    expect(() => validateEnv({ ...validBase, ADMIN_REAUTH_WINDOW_SECONDS: '0' })).toThrow(
      /ADMIN_REAUTH_WINDOW_SECONDS/,
    );
  });

  it('accepts Google OAuth configured fully or not at all (§5.2)', () => {
    expect(() => validateEnv(validBase)).not.toThrow();
    expect(() =>
      validateEnv({ ...validBase, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }),
    ).not.toThrow();
  });

  it('rejects a half-configured Google OAuth, which would fail mid-signin instead', () => {
    expect(() => validateEnv({ ...validBase, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT/);
    expect(() => validateEnv({ ...validBase, GOOGLE_CLIENT_SECRET: 'secret' })).toThrow(
      /GOOGLE_CLIENT/,
    );
  });
});
