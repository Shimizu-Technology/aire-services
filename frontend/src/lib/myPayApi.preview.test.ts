import { describe, expect, it } from 'vitest'
import { myPayPreviewApi } from './myPayApi'

describe('myPayPreviewApi', () => {
  it('rejects a malformed worker ID through the promise instead of throwing', async () => {
    let result: Promise<unknown> | undefined
    expect(() => { result = myPayPreviewApi.worker('not-a-number') }).not.toThrow()
    await expect(result).rejects.toMatchObject({ code: 'worker_not_found' })
  })

  it('rejects a malformed statement ID for a previewed worker the same way', async () => {
    let result: Promise<unknown> | undefined
    expect(() => { result = myPayPreviewApi.source('7').statement('abc') }).not.toThrow()
    await expect(result).rejects.toMatchObject({ code: 'statement_not_found' })
  })
})
