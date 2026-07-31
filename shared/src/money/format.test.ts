import { describe, it, expect } from 'vitest';
import { formatCents, formatUsd } from './format.js';
import { MoneyRuleError } from './errors.js';

describe('money formatting (§3.3, §24.3)', () => {
  it('renders cents with two decimal places', () => {
    expect(formatCents(0n)).toBe('0.00');
    expect(formatCents(5n)).toBe('0.05');
    expect(formatCents(50n)).toBe('0.50');
    expect(formatCents(1900n)).toBe('19.00');
    expect(formatCents(1999n)).toBe('19.99');
  });

  it('groups thousands', () => {
    expect(formatCents(100000n)).toBe('1,000.00');
    expect(formatCents(5000000n)).toBe('50,000.00');
    expect(formatCents(123456789n)).toBe('1,234,567.89');
  });

  it('prefixes US$ in the Appendix A form', () => {
    expect(formatUsd(3900n)).toBe('US$39.00');
    expect(formatUsd(5000000n)).toBe('US$50,000.00');
  });

  it('refuses anything that is not non-negative bigint cents', () => {
    expect(() => formatCents(-1n)).toThrow(MoneyRuleError);
    expect(() => formatCents(19.99 as unknown as bigint)).toThrow(MoneyRuleError);
  });
});
