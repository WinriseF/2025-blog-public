import { renderMarkdown } from './markdown-renderer'

type MarkdownWorkerRequest = {
	id: number
	markdown: string
}

type MarkdownWorkerResponse =
	| {
			id: number
			type: 'SUCCESS'
			payload: Awaited<ReturnType<typeof renderMarkdown>>
	  }
	| {
			id: number
			type: 'ERROR'
			payload: string
	  }

self.onmessage = async (event: MessageEvent<MarkdownWorkerRequest>) => {
	const { id, markdown } = event.data

	try {
		const payload = await renderMarkdown(markdown)
		self.postMessage({ id, type: 'SUCCESS', payload } satisfies MarkdownWorkerResponse)
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Markdown render failed'
		self.postMessage({ id, type: 'ERROR', payload: message } satisfies MarkdownWorkerResponse)
	}
}
