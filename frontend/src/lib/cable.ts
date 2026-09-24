// @ts-expect-error — @rails/actioncable has no published type declarations
import { createConsumer, type Consumer, type Subscription } from '@rails/actioncable'
import { cableUrl } from './apiBase'

let consumer: Consumer | null = null

type TokenProvider = () => Promise<string | null>

/**
 * Create or refresh the ActionCable consumer using a fresh JWT.
 * Token is passed via query param (only option for cross-origin API-only Rails).
 * Server-side `filter_parameters` redacts `:token` from logs.
 * Clerk JWTs are short-lived (~60s), so we fetch a fresh one on every connect.
 */
export async function getOrCreateConsumer(getToken: TokenProvider): Promise<Consumer | null> {
  const token = await getToken()
  if (!token) return null

  if (consumer) consumer.disconnect()
  consumer = createConsumer(cableUrl(token))
  return consumer
}

export function disconnectConsumer(): void {
  if (consumer) {
    consumer.disconnect()
    consumer = null
  }
}

export type { Consumer, Subscription }
