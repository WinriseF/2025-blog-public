import { describe, expect, it } from 'vitest'
import {
  createTransferEncryptionContext,
  decryptTransferChunk,
  deriveTransferProof,
  encryptTransferChunk
} from '../../src/lib/transfer-crypto'
import type { TransferPublicMeta } from '../../src/lib/transfer-types'

function meta(salt: string): TransferPublicMeta {
  return {
    code: 'ABC234',
    kind: 'file',
    name: 'x.bin',
    contentType: 'application/octet-stream',
    size: 5,
    salt,
    status: 'ready',
    expireAt: Date.now() + 60_000,
    createdAt: Date.now(),
    chunked: true,
    chunkSize: 4 * 1024 * 1024,
    chunkCount: 1,
    chunks: [{ index: 0, iv: 'AAAAAAAAAAAAAAAA', plainSize: 5, cipherSize: 21 }]
  }
}

describe('transfer crypto', () => {
  it('round-trips arbitrary bytes through AES-GCM', async () => {
    const context = await createTransferEncryptionContext('correct horse battery staple')
    const plain = crypto.getRandomValues(new Uint8Array(1024))
    const encrypted = await encryptTransferChunk(plain, context.key)
    const decrypted = await decryptTransferChunk(encrypted.cipher.buffer as ArrayBuffer, context.key, encrypted.iv)
    expect(decrypted).toEqual(plain)
  })

  it('derives the same proof from the same password and salt', async () => {
    const context = await createTransferEncryptionContext('same-password')
    const again = await deriveTransferProof('same-password', meta(context.salt))
    expect(again.proof).toBe(context.proof)
  })

  it('rejects decryption with a wrong password-derived key', async () => {
    const context = await createTransferEncryptionContext('right-password')
    const encrypted = await encryptTransferChunk(new TextEncoder().encode('hello'), context.key)
    const wrong = await deriveTransferProof('wrong-password', meta(context.salt))
    await expect(decryptTransferChunk(encrypted.cipher.buffer as ArrayBuffer, wrong.key, encrypted.iv)).rejects.toBeTruthy()
  })

  it('does not reuse IVs across independently encrypted chunks by default', async () => {
    const context = await createTransferEncryptionContext('password')
    const plain = new Uint8Array([1, 2, 3])
    const a = await encryptTransferChunk(plain, context.key)
    const b = await encryptTransferChunk(plain, context.key)
    expect(a.iv).not.toBe(b.iv)
    expect(Buffer.from(a.cipher).equals(Buffer.from(b.cipher))).toBe(false)
  })
})
