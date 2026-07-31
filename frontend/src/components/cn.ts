/** Join class names, dropping falsy values. The one class-composition helper —
 *  components never build className strings any other way. */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(' ');
}
