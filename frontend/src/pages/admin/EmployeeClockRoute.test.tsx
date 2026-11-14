import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { capabilitiesFor, type UserRole } from '../../lib/roles'
import EmployeeClockRoute from './EmployeeClockRoute'

const viewer = vi.hoisted(() => ({ role: 'employee' as UserRole }))
vi.mock('../../lib/useCapabilities', () => ({
  useCapabilities: () => capabilitiesFor(viewer.role),
}))
vi.mock('./Dashboard', () => ({
  MyTimeHome: () => <p>Existing supervisor clock with override</p>,
}))
vi.mock('./MyTime', () => ({ default: () => <p>Employee clock</p> }))

it('gives employees the new Clock', () => {
  viewer.role = 'employee'
  render(<EmployeeClockRoute />)
  expect(screen.getByText('Employee clock')).toBeInTheDocument()
  expect(screen.queryByText(/supervisor clock/)).not.toBeInTheDocument()
})

it.each(['manager', 'admin', 'owner'] as const)(
  'keeps Dashboard.MyTimeHome for a %s',
  (role) => {
    viewer.role = role
    render(<EmployeeClockRoute />)
    expect(
      screen.getByText('Existing supervisor clock with override'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Employee clock')).not.toBeInTheDocument()
  },
)
