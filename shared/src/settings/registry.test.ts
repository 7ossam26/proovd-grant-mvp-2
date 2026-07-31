/**
 * The §6 register's own guarantees. The database mirror is checked separately
 * in `backend/src/tests/admin-settings.test.ts`; this file checks the rules the
 * register must hold on its own, before anything is stored.
 */

import { describe, it, expect } from 'vitest';
import {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SETTING_GROUPS,
  findSetting,
  parseSettingValue,
  missingRequiredSettings,
  isEditableSetting,
} from './registry.js';
import { US_FEDERAL_HOLIDAYS } from '../calendar/business-days.js';

describe('the register is well-formed', () => {
  it('has no duplicate keys', () => {
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length);
  });

  it('uses snake_case keys, so a column, a job name, and a log line all agree', () => {
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('cites a §6 line for every setting', () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.specRef).toMatch(/^§6/);
    }
  });

  it('places every setting in a group the Admin surface renders', () => {
    const rendered = new Set(SETTING_GROUPS.map((g) => g.group));
    for (const definition of SETTING_DEFINITIONS) {
      expect(rendered.has(definition.group)).toBe(true);
    }
  });

  it('renders no empty group heading', () => {
    for (const { group } of SETTING_GROUPS) {
      expect(SETTING_DEFINITIONS.some((d) => d.group === group)).toBe(true);
    }
  });
});

describe('provenance decides whether a default may exist (§1 rule 6)', () => {
  it('gives every `specified` and `derived` setting a seed value', () => {
    for (const definition of SETTING_DEFINITIONS) {
      if (definition.provenance !== 'operator') {
        expect(definition.defaultValue, definition.key).not.toBeNull();
      }
    }
  });

  it('gives every `operator` setting no default anywhere', () => {
    const operatorSettings = SETTING_DEFINITIONS.filter((d) => d.provenance === 'operator');
    // §6 names these and fixes no value. If this list ever empties, someone has
    // invented a commercial number in code.
    expect(operatorSettings.length).toBeGreaterThan(0);
    for (const definition of operatorSettings) {
      expect(definition.defaultValue, definition.key).toBeNull();
    }
  });

  it('names the Admin reauthentication window as operator-set, matching the env guard', () => {
    const setting = findSetting('admin_reauth_window_seconds');
    expect(setting?.provenance).toBe('operator');
    expect(setting?.defaultValue).toBeNull();
  });

  it('derives the calendar version and timezone from the committed calendar', () => {
    expect(findSetting('business_day_calendar_version')?.defaultValue).toBe(
      US_FEDERAL_HOLIDAYS.version,
    );
    expect(findSetting('business_day_time_zone')?.defaultValue).toBe(
      US_FEDERAL_HOLIDAYS.timezone,
    );
  });

  it('refuses to let a derived setting be edited (§29.6)', () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(isEditableSetting(definition)).toBe(definition.provenance !== 'derived');
    }
  });
});

describe('every seeded default survives its own parser', () => {
  it.each(
    SETTING_DEFINITIONS.filter((d) => d.defaultValue !== null).map(
      (d) => [d.key, d] as const,
    ),
  )('%s', (_key, definition) => {
    const result = parseSettingValue(definition, definition.defaultValue as string);
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
  });
});

describe('parsing is strict', () => {
  const cents = findSetting('listing_fee_base_cents')!;
  const percent = findSetting('platform_fee_percent')!;
  const cooldown = findSetting('founder_cooldown_months')!;
  const flag = findSetting('product_early_remaining_payment_enabled')!;
  const providers = findSetting('interview_providers')!;

  it('reads money as integer cents in a bigint', () => {
    const result = parseSettingValue(cents, '3500');
    expect(result).toEqual({ ok: true, value: 3500n });
  });

  it('refuses a decimal dollar amount', () => {
    const result = parseSettingValue(cents, '35.00');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/whole number of cents/);
  });

  it.each(['48 hours', '4_8', ' 12x', '-5', ''])('refuses %o as a number', (raw) => {
    expect(parseSettingValue(percent, raw).ok).toBe(false);
  });

  it('refuses a percentage above 100', () => {
    expect(parseSettingValue(percent, '101').ok).toBe(false);
  });

  it('enforces the "at least three months" floor §6 states in words', () => {
    expect(parseSettingValue(cooldown, '2').ok).toBe(false);
    expect(parseSettingValue(cooldown, '3')).toEqual({ ok: true, value: 3 });
    expect(parseSettingValue(cooldown, '6')).toEqual({ ok: true, value: 6 });
  });

  it('reads booleans as exactly true or false', () => {
    expect(parseSettingValue(flag, 'false')).toEqual({ ok: true, value: false });
    expect(parseSettingValue(flag, 'true')).toEqual({ ok: true, value: true });
    expect(parseSettingValue(flag, 'yes').ok).toBe(false);
    expect(parseSettingValue(flag, '0').ok).toBe(false);
  });

  it('reads a list one entry per line and drops blank lines', () => {
    expect(parseSettingValue(providers, 'Cal.com\n\n  Zoom  \n')).toEqual({
      ok: true,
      value: ['Cal.com', 'Zoom'],
    });
  });

  it('refuses an empty list', () => {
    expect(parseSettingValue(providers, '   \n  ').ok).toBe(false);
  });
});

describe('missingRequiredSettings is the fail-closed input (§6)', () => {
  const fullState = SETTING_DEFINITIONS.map((d) => ({
    key: d.key,
    value: d.defaultValue ?? 'stated-by-operator',
  }));

  it('reports every operator setting when nothing has been stated', () => {
    const seeded = SETTING_DEFINITIONS.map((d) => ({ key: d.key, value: d.defaultValue }));
    const missing = missingRequiredSettings(seeded);
    const operatorKeys = SETTING_DEFINITIONS.filter((d) => d.provenance === 'operator').map(
      (d) => d.key,
    );
    expect([...missing].sort()).toEqual([...operatorKeys].sort());
  });

  it('is empty once every setting has a value', () => {
    expect(missingRequiredSettings(fullState)).toEqual([]);
  });

  it('treats whitespace as unset — a space is not a stated value', () => {
    const state = fullState.map((s) =>
      s.key === 'interview_availability' ? { ...s, value: '   ' } : s,
    );
    expect(missingRequiredSettings(state)).toEqual(['interview_availability']);
  });

  it('treats a key absent from the state entirely as unset', () => {
    const state = fullState.filter((s) => s.key !== 'platform_fee_percent');
    expect(missingRequiredSettings(state)).toEqual(['platform_fee_percent']);
  });
});
