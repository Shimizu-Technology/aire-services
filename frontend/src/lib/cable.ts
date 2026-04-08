// @ts-expect-error — @rails/actioncable has no published type declarations
import { createConsumer, type Consumer, type Subscription } from '@rails/actioncable'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

let consumer: Consumer | null = null
let currentToken: string | null = null

// Token is passed via query param (only option for cross-origin API-only Rails).
// Server-side `filter_parameters` redacts it from logs. Clerk JWTs are short-lived (~60s).
export function getConsumer(token: string): Consumer {
  if (consumer && currentToken === token) return consumer
  if (consumer) consumer.disconnect()
  currentToken = token
  consumer = createConsumer(`${WS_BASE}/cable?token=${encodeURIComponent(token)}`)
  return consumer
}

export function disconnectConsumer(): void {
  if (consumer) {
    consumer.disconnect()
    consumer = null
    currentToken = null
  }
}

export type { Consumer, Subscription }
