import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const cwd = process.cwd()
const text = (path: string) => readFileSync(resolve(cwd, path), 'utf8')

describe('project engineering guardrails', () => {
  it('POLICY: package scripts expose a full-project test command, not only Codex Session tests', () => {
    const pkg = JSON.parse(text('package.json')) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts || {}
    const candidates = Object.entries(scripts).filter(([name]) => name === 'test' || name === 'test:full' || name === 'check')
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.some(([, command]) => /vitest/.test(command) && !/tests\/codex-session\b/.test(command))).toBe(true)
  })
})
