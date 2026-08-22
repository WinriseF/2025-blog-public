import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
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
	const workerRef = useRef<Worker | null>(null)
	const requestIdRef = useRef(0)
	const useWorker = options?.worker !== false
	const canUseWorker = useMemo(() => useWorker && typeof window !== 'undefined' && typeof Worker !== 'undefined', [useWorker])

	useEffect(() => {
		let cancelled = false
		const requestId = ++requestIdRef.current

		async function renderOnMainThread() {
			setLoading(true)
			try {
				const { renderMarkdown } = await import('@/lib/markdown-renderer')
				const { html, toc } = await renderMarkdown(markdown)
				if (!cancelled) {
					const reactContent = parseMarkdownHtml(html)
					setContent(reactContent)
					setToc(toc)
				}
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
			setLoading(true)
			try {
				workerRef.current?.terminate()
				const worker = new Worker(new URL('../lib/markdown.worker.ts', import.meta.url))
				workerRef.current = worker

				worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
					if (cancelled || event.data.id !== requestId) return

					if (event.data.type === 'SUCCESS') {
						const { html, toc } = event.data.payload
						setContent(parseMarkdownHtml(html))
						setToc(toc)
						setLoading(false)
						return
					}

					console.error('Markdown worker error:', event.data.payload)
					setContent(null)
					setToc([])
					setLoading(false)
				}

				worker.onerror = error => {
					console.error('Markdown worker failed:', error)
					if (!cancelled) void renderOnMainThread()
				}

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
			workerRef.current?.terminate()
			workerRef.current = null
		}
	}, [canUseWorker, markdown])

	return { content, toc, loading }
}
