import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('LAN V14 controller contracts', () => {
  it('has a stable room route and fragment-only invite secret', () => {
    expect(existsSync(resolve(process.cwd(), 'src/app/t/lan/[roomId]/page.tsx'))).toBe(true)
    const sessionStore = read('src/lib/lan-transfer/session-store.ts')
    expect(sessionStore).toContain('/t/lan/${encodeURIComponent(session.roomId)}#k=')
    expect(sessionStore).toMatch(/restoreLanSession/)
  })

  it('starts signaling before background capability detection', () => {
    const controller = read('src/app/toolbox/use-lan-transfer-controller.ts')
    const activation = controller.slice(controller.indexOf('const activateSession'), controller.indexOf('const handleCreateRoom'))
    expect(activation.indexOf('startSignaling(next)')).toBeGreaterThanOrEqual(0)
    expect(activation.indexOf('startSignaling(next)')).toBeLessThan(activation.indexOf('detectCapabilityInBackground(next)'))
    expect(activation).not.toMatch(/await detectLanCapability/)
  })

  it('does not erase LAN persistence when the relay tool mounts', () => {
    const transferTool = read('src/app/toolbox/transfer-tool.tsx')
    expect(transferTool).not.toContain('cleanupLanTransferPersistentStorage')
    expect(transferTool).not.toContain('sessionStorage')
  })
})
