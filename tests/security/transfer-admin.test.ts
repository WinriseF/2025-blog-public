import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const modulePath = resolve(process.cwd(), 'edge-functions/api/transfer/admin.js')
const hasEdgeSource = existsSync(modulePath)
const sha256 = async (value: string) => `hash:${value}`
const safeEqual = (a: string, b: string) => a === b
class TransferError extends Error { constructor(public status: number, public code: string, message: string) { super(message) } }
function context(expected = 'hash:secret') { return { env: { TRANSFER_ADMIN_PASSWORD_HASH: expected }, getRequiredEnv: (env: any, name: string) => env[name], sha256, safeEqual, TransferError } as never }

// Some source archives intentionally omit EdgeOne deployment code. Do not crash Vitest at module-resolution time.
describe.skipIf(!hasEdgeSource)('transfer admin authentication', () => {
  async function subject() { return (await import(pathToFileURL(modulePath).href)) as { assertTransferAdminPassword: (input: any, context: any) => Promise<void> } }
  it('accepts the correct password and rejects missing/wrong values', async () => {
    const { assertTransferAdminPassword } = await subject()
    await expect(assertTransferAdminPassword({ password: 'secret' }, context())).resolves.toBeUndefined()
    await expect(assertTransferAdminPassword({}, context())).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    await expect(assertTransferAdminPassword({ password: 'wrong' }, context())).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
  })
  it('does not accept a prefix/suffix of the expected password', async () => {
    const { assertTransferAdminPassword } = await subject()
    await expect(assertTransferAdminPassword({ password: 'secre' }, context())).rejects.toMatchObject({ status: 401 })
    await expect(assertTransferAdminPassword({ password: 'secretx' }, context())).rejects.toMatchObject({ status: 401 })
  })
})
