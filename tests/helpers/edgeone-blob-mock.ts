export class MockPreconditionFailedError extends Error {
  code = 'PRECONDITION_FAILED'

  constructor(message = 'Precondition failed') {
    super(message)
    this.name = 'PreconditionFailedError'
  }
}

export type MockMetadata = {
  bytes: number
  contentType?: string
  etag?: string
}

export class MemoryBlobStore {
  readonly json = new Map<string, unknown>()
  readonly metadata = new Map<string, MockMetadata>()
  readonly deleted: string[] = []
  readonly uploadUrls: string[] = []
  storeName = 'test-transfer-store'

  async get(key: string) {
    return this.json.has(key) ? this.json.get(key) : null
  }

  async setJSON(key: string, value: unknown, options: { onlyIfNew?: boolean } = {}) {
    if (options.onlyIfNew && this.json.has(key)) throw new MockPreconditionFailedError()
    this.json.set(key, structuredClone(value))
  }

  async delete(key: string) {
    this.deleted.push(key)
    this.json.delete(key)
    this.metadata.delete(key)
  }

  async list(options: { prefix?: string } = {}) {
    const prefix = options.prefix || ''
    const keys = new Set([...this.json.keys(), ...this.metadata.keys()])
    return {
      blobs: [...keys]
        .filter(key => key.startsWith(prefix))
        .sort()
        .map(key => ({ key, etag: this.metadata.get(key)?.etag || 'mock-etag' }))
    }
  }

  async createUploadUrl(key: string, options: { expireSeconds: number }) {
    const url = `https://upload.invalid/${encodeURIComponent(key)}`
    this.uploadUrls.push(url)
    return { url, expiresAt: Date.now() + options.expireSeconds * 1000 }
  }

  async getMetadata(key: string) {
    const item = this.metadata.get(key)
    if (!item) throw new Error(`Object not found: ${key}`)
    return {
      headers: { 'content-length': String(item.bytes) },
      contentType: item.contentType || 'application/octet-stream',
      etag: item.etag || 'mock-etag'
    }
  }
}

export function base64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url')
}

export async function sha256Base64url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(digest).toString('base64url')
}
