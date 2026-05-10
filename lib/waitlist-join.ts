export type WaitlistJoinConsent = {
  is18Plus?: boolean;
  termsAccepted?: boolean;
  smsConsent?: boolean;
  liabilityUnderstood?: boolean;
};

export function buildWaitlistJoinRow(args: {
  phoneE164: string;
  consent?: WaitlistJoinConsent;
  onairosCompletion?: unknown;
}): Record<string, unknown> {
  const consent = args.consent ?? {};
  const row: Record<string, unknown> = {
    value: args.phoneE164,
    type: "phone",
    city: "nyc",
    is_18_plus: Boolean(consent.is18Plus),
    terms_accepted: Boolean(consent.termsAccepted),
    sms_consent: Boolean(consent.smsConsent),
    liability_understood: Boolean(consent.liabilityUnderstood),
  };

  if (args.onairosCompletion !== undefined) {
    row.onairos_completion = args.onairosCompletion;
    row.onairos_traits_status = "pending";
    row.onairos_traits_error = null;
  } else {
    row.onairos_traits_status = "complete";
    row.onairos_traits_error = null;
  }

  return row;
}
