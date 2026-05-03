import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import parse, { type HTMLReactParserOptions, Element, type DOMNode } from 'html-react-parser'
import type { MarkdownRenderResult as RawMarkdownRenderResult, TocItem } from '@/lib/markdown-renderer'
import { MarkdownImage } from '@/components/markdown-image'
import { CodeBlock } from '@/components/code-block'

type MarkdownRenderResult = {
	content: ReactElement | null
	toc: TocItem[]
	loading: boolean
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

function parseMarkdownHtml(html: string): ReactElement {
	const codeBlocks: Array<{ placeholder: string; code: string; preHtml: string }> = []
	const processedHtml = html.replace(/<pre\s+data-code="([^"]*)"([^>]*)>([\s\S]*?)<\/pre>/g, (match, codeAttr, attrs, content) => {
		const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`
		const code = codeAttr
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&')
		codeBlocks.push({
			placeholder,
			code,
			preHtml: `${content}`
		})
		return placeholder
	})

	const options: HTMLReactParserOptions = {
		replace(domNode: DOMNode) {
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

			if (domNode.type === 'text' && domNode.data) {
				const text = domNode.data
				for (const block of codeBlocks) {
					if (text.includes(block.placeholder)) {
						const parts = text.split(block.placeholder)
						const preElement = parse(block.preHtml) as ReactElement
						return (
							<>
								{parts[0] && <>{parts[0]}</>}
								<CodeBlock code={block.code}>{preElement}</CodeBlock>
								{parts[1] && <>{parts[1]}</>}
							</>
						)
					}
				}
			}
		}
	}

	return parse(processedHtml, options) as ReactElement
}

export function useMarkdownRender(markdown: string): MarkdownRenderResult {
	const [content, setContent] = useState<ReactElement | null>(null)
	const [toc, setToc] = useState<TocItem[]>([])
	const [loading, setLoading] = useState<boolean>(true)
	const workerRef = useRef<Worker | null>(null)
	const requestIdRef = useRef(0)
	const canUseWorker = useMemo(() => typeof window !== 'undefined' && typeof Worker !== 'undefined', [])

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
