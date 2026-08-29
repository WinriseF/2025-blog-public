import { describe, expect, it } from 'vitest'
import { videoErrorMessage } from '../../src/lib/video-compress/media'

describe('video compression error mapping', () => {
  it('maps browser filesystem failures to user-facing Chinese messages', () => {
    expect(videoErrorMessage(new DOMException('denied', 'NotAllowedError'))).toMatch(/权限/)
    expect(videoErrorMessage(new DOMException('full', 'QuotaExceededError'))).toMatch(/空间不足/)
    expect(videoErrorMessage(new DOMException('busy', 'NotReadableError'))).toMatch(/无法读取/)
  })

  it('normalizes encoder/decoder/format failures', () => {
    expect(videoErrorMessage(new Error('No encodable video configuration'))).toMatch(/H\.264/)
    expect(videoErrorMessage(new Error('decoder failed'))).toMatch(/无法解码/)
    expect(videoErrorMessage(new Error('cannot recognize input format'))).toMatch(/无法识别/)
  })
})
