import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractPdfText, type PdfExtractionResult } from '../../src/lib/pdf-text-extractor'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api'

afterEach(() => vi.unstubAllGlobals())

function textItem(str: string, hasEOL = false) {
  return { str, hasEOL }
}

function page(items: Array<ReturnType<typeof textItem>>) {
  return {
    getTextContent: vi.fn(async () => ({ items })),
    cleanup: vi.fn()
  } as unknown as PDFPageProxy
}

function documentWith(...pages: PDFPageProxy[]) {
  return {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1])
  } as unknown as PDFDocumentProxy
}

function options(overrides: Partial<Parameters<typeof extractPdfText>[1]> = {}) {
  return {
    model: 'tiny' as const,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    onPage: vi.fn(),
    ...overrides
  }
}

describe('PDF extraction flow', () => {
  it('extracts native text, preserves line/CJK spacing, and reports page counts', async () => {
    const first = page([
      textItem('Alpha'),
      textItem('Beta native text is long enough', true),
      textItem('中文'),
      textItem('段落')
    ])
    const onProgress = vi.fn()
    const onPage = vi.fn()

    const result = await extractPdfText(documentWith(first), options({ onProgress, onPage }))

    expect(result).toMatchObject({ nativePages: 1, ocrPages: 0 })
    expect(result.pages[0]).toMatchObject({
      pageNumber: 1,
      text: 'Alpha Beta native text is long enough\n中文段落',
      method: 'native',
      confidence: null,
      items: []
    })
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith({ pageNumber: 1, pageCount: 1, stage: 'reading' })
    expect(onPage).toHaveBeenCalledWith(result.pages[0], 1, 0)
    expect(first.cleanup).toHaveBeenCalledTimes(1)
  })

  it('resumes after completed pages without extracting them again', async () => {
    const initialPage = {
      pageNumber: 1,
      text: 'already complete',
      method: 'native' as const,
      confidence: null,
      items: [],
      imageWidth: null,
      imageHeight: null
    }
    const initialResult: PdfExtractionResult = { pages: [initialPage], nativePages: 1, ocrPages: 0 }
    const second = page([textItem('Second page contains enough native text')])
    const documentProxy = {
      numPages: 2,
      getPage: vi.fn(async (pageNumber: number) => pageNumber === 2 ? second : Promise.reject(new Error('page one must not reload')))
    } as unknown as PDFDocumentProxy

    const result = await extractPdfText(documentProxy, options({ initialResult }))

    expect(documentProxy.getPage).toHaveBeenCalledTimes(1)
    expect(documentProxy.getPage).toHaveBeenCalledWith(2)
    expect(result.pages[0]).toBe(initialPage)
    expect(result).toMatchObject({ nativePages: 2, ocrPages: 0 })
  })

  it('cleans up a page and preserves a useful error when text extraction fails', async () => {
    const broken = {
      getTextContent: vi.fn(async () => { throw new Error('damaged text layer') }),
      cleanup: vi.fn()
    } as unknown as PDFPageProxy

    await expect(extractPdfText(documentWith(broken), options())).rejects.toThrow('damaged text layer')
    expect(broken.cleanup).toHaveBeenCalledTimes(1)
  })

  it('stops before reading any page when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const documentProxy = documentWith(page([textItem('unused')]))

    await expect(extractPdfText(documentProxy, options({ signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' })
    expect(documentProxy.getPage).not.toHaveBeenCalled()
  })

  it('runs the rendered-page OCR branch and terminates its worker', async () => {
    const renderTask = { promise: Promise.resolve(), cancel: vi.fn() }
    const shortPage = {
      getTextContent: vi.fn(async () => ({ items: [textItem('short')] })),
      getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 50 * scale })),
      render: vi.fn(() => renderTask),
      cleanup: vi.fn()
    } as unknown as PDFPageProxy
    const canvas = {
      width: 0,
      height: 0,
      toBlob: vi.fn((callback: (blob: Blob) => void) => callback(new Blob(['image'])))
    }
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })

    const listeners = new Map<string, Set<(event: any) => void>>()
    const worker = {
      addEventListener: vi.fn((name: string, listener: (event: any) => void) => {
        const group = listeners.get(name) ?? new Set()
        group.add(listener)
        listeners.set(name, group)
      }),
      removeEventListener: vi.fn((name: string, listener: (event: any) => void) => listeners.get(name)?.delete(listener)),
      postMessage: vi.fn((request: { id: number }) => {
        for (const listener of listeners.get('message') ?? []) listener({ data: { id: request.id, type: 'status', status: 'initializing' } })
        for (const listener of listeners.get('message') ?? []) listener({ data: { id: request.id, type: 'status', status: 'recognizing' } })
        for (const listener of listeners.get('message') ?? []) listener({
          data: { id: request.id, type: 'success', text: 'recognized text', confidence: 0.9, items: [] }
        })
      }),
      terminate: vi.fn()
    }
    vi.stubGlobal('Worker', vi.fn(() => worker))
    const onProgress = vi.fn()

    const result = await extractPdfText(documentWith(shortPage), options({ onProgress }))

    expect(result).toMatchObject({ nativePages: 0, ocrPages: 1 })
    expect(result.pages[0]).toMatchObject({ method: 'ocr', text: 'recognized text', confidence: 0.9, imageWidth: 250, imageHeight: 125 })
    expect(onProgress.mock.calls.map(([progress]) => progress.stage)).toEqual(['reading', 'rendering', 'initializing-ocr', 'ocr'])
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(shortPage.cleanup).toHaveBeenCalledTimes(1)
  })
})
