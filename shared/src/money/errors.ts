/**
 * A money or compensation rule was violated. Thrown, never returned — Spec §1
 * rule 6: if a case is not expressly automated it routes to Admin review, so
 * the calculation layer refuses loudly instead of guessing.
 */
export class MoneyRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyRuleError';
  }
}
