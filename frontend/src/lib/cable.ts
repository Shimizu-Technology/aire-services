// @ts-expect-error — @rails/actioncable has no published type declarations
import { createConsumer, type Consumer, type Subscription } from '@rails/actioncable'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

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
  consumer = createConsumer(`${WS_BASE}/cable?token=${encodeURIComponent(token)}`)
  return consumer
}

export function disconnectConsumer(): void {
  if (consumer) {
    consumer.disconnect()
    consumer = null
  }
}

export type { Consumer, Subscription }
