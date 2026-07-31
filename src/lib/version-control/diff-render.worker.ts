import { buildDiffMetadata, type DiffRenderRequest, type DiffRenderResponse } from './diff-renderer'

self.onmessage = (event: MessageEvent<DiffRenderRequest>) => {
	const { id, ...request } = event.data
	try {
		self.postMessage({ id, type: 'success', metadata: buildDiffMetadata(request) } satisfies DiffRenderResponse)
	} catch (error) {
		self.postMessage({
			id,
			type: 'error',
			error: error instanceof Error ? error.message : 'Diff 解析失败'
		} satisfies DiffRenderResponse)
	}
}
