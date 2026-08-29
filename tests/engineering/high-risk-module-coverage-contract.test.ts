import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const highRisk = [
  'src/lib/lan-transfer/connection-runtime.ts',
  'src/lib/lan-transfer/native-webrtc-transport.ts',
  'src/lib/lan-transfer/native-file-runtime.ts',
  'src/lib/lan-transfer/attachment-send-scheduler.ts',
  'src/lib/lan-transfer/reconnect-coordinator.ts',
  'src/lib/version-control/store.ts',
  'src/lib/version-control/bridge.ts',
  'src/lib/version-control/github-rest-repository-data-source.ts',
  'src/lib/lan-transfer/storage/opfs-storage.ts'
]

function collectTests(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectTests(path))
    else if (/\.test\.(?:ts|tsx|mjs|js)$/.test(entry.name)) files.push(path)
  }
  return files
}

function testCorpus() {
  return collectTests(resolve(process.cwd(), 'tests')).map(path => readFileSync(path, 'utf8')).join('\n')
}

describe('high-risk module test coverage contract', () => {
  it('keeps every high-risk production module present', () => {
    for (const file of highRisk) expect(existsSync(resolve(process.cwd(), file)), file).toBe(true)
  })

  it('requires every high-risk module to have either direct tests or an explicit source contract', () => {
    const corpus = testCorpus()
    const missing = highRisk.filter(file => {
      const base = file.split('/').at(-1)!.replace(/\.tsx?$/, '')
      return !corpus.includes(file) && !corpus.includes(base)
    })
    expect(missing, `High-risk modules without a named test/contract: ${missing.join(', ')}`).toEqual([])
  })

})
