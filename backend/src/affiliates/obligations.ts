/**
 * §20's Creator obligations and §11's `No action needed`, restated.
 *
 * The backend cannot import `@proovd/shared` at runtime, and these reach a
 * customer-facing surface — a dropped obligation is one nobody agreed to drop,
 * and a paraphrased `No action needed` is a softer promise (§11 puts it in
 * backticks and §33.2.3 tests for it). `src/tests/live-editing.test.ts`
 * drift-tests both against the shared register.
 *
 * `enforcement` is §1.4 made structural: Proovd cannot detect a purchased list or
 * an identity-hidden account, so most of these are surfaced to the Creator and
 * verified by a person on evidence when something goes wrong. Claiming otherwise
 * on the surface would imply an automation that does not exist.
 */

export interface CreatorObligation {
  key: string;
  statement: string;
  enforcement: 'surfaced' | 'verified_on_evidence';
  specRef: string;
}

export const NO_ACTION_NEEDED = 'No action needed';

export const CREATOR_OBLIGATIONS: readonly CreatorObligation[] = [
  {
    key: 'content_availability',
    statement:
      'Keep your promotional content available for the agreed campaign and availability period. Story-format content may follow the natural lifespan you agreed in advance.',
    enforcement: 'verified_on_evidence',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'no_spam',
    statement:
      'No spam, no unsolicited direct messages, no identity-hidden accounts, no purchased lists, no unrelated mass platforms, and nothing aimed at minors.',
    enforcement: 'verified_on_evidence',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'no_prohibited_claims',
    statement:
      'No prohibited claims, and no sharing, selling, or transferring your tracking link to anyone.',
    enforcement: 'verified_on_evidence',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'permitted_channels',
    statement:
      'Promote only through channels you own, administer, are permitted to use, or are a guest on — and follow that host’s rules.',
    enforcement: 'surfaced',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'email_rules',
    statement:
      'Newsletter and email promotion must follow CAN-SPAM, platform rules, and any privacy rules that apply to that audience.',
    enforcement: 'surfaced',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'student_affiliates',
    statement:
      'If you are a student Affiliate you act personally, and cannot imply your school or club endorses the campaign.',
    enforcement: 'surfaced',
    specRef: '§20 Affiliate during live campaign',
  },
  {
    key: 'disclosure',
    statement:
      'Every promotional post clearly discloses a paid or material relationship with this Founder and product — a native paid-promotion tool, a prominent #ad or #sponsored, story-integrated text, or a verbal pre-roll. It must be hard to miss and appear at the start or otherwise prominently.',
    enforcement: 'verified_on_evidence',
    specRef: '§20 Affiliate during live campaign',
  },
] as const;
