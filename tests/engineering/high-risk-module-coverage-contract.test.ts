import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const highRisk = [
  ['src/lib/lan-transfer/connection-runtime.ts', 'tests/lan-transfer/runtime-source-contract.test.ts'],
  ['src/lib/lan-transfer/native-webrtc-transport.ts', 'tests/lan-transfer/native-webrtc-transport.test.ts'],
  ['src/lib/lan-transfer/native-file-runtime.ts', 'tests/lan-transfer/native-file-runtime.test.ts'],
  ['src/lib/lan-transfer/attachment-send-scheduler.ts', 'tests/lan-transfer/attachment-send-scheduler.test.ts'],
  ['src/lib/lan-transfer/reconnect-coordinator.ts', 'tests/lan-transfer/reconnect-coordinator.test.ts'],
  ['src/lib/lan-transfer/signal-client.ts', 'tests/lan-transfer/signal-client-recovery.test.ts'],
  ['src/lib/version-control/store.ts', 'tests/version-control/store-behavior.test.ts'],
  ['src/lib/version-control/bridge.ts', 'tests/version-control/bridge-behavior.test.ts'],
  ['src/lib/version-control/github-rest-repository-data-source.ts', 'tests/version-control/github-rest-source-contract.test.ts'],
  ['src/lib/lan-transfer/storage/opfs-storage.ts', 'tests/lan-transfer/opfs-storage.test.ts']
]

function moduleReference(sourcePath: string) {
  return sourcePath.replace(/^src\//, '').replace(/\.tsx?$/, '')
}

describe('high-risk module test coverage contract', () => {
  it('keeps every high-risk production module present', () => {
    for (const [sourcePath] of highRisk) expect(existsSync(resolve(process.cwd(), sourcePath)), sourcePath).toBe(true)
  })

  it('maps every high-risk module to a real test that references that production module', () => {
    for (const [sourcePath, testPath] of highRisk) {
      expect(existsSync(resolve(process.cwd(), testPath)), testPath).toBe(true)
      const testSource = readFileSync(resolve(process.cwd(), testPath), 'utf8')
      expect(testSource, `${testPath} must import or explicitly inspect ${sourcePath}`).toContain(moduleReference(sourcePath))
    }
  })
})
