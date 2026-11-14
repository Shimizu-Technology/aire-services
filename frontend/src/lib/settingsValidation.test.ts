import { describe, expect, it } from 'vitest'

import { emailProblem, mapServerSettingError, normalizeEmails, validateEmailList, validateSetting } from './settingsValidation'

describe('validateSetting', () => {
  it('names the visible field and says what to enter', () => {
    expect(validateSetting('overtime_daily_threshold_hours', '-1', 'Daily hours review alert')).toBe('Daily hours review alert: enter a number greater than 0.')
    expect(validateSetting('overtime_daily_threshold_hours', '0', 'Daily hours review alert')).toBe('Daily hours review alert: enter a number greater than 0.')
    expect(validateSetting('overtime_daily_threshold_hours', '', 'Daily hours review alert')).toBe('Daily hours review alert: enter a number of hours.')
    expect(validateSetting('overtime_weekly_threshold_hours', 'forty', 'Weekly hours review alert')).toBe('Weekly hours review alert: enter a number of hours.')
    expect(validateSetting('overtime_daily_threshold_hours', '8.5', 'Daily hours review alert')).toBeNull()
  })

  it('checks each field the way the server does', () => {
    expect(validateSetting('auto_approve_max_shift_hours', '24', 'Longest shift to auto-approve')).toBe('Longest shift to auto-approve: enter a number from 1 to 23.')
    expect(validateSetting('auto_approve_max_shift_hours', '12', 'x')).toBeNull()
    expect(validateSetting('early_clock_in_buffer_minutes', '-5', 'Early clock-in buffer')).toBe('Early clock-in buffer: enter 0 or a larger number of minutes.')
    expect(validateSetting('early_clock_in_buffer_minutes', '0', 'x')).toBeNull()
    expect(validateSetting('clock_in_location_radius_meters', '0', 'Allowed radius')).toBe('Allowed radius: enter a distance greater than 0 meters.')
    expect(validateSetting('clock_in_location_latitude', '95', 'Latitude')).toBe('Latitude: enter a latitude from -90 to 90, such as 13.46913.')
    expect(validateSetting('clock_in_location_longitude', '-181', 'Longitude')).toBe('Longitude: enter a longitude from -180 to 180, such as 144.79901.')
    expect(validateSetting('clock_in_location_name', '  ', 'Location label')).toBe('Location label: enter a location name.')
  })

  it('ignores keys without rules', () => {
    expect(validateSetting('managers_can_approve_own_time', 'true', 'x')).toBeNull()
  })
})

describe('email checks', () => {
  it('explains a missing domain with an example built from what was typed', () => {
    expect(emailProblem('chels')).toBe("'chels' is missing an email domain, for example chels@example.com.")
    expect(emailProblem('chels@')).toBe("'chels@' is missing an email domain, for example chels@example.com.")
    expect(emailProblem('@example.com')).toBe("'@example.com' is missing the name before the @, for example name@example.com.")
    expect(emailProblem('two words@example.com')).toBe("'two words@example.com' isn't a valid email address, for example name@example.com.")
  })

  it('accepts what the server accepts', () => {
    expect(emailProblem('a@b')).toBeNull()
    expect(emailProblem("o'brien+pay@example.com")).toBeNull()
  })

  it('names the field and the first bad address in a list', () => {
    expect(validateEmailList('ops@example.com, chels', 'Cutoff reminder recipients')).toBe("Cutoff reminder recipients: 'chels' is missing an email domain, for example chels@example.com.")
    expect(validateEmailList('ops@example.com', 'x')).toBeNull()
    expect(validateEmailList('', 'x')).toBeNull()
  })

  it('allows ten recipients and refuses eleven, ignoring repeats', () => {
    const list = (count: number) => Array.from({ length: count }, (_, i) => `p${i}@example.com`).join(', ')
    expect(validateEmailList(list(10), 'Heads-up emails')).toBeNull()
    expect(validateEmailList(list(11), 'Heads-up emails')).toBe('Heads-up emails: use 10 addresses or fewer.')
    expect(validateEmailList(`${list(10)}, P0@EXAMPLE.com`, 'x')).toBeNull()
  })

  it('normalizes like the server', () => {
    expect(normalizeEmails('Ops@Example.com; ops@example.com\nb@x.com')).toEqual(['ops@example.com', 'b@x.com'])
  })
})

describe('mapServerSettingError', () => {
  const labels: Record<string, string> = {
    overtime_daily_threshold_hours: 'Daily hours review alert',
    clock_in_location_radius_meters: 'Allowed radius',
    clock_in_location_latitude: 'Latitude',
    payroll_cutoff_reminder_emails: 'Cutoff reminder recipients',
  }
  const labelFor = (key: string) => labels[key] ?? key
  const everywhere = () => true

  it("replaces the server's internal name with the label on the page", () => {
    expect(mapServerSettingError('Daily overtime threshold must be greater than 0', labelFor, everywhere))
      .toEqual({ key: 'overtime_daily_threshold_hours', message: 'Daily hours review alert must be greater than 0.' })
    expect(mapServerSettingError('Clock-in radius must be greater than 0 meters before enabling location enforcement', labelFor, everywhere))
      .toEqual({ key: 'clock_in_location_radius_meters', message: 'Allowed radius must be greater than 0 meters before enabling location enforcement.' })
    expect(mapServerSettingError('Set a valid clock-in latitude and longitude before enabling location enforcement', labelFor, everywhere)?.message)
      .toBe('Latitude: enter a valid latitude and longitude before turning the location check on.')
    expect(mapServerSettingError('Enter valid reminder email addresses', labelFor, everywhere))
      .toEqual({ key: 'payroll_cutoff_reminder_emails', message: 'Cutoff reminder recipients: enter valid email addresses, for example chels@example.com.' })
  })

  it('leaves other messages, and fields not on this page, alone', () => {
    expect(mapServerSettingError('Something else broke', labelFor, everywhere)).toBeNull()
    expect(mapServerSettingError('Daily overtime threshold must be greater than 0', labelFor, () => false)).toBeNull()
  })
})
