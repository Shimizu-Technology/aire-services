# Match a reported payment to exact existing issued evidence

`payment_attestation_resolution_v1` is an optional, explicitly verified Source capability. It permits an authorized Payroll operator to match one unchanged reported entry, in full, to one existing issued payroll item. It creates a Source allocation receipt; it does not create a paycheck, move money, recalculate payroll, or withdraw the original report.

Payroll must first verify its native issued evidence: a delivered check for the current instrument or a confirmed bank payment. Commitment, printing, a prepared instrument and an owner statement do not prove issuance. Payroll derives the payment tuple and native event identity on the server, verifies company/employee mapping and separate REG/OT capacity, and durably reserves those hours before sending the command. Cross-period adjustment items are supported.

## Review and command

The authorized attestation read returns `resolution_context` with `available`, `reason`, decimal-string `regular_hours`, `overtime_hours`, `total_hours` and a SHA256 `weekly_context_fingerprint`. An unavailable context returns a review reason and null hours/fingerprint. It contains no sibling-entry personal data.

`POST /api/v1/payroll/cockpit/payment_attestations/:id/resolve` takes:

```text
command_id                          UUID; reused unchanged for retries
expected_version                    attestation optimistic version
source_time_entry_id
source_time_entry_version            original held entry version
source_user_uuid
work_date                           original work date, YYYY-MM-DD
regular_hours, overtime_hours        complete authoritative Source portion
expected_weekly_context_fingerprint  exact fingerprint from Source review
external_pay_period_id
external_payroll_item_id
pay_date                            actual payroll item's scheduled date
payment_method                      paper_check / direct_deposit
payment_reference
payment_effective_on                actual payment date, YYYY-MM-DD
occurred_at                         native evidence recording time, explicit offset
payroll_payment_event_type          delivered_check / direct_deposit_confirmation
payroll_payment_event_id            original native evidence ID, opaque string
reason                              at least 20 characters
```

Shared-service authentication and an active linked administrator or permitted `settlement_case_management` delegation are required. The Source installation pin must match. Payroll enforces its organization/company permissions and test-workspace policy. Source trusts this authenticated Payroll command's native event assertion; it does not query Payroll or use the original owner report as payment proof.

## Source transaction and receipt

The command takes the existing finalization advisory lock, then short SHARE locks on time entries, breaks and revision history, then the attestation/entry locks. The table locks finish in-flight source changes and prevent new sibling writes until receipt commitment. User identity is locked and refreshed before validation.

Source reconstructs the employee's complete countable week from its immutable revision ledger at reporting and review time. It requires unchanged canonical weekly entries and the original held identity/version/date/hours. It compares the submitted fingerprint to the current canonical context and verifies each complete REG/OT component. A new, edited, reclassified or newly approved sibling requires historical review even if the held entry's version stayed the same. Missing original ledger coverage also fails closed. Published calendar policy must be supported. Partial portions, pending/denied payable overtime, batch representation and existing active manual coverage are rejected.

One transaction creates the ordinary committed allocation and its issued event, resolves the original report, appends the report resolution event, applies proof-linked settlement transitions and saves the immutable command receipt. No intermediate remote commitment or released hold is visible. Ordinary manual linking remains blocked by a pending report.

Fresh success and exact replay return the same captured snapshots:

```text
command: { id, replayed }
integration: captured Source installation descriptor
payment_attestation: original identity + resolved anchors + resolution_evidence
manual_allocation: complete issued allocation + issued_payment
command_result:
  payment_attestation_id
  expected_version, result_version, status: resolved
  payment_attestation
  manual_allocation_id
  manual_allocation_expected_version, manual_allocation_result_version
  manual_allocation
  expected_weekly_context_fingerprint
  payroll_payment_event_type, payroll_payment_event_id
  integration
```

The attestation version and allocation issue version are separate advancing sequences. `resolution_evidence` retains the accepted fingerprint and native event type/ID. The report anchors the exact Source manual allocation and its immutable original issued event. The receipt excludes duplicated free-text report/reconciliation reasons; those remain in protected history. Replays use captured evidence even after cancellation, replacement or a later capability change. They prove the original command's historical result, not a fresh issuance or the present payment status.

Payroll must validate the complete receipt against its saved intent, including installation/contract, command, expected/result versions, snapshots, full identity and hours, actual item/period, payment tuple/time, native event identity, fingerprint and resolution anchors. Lost responses or rejected receipts preserve the same intent and reserved capacity; retries must not create a replacement command or another payment. All Payroll instrument retirement/void/revision paths must block uncertain resolution until its original receipt is reconciled.

## Cutoff, cancellation and history

Resolution time is the actual recording time; it is never the historical payment date. A resolution after a cutoff retains the original hold for that cutoff's delayed first finalization. Its immutable exclusion remains a hold exclusion, while its settlement case receives exact issued-allocation evidence. Current paid totals come from the normal manual allocation only. Report history adds no second paid-hours component.

Verified instrument cancellation uses the ordinary manual-allocation cancellation command and exact original tuple/version. It preserves committed wage hours, original issue events and the resolved report. A software void alone cannot return issued hours to payable work. Replacement evidence follows the existing cancellation/reissue flow; the report's original resolution anchor remains unchanged.

Changed historical source entries, split payments, standalone checks and REG/OT exceptions are outside this operation. Preserve their reports for separately reviewed reconciliation. This change performs no production-data recovery and does not manufacture missing historical evidence.
