import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import EmployeeRelatedRecords from './EmployeeRelatedRecords'
const api = vi.hoisted(() => ({ schedule: vi.fn(), activity: vi.fn() }))
vi.mock('../../lib/employeeEvidenceApi', () => ({ employeeEvidenceApi: api }))
beforeEach(() => { api.schedule.mockReset(); api.schedule.mockResolvedValue({ schedules: [] }) })
it('retains the original schedule week from a connected employee link', async () => {
 render(<MemoryRouter initialEntries={['/admin/users/7?tab=schedule&start_date=2024-08-15']}><EmployeeRelatedRecords employeeId="7" kind="schedule" returnTo="/admin/schedule?start_date=2024-08-11" /></MemoryRouter>)
 await waitFor(() => expect(api.schedule).toHaveBeenCalledWith('7', '2024-08-11', expect.any(AbortSignal)))
 expect(screen.getByLabelText('Employee schedule week')).toHaveValue('2024-08-11')
})
