export const MINIMUM_FOUNDER_AGE = 18;

/** A real `YYYY-MM-DD` calendar date. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The latest birthdate that is at least `minimumAge` on `today`. */
export function latestBirthdateForAge(
  minimumAge = MINIMUM_FOUNDER_AGE,
  today = new Date(),
): string {
  const year = today.getUTCFullYear() - minimumAge;
  const month = today.getUTCMonth() + 1;
  const day = Math.min(
    today.getUTCDate(),
    new Date(Date.UTC(year, month, 0)).getUTCDate(),
  );
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isAtLeastFounderAge(value: string, today = new Date()): boolean {
  return isCalendarDate(value) && value <= latestBirthdateForAge(MINIMUM_FOUNDER_AGE, today);
}
