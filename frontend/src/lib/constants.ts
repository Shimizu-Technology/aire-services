// Filing status database values to human-readable labels
export const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married: "Married Filing Jointly",
  married_joint: "Married Filing Jointly",
  married_separate: "Married Filing Separately",
  hoh: "Head of Household",
  head_of_household: "Head of Household",
  widow: "Qualifying Widow(er)",
  qualifying_widow: "Qualifying Widow(er)",
  other: "Other",
}

// Get human-readable filing status label, with fallback
export function getFilingStatusLabel(status: string | null | undefined): string {
  if (!status) return "—"
  return FILING_STATUS_LABELS[status] || status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}
