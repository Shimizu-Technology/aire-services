// Checks Settings values before they are sent, and rewrites the server's refusals,
// so every message starts with the name printed on the page.

// Mirrors the server (Api::V1::Admin::SettingsController, Setting, PayDocuments.valid_email?).

// The same pattern the server checks recipients against (URI::MailTo::EMAIL_REGEXP).
const emailPattern =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

export const MAX_RECIPIENTS = 10
/** PayDocuments::EMAIL_MAX_LENGTH and EMAIL_SEPARATORS, for the pay stub heads-up list. */
const PAY_STUB_EMAIL_MAX_LENGTH = 254
const PAY_STUB_EMAIL_SEPARATORS = /[<>,;"\s]/

const AUTO_APPROVE_MAX_HOURS = 23

// Whole numbers where Rails reads the value with to_i, plain decimals where it uses Float or to_f.
// Hex ("0x10"), exponents ("1e3") and digit separators ("1_000") are refused even where Ruby would read them.
const WHOLE_NUMBER = /^[+-]?\d+$/
const DECIMAL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

type NumberRule = { ask: string; whole?: boolean; min?: number; max?: number; minExclusive?: boolean; hint: string }

const numberRules: Record<string, NumberRule> = {
  overtime_daily_threshold_hours: { ask: 'enter a number of hours', min: 0, minExclusive: true, hint: 'enter a number greater than 0' },
  overtime_weekly_threshold_hours: { ask: 'enter a number of hours', min: 0, minExclusive: true, hint: 'enter a number greater than 0' },
  auto_approve_max_shift_hours: { ask: 'enter a number of hours', min: 1, max: AUTO_APPROVE_MAX_HOURS, hint: `enter a number from 1 to ${AUTO_APPROVE_MAX_HOURS}` },
  early_clock_in_buffer_minutes: { ask: 'enter a whole number of minutes', whole: true, min: 0, hint: 'enter 0 or a larger whole number of minutes' },
  clock_in_location_radius_meters: { ask: 'enter a whole number of meters', whole: true, min: 0, minExclusive: true, hint: 'enter a whole number of meters greater than 0' },
  clock_in_location_latitude: { ask: 'enter a latitude, such as 13.46913', min: -90, max: 90, hint: 'enter a latitude from -90 to 90, such as 13.46913' },
  clock_in_location_longitude: { ask: 'enter a longitude, such as 144.79901', min: -180, max: 180, hint: 'enter a longitude from -180 to 180, such as 144.79901' },
}

const textRules: Record<string, string> = {
  clock_in_location_name: 'enter a location name',
}

export const emailKeys = ['payroll_cutoff_reminder_emails', 'pay_stub_request_notification_emails']

/** Splits on commas, semicolons and new lines. Keeps the casing the person typed. */
export function splitEmails(value: string): string[] {
  return value.split(/[\n,;]+/).map((email) => email.trim()).filter(Boolean)
}

/** Drops repeats ignoring case, lowercases: the same rule as the server. */
export function normalizeEmails(value: string): string[] {
  return [...new Set(splitEmails(value).map((email) => email.toLowerCase()))]
}

export type EmailKind = 'reminder' | 'payStub'

/** Reminder recipients and the pay stub heads-up list are checked by different server rules. */
export const emailKindFor = (key: string): EmailKind => (key === 'payroll_cutoff_reminder_emails' ? 'reminder' : 'payStub')

/** Why one address can't be used, in words the office would use. Null when it's fine. */
export function emailProblem(address: string, kind: EmailKind = 'reminder'): string | null {
  const invalid = `'${address}' isn't a valid email address, for example name@example.com.`
  if (kind === 'payStub') {
    if (address.length > PAY_STUB_EMAIL_MAX_LENGTH) {
      return `'${address.slice(0, 40)}…' is too long. Email addresses can be ${PAY_STUB_EMAIL_MAX_LENGTH} characters at most.`
    }
    if (PAY_STUB_EMAIL_SEPARATORS.test(address)) return invalid
  }
  if (emailPattern.test(address)) {
    if (kind === 'payStub' && !address.split('@')[1].includes('.')) {
      return `'${address}' needs a domain with a dot, for example ${address.split('@')[0]}@example.com.`
    }
    return null
  }
  const at = address.indexOf('@')
  const local = at > 0 ? address.slice(0, at) : address
  const example = `${/^[\w.+-]+$/.test(local) ? local : 'name'}@example.com`
  if (at === -1 || at === address.length - 1) return `'${address}' is missing an email domain, for example ${example}.`
  if (at === 0) return `'${address}' is missing the name before the @, for example name@example.com.`
  return invalid
}

/** The message to show under a setting's field, or null when its value is fine. */
export function validateSetting(key: string, value: string, label: string): string | null {
  const number = numberRules[key]
  if (number) {
    const text = value.trim()
    const parsed = Number(text)
    const shape = number.whole ? WHOLE_NUMBER : DECIMAL_NUMBER
    if (!text || !shape.test(text) || !Number.isFinite(parsed)) return `${label}: ${number.ask}.`
    const low = number.min !== undefined && (number.minExclusive ? parsed <= number.min : parsed < number.min)
    const high = number.max !== undefined && parsed > number.max
    return low || high ? `${label}: ${number.hint}.` : null
  }
  if (textRules[key] && !value.trim()) return `${label}: ${textRules[key]}.`
  if (emailKeys.includes(key)) return validateEmailList(value, label, emailKindFor(key))
  return null
}

export function validateEmailList(value: string, label: string, kind: EmailKind = 'reminder'): string | null {
  const emails = normalizeEmails(value)
  for (const address of splitEmails(value)) {
    const problem = emailProblem(address, kind)
    if (problem) return `${label}: ${problem}`
  }
  if (emails.length > MAX_RECIPIENTS) return `${label}: use ${MAX_RECIPIENTS} addresses or fewer.`
  return null
}

// What the server says, and which field on the page that is about.
const serverMessages: Array<{ test: RegExp; key: string }> = [
  { test: /^Daily overtime threshold/, key: 'overtime_daily_threshold_hours' },
  { test: /^Weekly overtime threshold/, key: 'overtime_weekly_threshold_hours' },
  { test: /^Longest auto-approved shift/, key: 'auto_approve_max_shift_hours' },
  { test: /^Early clock-in buffer/, key: 'early_clock_in_buffer_minutes' },
  { test: /^Clock-in radius/, key: 'clock_in_location_radius_meters' },
  { test: /^Clock-in latitude|^Set a valid clock-in latitude/, key: 'clock_in_location_latitude' },
  { test: /^Clock-in longitude/, key: 'clock_in_location_longitude' },
  { test: /^Enter valid reminder email addresses/, key: 'payroll_cutoff_reminder_emails' },
]

/**
 * Turns a refusal from the server into a field and a message using the visible label,
 * e.g. "Daily overtime threshold must be greater than 0" becomes
 * "Daily hours review alert must be greater than 0." Null when it isn't about one field.
 */
export function mapServerSettingError(
  message: string,
  labelFor: (key: string) => string,
  onPage: (key: string) => boolean,
): { key: string; message: string } | null {
  const match = serverMessages.find((rule) => rule.test.test(message) && onPage(rule.key))
  if (!match) return null
  const label = labelFor(match.key)
  if (match.key === 'payroll_cutoff_reminder_emails') return { key: match.key, message: `${label}: enter valid email addresses, for example chels@example.com.` }
  if (/^Set a valid/.test(message)) return { key: match.key, message: `${label}: enter a valid latitude and longitude before turning the location check on.` }
  const rest = message.replace(match.test, '').trim().replace(/[.]*$/, '')
  return { key: match.key, message: `${label} ${rest}.` }
}
