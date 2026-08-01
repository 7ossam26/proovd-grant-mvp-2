/**
 * What §24.6's separate-stream sentence has to say, whatever its wording.
 *
 * The sentence itself is the server's — it is a commercial statement, not copy,
 * so `workspace/projection.ts` owns it and the surface renders it. Asserting the
 * whole string in the browser suite would make an editorial improvement look
 * like a regression; asserting these three facts is what actually matters:
 * which fee this is, that the 5% is a different one, and that it is not in this
 * total.
 */
export const SEPARATE_STREAM_HINTS = ['5%', 'separate', 'not part of this total'] as const;
