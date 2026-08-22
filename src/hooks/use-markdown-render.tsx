import { useEffect, useMemo, useState, type ReactElement } from 'react'
import parse, { type HTMLReactParserOptions, Element, type DOMNode } from 'html-react-parser'
import type { MarkdownRenderResult as RawMarkdownRenderResult, TocItem } from '@/lib/markdown-renderer'
import { MarkdownImage } from '@/components/markdown-image'
import { CodeBlock } from '@/components/code-block'
import { MermaidDiagram } from '@/components/mermaid-diagram'

type MarkdownRenderResult = {
	content: ReactElement | null
	toc: TocItem[]
	loading: boolean
}

type MarkdownRenderOptions = {
	worker?: boolean
}

type WorkerResponse =
	| {
			id: number
			type: 'SUCCESS'
			payload: RawMarkdownRenderResult
	  }
	| {
			id: number
			type: 'ERROR'
			payload: string
	  }

// zero-visual cache: markdown -> {html,toc} + markdown -> ReactElement
// use full markdown string as key to avoid hash collision; LRU 20 limits memory (~4MB worst)
const renderResultCache = new Map<string, RawMarkdownRenderResult>()
const reactContentCache = new Map<string, ReactElement>()
const MAX_CACHE_SIZE = 20

// shared worker singleton — keeps shiki highlighter warm, single dispatcher for all hook instances
let sharedWorker: Worker | null = null
let globalRequestId = 0
type PendingEntry = {
	onSuccess: (payload: RawMarkdownRenderResult) => void
	onError: (message: string) => void
	cancelled: () => boolean
}
const pendingRequests = new Map<number, PendingEntry>()

function ensureSharedWorker(): Worker {
	if (!sharedWorker) {
		sharedWorker = new Worker(new URL('../lib/markdown.worker.ts', import.meta.url))
		sharedWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
			const entry = pendingRequests.get(event.data.id)
			if (!entry) return
			pendingRequests.delete(event.data.id)
			if (entry.cancelled()) return
			if (event.data.type === 'SUCCESS') entry.onSuccess(event.data.payload)
			else entry.onError(event.data.payload)
		}
		sharedWorker.onerror = () => {
			// fail all pending to main-thread fallback, then recycle worker
			const entries = Array.from(pendingRequests.entries())
			pendingRequests.clear()
			for (const [, entry] of entries) {
				if (!entry.cancelled()) entry.onError('worker error')
			}
			sharedWorker?.terminate()
			sharedWorker = null
		}
	}
	return sharedWorker
}

function setCacheWithLimit<K, V>(map: Map<K, V>, key: K, value: V) {
	if (map.has(key)) map.delete(key)
	if (map.size >= MAX_CACHE_SIZE) {
		const firstKey = map.keys().next().value as K
		map.delete(firstKey)
	}
	map.set(key, value)
}

function touchCache<K, V>(map: Map<K, V>, key: K): V | undefined {
	const value = map.get(key)
	if (value !== undefined) {
		map.delete(key)
		map.set(key, value)
	}
	return value
}

function decodeHtmlAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
}

function parseMarkdownHtml(html: string): ReactElement {
	const codeBlocks: Array<{ code: string; preHtml: string }> = []
	const processedHtml = html.replace(/<pre\s+data-code="([^"]*)"(?:[^>]*)>([\s\S]*?)<\/pre>/g, (_match, codeAttr, content) => {
		const index = codeBlocks.length
		const code = decodeHtmlAttribute(codeAttr)
		codeBlocks.push({
			code,
			preHtml: `${content}`
		})
		return `<div data-code-block-index="${index}"></div>`
	})

	const options: HTMLReactParserOptions = {
		replace(domNode: DOMNode) {
			if (domNode instanceof Element && domNode.name === 'div' && domNode.attribs['data-code-block-index']) {
				const block = codeBlocks[Number(domNode.attribs['data-code-block-index'])]
				if (!block) return
				return <CodeBlock code={block.code}>{parse(block.preHtml) as ReactElement}</CodeBlock>
			}

			if (domNode instanceof Element && domNode.name === 'div' && domNode.attribs['data-mermaid-code']) {
				return <MermaidDiagram chart={decodeHtmlAttribute(domNode.attribs['data-mermaid-code'])} />
			}

			if (domNode instanceof Element && domNode.name === 'a') {
				const { href } = domNode.attribs
				const isExternal = href && (href.startsWith('http://') || href.startsWith('https://'))
				if (isExternal) {
					domNode.attribs.target = '_blank'
					domNode.attribs.rel = 'noopener noreferrer'
				}
				return
			}

			if (domNode instanceof Element && domNode.name === 'img') {
				const { src, alt, title } = domNode.attribs
				return <MarkdownImage src={src} alt={alt} title={title} />
			}
		}
	}

	return parse(processedHtml, options) as ReactElement
}

