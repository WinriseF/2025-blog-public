import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const client = () => readFileSync(resolve(process.cwd(), 'src/lib/transfer-relay.ts'), 'utf8')
const crypto = () => readFileSync(resolve(process.cwd(), 'src/lib/transfer-crypto.ts'), 'utf8')
const serverPath = resolve(process.cwd(), 'edge-functions/api/transfer/[[default]].js')

describe('public relay client security contracts', () => {
  it('encrypts every chunk locally before PUT upload', () => {
    const text = client(); expect(text).toMatch(/encryptTransferChunk/); expect(text).toMatch(/uploadCipher/)
  })
  it.skipIf(!existsSync(serverPath))('uses independent IVs and rejects duplicate IVs server-side when EdgeOne source is present', () => {
    expect(client()).toMatch(/usedIvs/)
    expect(readFileSync(serverPath, 'utf8')).toMatch(/Duplicate chunk iv/)
  })
  it('derives AES-GCM keys with PBKDF2-SHA256 and a random salt', () => {
    const text = crypto(); expect(text).toMatch(/PBKDF2/); expect(text).toMatch(/SHA-256/); expect(text).toMatch(/AES-GCM/); expect(text).toMatch(/new Uint8Array\(16\)/)
  })
  it('does not send the plaintext password to create/open endpoints', () => {
    const text = client(); expect(text).toMatch(/proof/); expect(text).not.toMatch(/JSON\.stringify\(\{[^}]*password/s)
  })
})
