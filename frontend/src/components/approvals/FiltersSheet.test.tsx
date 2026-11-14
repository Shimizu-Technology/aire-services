import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import FiltersSheet from './FiltersSheet'
it('expands a period into displayed bounds and validates a one-bound edit without hidden dates', () => {
  const apply = vi.fn()
  render(
    <FiltersSheet
      query={new URLSearchParams('period=2026-08-01')}
      categories={[]}
      people={[]}
      onApply={apply}
      onClose={vi.fn()}
    />,
  )
  expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-01')
  expect(screen.getByLabelText('End date')).toHaveValue('2026-08-15')
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-20' } })
  expect(screen.getByRole('button', { name: 'Apply filters' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-08-31' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  const query = apply.mock.calls[0][0] as URLSearchParams
  expect(query.has('period')).toBe(false)
  expect(query.get('start_date')).toBe('2026-08-20')
  expect(query.get('end_date')).toBe('2026-08-31')
})
