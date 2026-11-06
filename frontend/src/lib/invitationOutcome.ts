import type { InvitationEmailOutcome } from './api'

export function invitationOutcomeMessage(outcome: InvitationEmailOutcome | undefined, requested: boolean, resendAcknowledged = false): string {
  if (!requested) return 'You can send their invitation later from the user list.'
  if (outcome?.invitation_email_captured) return 'Captured in staging (not sent).'
  if (outcome?.invitation_email_queued) return 'Invitation queued for email delivery.'
  // The synchronous resend endpoint returns a success message only after submission;
  // create/update instead return the explicit invitation_email_sent flag.
  if (outcome?.invitation_email_sent === true || (resendAcknowledged && outcome?.invitation_email_sent !== false)) {
    return 'Invitation submitted to the email provider.'
  }
  return 'Invitation email failed. You can retry from the user list.'
}