export function useMarkdownRender(markdown: string, options?: MarkdownRenderOptions): MarkdownRenderResult {
	const [content, setContent] = useState<ReactElement | null>(null)
	const [toc, setToc] = useState<TocItem[]>([])
	const [loading, setLoading] = useState<boolean>(true)
	const useWorker = options?.worker !== false
	const canUseWorker = useMemo(() => useWorker && typeof window !== 'undefined' && typeof Worker !== 'undefined', [useWorker])

	useEffect(() => {
		let cancelled = false
		let pendingId: number | null = null
		// use markdown string directly as cache key — no collision
		const cachedReact = touchCache(reactContentCache, markdown)
		const cachedResult = touchCache(renderResultCache, markdown)
		if (cachedReact && cachedResult) {
			setContent(cachedReact)
			setToc(cachedResult.toc)
			setLoading(false)
			return () => {
				cancelled = true
			}
		}

		async function renderOnMainThread() {
			setLoading(true)
			try {
				const { renderMarkdown } = await import('@/lib/markdown-renderer')
				const { html, toc } = await renderMarkdown(markdown)
				if (cancelled) return
				const result: RawMarkdownRenderResult = { html, toc }
				setCacheWithLimit(renderResultCache, markdown, result)
				const reactContent = parseMarkdownHtml(html)
				setCacheWithLimit(reactContentCache, markdown, reactContent)
				setContent(reactContent)
				setToc(toc)
			} catch (error) {
				console.error('Markdown render error:', error)
				if (!cancelled) {
					setContent(null)
					setToc([])
				}
			} finally {
				if (!cancelled) {
					setLoading(false)
				}
			}
		}

		function renderInWorker() {
			// if we have raw result cached, reuse it without worker
			if (cachedResult) {
				const reactContent = parseMarkdownHtml(cachedResult.html)
				setCacheWithLimit(reactContentCache, markdown, reactContent)
				setContent(reactContent)
				setToc(cachedResult.toc)
				setLoading(false)
				return
			}

			setLoading(true)
			try {
				const requestId = ++globalRequestId
				pendingId = requestId
				pendingRequests.set(requestId, {
					cancelled: () => cancelled,
					onSuccess: payload => {
						setCacheWithLimit(renderResultCache, markdown, payload)
						const reactContent = parseMarkdownHtml(payload.html)
						setCacheWithLimit(reactContentCache, markdown, reactContent)
						setContent(reactContent)
						setToc(payload.toc)
						setLoading(false)
					},
					onError: message => {
						console.error('Markdown worker error:', message)
						if (!cancelled) void renderOnMainThread()
						else setLoading(false)
					}
				})

				const worker = ensureSharedWorker()
				worker.postMessage({ id: requestId, markdown })
			} catch (error) {
				console.error('Markdown worker init failed:', error)
				void renderOnMainThread()
			}
		}

		if (canUseWorker) {
			renderInWorker()
		} else {
			void renderOnMainThread()
		}

		return () => {
			cancelled = true
			if (pendingId !== null) pendingRequests.delete(pendingId)
		}
	}, [canUseWorker, markdown])

	return { content, toc, loading }
}
