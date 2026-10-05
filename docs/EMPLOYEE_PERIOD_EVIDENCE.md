# Employee period evidence, version 1.0

The Team employee workspace reviews current source work alongside retained payroll evidence. Original work dates determine each work period; destination payroll runs are references, so carrying hours into a later run does not create another copy of worked hours.

## Read contract

Administrator routes are `GET /api/v1/admin/users/:user_id/periods` and `/periods/:id`. Connected payroll routes are `GET /api/v1/payroll/cockpit/employees/:employee_id/periods` and `/periods/:id`. The integration must authenticate its service connection and an authorized administrator with the `settlement_case_management` capability. Its `source_user_uuid` query must equal the employee's stable integration UUID. The producer advertises `employee_period_evidence_v1`.

`start_date` and `end_date` filter original work dates inclusively. AIRE work-period IDs use the first or sixteenth of the month, expressed as `YYYY-MM-DD`. Period lists accept `per_page` from 1 to 100 (default 20) and a signed `cursor`. Detail accepts `detail_per_page` from 1 to 100 (default 100) and a signed `detail_cursor`. Cursors bind employee UUID and date filters; detail cursors also bind period, page size and optional exact entry.

The envelope includes the installation descriptor, contract version, exact employee identity, filters, refresh time, and evidence limitations. List totals cover the whole filtered result, regardless of page size. Detail summaries cover every detail page; `detail_pagination.counts` reports the complete entry, coverage-line and settlement-case counts. `entry_id` optionally selects an exact current or retained source entry in that original period, including entries beyond the first detail page; detail collection counts then describe that entry while the summary remains the complete period total. An entry absent from this employee and period returns not found. Each collection has its own deterministic ordering and uses the same page offset. Empty collections on a later page do not mean their evidence is absent.

## Meaning of the hours

Current REG/OT follows approved source time with full Sunday–Saturday context, including adjacent periods. Awaiting approval and denied time are separate. Current eligibility excludes pending/denied weekly OT. Active issued, committed/unissued and exported/uncommitted source coverage is calculated from exact payable lines and manual allocations. Signed corrections remain signed; voided lines remain visible but do not provide active coverage.

Frozen source REG/OT remains visible on each saved line; aggregate frozen REG/OT includes only active source coverage, so voids and their replacements are not counted twice. It can differ from the current classification. Source coverage does **not** establish actual paycheck REG/OT, rates, gross/net or money owed. Version 1 returns `actual_check_components: null` and `amount_owed: null`; the connected payroll application supplies its own saved paycheck evidence. Missing coverage is **Needs reconciliation**, not proof of unpaid wages.

Former, kiosk-only and reactivated people retain their history. A salary-only person with time tracking disabled is not flagged for having no entries. Current intern status does not establish historical compensation. Deleted or reassigned current entries cannot move frozen evidence to another person. A verified frozen UUID identifies the owner even when its saved numeric user ID differs from the current profile; that saved ID remains visible and unchanged. Rows with the current numeric ID but a different UUID remain identity-review evidence and provide no current-person coverage. Unrelated UUID and numeric owners are excluded. Null frozen UUIDs remain null, require review and never receive active coverage credit; known mismatches remain visible as identity-review evidence and cannot provide coverage to the current identity. Uncategorized current entries also require review. `retained_uncategorized_line_count` separately flags frozen lines with a missing saved category, including source-only or deleted work. `source_category_id` remains null on those lines; current categories never replace saved evidence.

Batch-only reported payment/commit status remains visible with `receipt_scope: batch` and `coverage_state: receipt_review`; it cannot establish exact-line coverage. Legacy per-entry receipts are compatible only when exactly one frozen payable line exists for that source entry in the batch. Multiple-line legacy receipts are ambiguous and receive no active coverage credit. `receipt_review_count` flags these cases without inferring money owed. Exact payable-line receipts remain authoritative source coverage.

## Limits and navigation

Aggregation is synchronous and limited to 50,000 rows per evidence collection, including weekly context and receipts. Larger filters return an explicit error asking for a narrower date range; they never return truncated totals or a false empty result. This is a bounded operational read model, not an unlimited archive query.

The canonical record is `/admin/users/:id`. Tab, work-date filters, period, entry and both cursors belong in URL state. Related links retain the exact employee and a local `/admin` return path. Producers do not supply arbitrary external links. Cross-application origins and mappings must be validated by the connected payroll system before constructing reciprocal navigation.

The read model performs no historical financial apply, payment issuance, identity reassignment or adjustment of frozen records. Historical conclusions and unresolved exceptions remain part of the separate approved reconciliation workflow.
