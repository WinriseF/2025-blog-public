import { describe, expect, it, vi } from 'vitest'
import { LanAttachmentSendScheduler } from '../../src/lib/lan-transfer/attachment-send-scheduler'
import { LAN_LIMITS, type PreparedLanAttachment } from '../../src/lib/lan-transfer/types'

function prepared(id: string, size: number, kind: 'file' | 'image' = 'file'): PreparedLanAttachment {
  const chunkSize = Math.min(Math.max(1, size), 256 * 1024)
  return {
    id, messageId: `m-${id}`, kind, name: `${id}.bin`, mime: 'application/octet-stream', size, lastModified: 1,
    chunkSize, chunkCount: Math.max(1, Math.ceil(size / chunkSize)), suggestedStorage: 'memory', dataPlane: 'webrtc',
    file: new File([new Uint8Array(size)], `${id}.bin`)
  }
}

function transport() {
  return {
    id: 't', bufferedAmount: 0,
    isOpen: vi.fn(() => true), send: vi.fn(() => true), negotiateChunkSize: vi.fn(), waitUntilWritable: vi.fn(async () => {})
  } as any
}

function callbacks() {
  return {
    createCompleteMessage: vi.fn((file: PreparedLanAttachment) => ({ type: 'attachment-complete', protocolVersion: 14, id: file.id, messageId: file.messageId, sent: file.size, chunkCount: file.chunkCount } as any)),
    onTaskStarted: vi.fn(), onTaskConfirming: vi.fn(), onTaskError: vi.fn(), onTransportStalled: vi.fn()
  }
}

describe('LAN attachment send scheduler', () => {
  it('limits active tasks differently for desktop and mobile', () => {
    const cb = callbacks(); const scheduler = new LanAttachmentSendScheduler(cb)
    scheduler.attach(transport(), false)
    for (let i = 0; i < 8; i++) scheduler.upsert(prepared(`f${i}`, LAN_LIMITS.schedulerPriorityMaxBytes + 1), 0, [])
    ;(scheduler as any).admitTasks((scheduler as any).context)
    expect([...((scheduler as any).tasks as Map<string, any>).values()].filter(task => task.active)).toHaveLength(LAN_LIMITS.schedulerMaxActive)
    scheduler.setMobile(true)
    ;(scheduler as any).admitTasks((scheduler as any).context)
    expect([...((scheduler as any).tasks as Map<string, any>).values()].filter(task => task.active)).toHaveLength(LAN_LIMITS.mobileSchedulerMaxActive)
  })

  it('lets an urgent image displace a non-priority active task', () => {
    const scheduler = new LanAttachmentSendScheduler(callbacks())
    scheduler.attach(transport(), true)
    scheduler.upsert(prepared('large-a', LAN_LIMITS.schedulerPriorityMaxBytes + 1), 0, [])
    scheduler.upsert(prepared('large-b', LAN_LIMITS.schedulerPriorityMaxBytes + 1), 0, [])
    ;(scheduler as any).admitTasks((scheduler as any).context)
    scheduler.upsert(prepared('image', 1024, 'image'), 0, [])
    ;(scheduler as any).admitTasks((scheduler as any).context)
    const tasks = (scheduler as any).tasks as Map<string, any>
    expect(tasks.get('image').active).toBe(true)
    expect([...tasks.values()].filter(task => task.active)).toHaveLength(LAN_LIMITS.mobileSchedulerMaxActive)
  })

  it('keeps acknowledgements monotonic and clamps them to file size', () => {
    const scheduler = new LanAttachmentSendScheduler(callbacks())
    scheduler.attach(transport(), false)
    const file = prepared('a', 100)
    scheduler.upsert(file, 50, [])
    scheduler.updateAck(file.id, 25)
    expect((scheduler as any).tasks.get(file.id).ackedBytes).toBe(50)
    scheduler.updateAck(file.id, 999)
    expect((scheduler as any).tasks.get(file.id).ackedBytes).toBe(100)
  })

  it('sends a one-chunk attachment and enters confirming state', async () => {
    const cb = callbacks(); const t = transport(); const scheduler = new LanAttachmentSendScheduler(cb)
    const file = prepared('one', 32, 'image')
    scheduler.attach(t, false)
    scheduler.upsert(file, 0, [])
    scheduler.resume()
    await vi.waitFor(() => expect(cb.onTaskConfirming).toHaveBeenCalledWith(file))
    expect(cb.onTaskStarted).toHaveBeenCalledWith(file)
    expect(t.send).toHaveBeenCalledTimes(2)
    expect((scheduler as any).tasks.get(file.id).state).toBe('confirming')
    expect(cb.onTaskError).not.toHaveBeenCalled()
    scheduler.detach()
  })

  it('removing the current task aborts its active controller', () => {
    const scheduler = new LanAttachmentSendScheduler(callbacks())
    scheduler.attach(transport(), false)
    const file = prepared('a', 10)
    scheduler.upsert(file, 0, [])
    ;(scheduler as any).currentTaskId = file.id
    const signal = (scheduler as any).context.controller.signal as AbortSignal
    scheduler.remove(file.id)
    expect(signal.aborted).toBe(true)
    expect(scheduler.hasPendingTransfer()).toBe(false)
  })
})
