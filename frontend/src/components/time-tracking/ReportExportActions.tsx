import type { HoursReportDownloadType } from '../../lib/api'

interface ReportExportActionsProps {
  employeeSelected: boolean
  hasResults: boolean
  loading: boolean
  exporting: HoursReportDownloadType | null
  onExport: (type: HoursReportDownloadType) => void
}

const PdfIcon = () => (
  <svg className="h-5 w-5" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 3h7l4 4v14H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14 3v5h5M8.5 16.5h7M8.5 13h7" />
  </svg>
)

const SpreadsheetIcon = () => (
  <svg className="h-4 w-4" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM4 9h16M9 9v12M15 9v12M4 15h16" />
  </svg>
)

export default function ReportExportActions({
  employeeSelected,
  hasResults,
  loading,
  exporting,
  onExport,
}: ReportExportActionsProps) {
  const disabled = loading || exporting !== null || !hasResults
  const pdfLabel = employeeSelected ? 'Download Timesheet PDF' : 'Download PDF Report'

  return (
    <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
      <button
        type="button"
        onClick={() => onExport('pdf')}
        disabled={disabled}
        aria-busy={exporting === 'pdf'}
        className="group inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-primary-dark hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 sm:w-auto"
      >
        <PdfIcon />
        <span>{exporting === 'pdf' ? 'Preparing PDF...' : pdfLabel}</span>
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">Recommended</span>
      </button>

      <div className="flex flex-col gap-2 sm:items-end">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">Spreadsheet exports</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onExport('detailed_csv')}
            disabled={disabled}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-primary/25 bg-white px-3 py-2 text-xs font-semibold text-primary transition hover:border-primary/45 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SpreadsheetIcon />
            {exporting === 'detailed_csv' ? 'Preparing...' : 'Detailed CSV'}
          </button>
          <button
            type="button"
            onClick={() => onExport('summary_csv')}
            disabled={disabled}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-neutral-warm bg-white px-3 py-2 text-xs font-semibold text-primary-dark transition hover:bg-neutral-warm/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SpreadsheetIcon />
            {exporting === 'summary_csv' ? 'Preparing...' : 'Payroll CSV'}
          </button>
        </div>
      </div>

      <p className="max-w-md text-xs leading-relaxed text-text-muted sm:text-right">
        {employeeSelected
          ? "The PDF is the share-ready employee timesheet and includes the full approved or standard ledger for these dates."
          : 'The PDF is the recommended share-ready report for all matching employees, with summary totals and detailed time entries.'}
      </p>
    </div>
  )
}
