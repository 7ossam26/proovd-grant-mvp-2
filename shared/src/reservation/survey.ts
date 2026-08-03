/**
 * The fixed demand survey — Spec §19 step 2.
 *
 * Two questions, one free text and one 1–10 rating. §19: "applies a reasonable
 * visible character limit to free text." The limit is a product fact used in two
 * places — the input's `maxLength` and the server's validation — so it is one
 * constant here rather than two numbers that can drift.
 */

/** §19: `Why do you want this product?` — free text, reasonable visible limit. */
export const SURVEY_WHY_MAX_LENGTH = 2000;

/** §19: `How likely are you to recommend this to someone?` — 1–10 inclusive. */
export const SURVEY_RECOMMEND_MIN = 1;
export const SURVEY_RECOMMEND_MAX = 10;

export const SURVEY_WHY_QUESTION = 'Why do you want this product?';
export const SURVEY_RECOMMEND_QUESTION = 'How likely are you to recommend this to someone?';

export interface SurveyAnswers {
  why: string;
  recommend: number;
}

export type SurveyValidation =
  | { ok: true; value: SurveyAnswers }
  | { ok: false; field: 'why' | 'recommend'; reason: string };

/**
 * Validates the two answers. Both are required: §19 lists the survey as a step,
 * not an optional aside — the helper text "honestly labels optionality" of the
 * *marketing* consent, not of the survey itself.
 */
export function validateSurvey(input: { why: unknown; recommend: unknown }): SurveyValidation {
  const why = typeof input.why === 'string' ? input.why.trim() : '';
  if (why.length === 0) {
    return { ok: false, field: 'why', reason: 'Tell the Founder why you want this.' };
  }
  if (why.length > SURVEY_WHY_MAX_LENGTH) {
    return {
      ok: false,
      field: 'why',
      reason: `Keep this under ${SURVEY_WHY_MAX_LENGTH} characters.`,
    };
  }
  const recommend =
    typeof input.recommend === 'number'
      ? input.recommend
      : typeof input.recommend === 'string' && input.recommend.trim() !== ''
        ? Number(input.recommend)
        : NaN;
  if (
    !Number.isInteger(recommend) ||
    recommend < SURVEY_RECOMMEND_MIN ||
    recommend > SURVEY_RECOMMEND_MAX
  ) {
    return {
      ok: false,
      field: 'recommend',
      reason: `Choose a number from ${SURVEY_RECOMMEND_MIN} to ${SURVEY_RECOMMEND_MAX}.`,
    };
  }
  return { ok: true, value: { why, recommend } };
}
