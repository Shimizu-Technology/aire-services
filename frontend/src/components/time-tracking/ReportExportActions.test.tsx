import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ReportExportActions from './ReportExportActions'

describe('ReportExportActions', () => {
  it('makes PDF the primary export for the default all-employee report', () => {
    const onExport = vi.fn()

    render(
      <ReportExportActions
        employeeSelected={false}
        hasResults
        loading={false}
        exporting={null}
        onExport={onExport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /download pdf report/i }))

    expect(onExport).toHaveBeenCalledWith('pdf')
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /detailed csv/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /payroll csv/i })).toBeInTheDocument()
  })

  it('labels the primary PDF as an employee timesheet when one employee is selected', () => {
    const onExport = vi.fn()

    render(
      <ReportExportActions
        employeeSelected
        hasResults
        loading={false}
        exporting={null}
        onExport={onExport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /download timesheet pdf/i }))

    expect(onExport).toHaveBeenCalledWith('pdf')
    expect(screen.getByText(/share-ready employee timesheet/i)).toBeInTheDocument()
  })

  it('disables every export while no report results are available', () => {
    render(
      <ReportExportActions
        employeeSelected={false}
        hasResults={false}
        loading={false}
        exporting={null}
        onExport={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button')).toHaveLength(3)
    screen.getAllByRole('button').forEach((button) => expect(button).toBeDisabled())
  })
})
