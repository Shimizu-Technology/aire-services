import { describe, expect, it } from 'vitest'

import { teamCountSummary } from './teamCounts'

const active = { is_active: true, employment_status: 'active' }
const ended = { is_active: false, employment_status: 'terminated' }
const inactive = { is_active: false, employment_status: 'inactive' }

describe('teamCountSummary', () => {
  it('explains why the whole team is larger than the active count', () => {
    const people = [...Array.from({ length: 30 }, () => active), ended]
    expect(teamCountSummary(1, people)).toBe('1 matching person · 30 active, 1 ended in total')
  })

  it('pluralizes matches and names inactive people separately', () => {
    expect(teamCountSummary(4, [active, active, ended, ended, inactive])).toBe('4 matching people · 2 active, 2 ended, 1 inactive in total')
  })

  it('stays short when everyone is active', () => {
    expect(teamCountSummary(0, [active])).toBe('0 matching people · 1 active in total')
  })
})
