# AIRE production readiness

AIRE is the source of time and cutoff facts for connected payroll. A healthy homepage is not enough to release that workflow: the database, scheduler, worker, object storage, identity provider, email provider, and Cornerstone destination must all be healthy together.

This gate never creates or changes a payroll, time entry, employee, or customer record. Its live probes:

- query the database and confirm migrations are current;
- require a recent Solid Queue worker heartbeat and the cutoff/delivery schedules;
- upload, read, and delete one random object under `production-readiness/`;
- authenticate to Clerk and verify the configured JWKS endpoint;
- authenticate to Resend and verify the effective sender domain;
- call Cornerstone's public `/up` endpoint without sending payroll data; and
- fail if a payroll event has remained pending or failed for more than ten minutes.

Provider responses, secrets, payroll values, and personal information are not printed. The random storage object is removed even when read-back fails.

## Run the automated gate

Run this from the deployed Render shell:

```bash
RAILS_ENV=production bin/rails production:readiness
```

Keep the final `EVIDENCE` line with the release record. Every check must pass on the exact deployed revision.

`REQUIRE_MFA=true` is an operational attestation, not an MFA implementation. Set it only after AIRE uses a production Clerk instance, registration is restricted to the approved invitation policy, and at least two recovery administrators have tested MFA enrollment and recovery. Record the exact Clerk instance ID in `CLERK_MFA_ATTESTED_INSTANCE_ID` and a single-line pointer to the retained, independently reviewed cutover evidence in `CLERK_MFA_EVIDENCE_REF`. The live gate authenticates to Clerk and requires the provider's instance ID to match that recorded ID; Clerk's instance endpoint does not expose MFA policy, so the evidence record must document the policy and recovery test directly.

## Manual evidence that still requires people

- Name the primary and backup incident, payroll-correction, client-communication, and rollback owners.
- Verify encrypted database backups by restoring to an isolated provider branch, reconciling counts, obtaining a second review, and destroying the branch after the drill.
- Verify S3 versioning or backup recovery with an approved non-production object and retain only its key, size, and digest.
- Trigger safe synthetic alerts for API health, worker heartbeat, cutoff finalization, outbox delivery, storage, and authentication failures; record receipt by the primary and backup recipients.
- Have Chels complete the local Cornerstone-only operator drill, followed by the separately approved production shadow and supervised first live cycles.

Do not use a real production pay period for readiness testing. Do not copy production payroll data to a developer machine.
