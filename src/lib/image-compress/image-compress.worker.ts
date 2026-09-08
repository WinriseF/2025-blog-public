/// <reference lib="webworker" />

import { NativeWorkerDecodeUnavailable } from './decode'
import { compressImage, ImagePipelineError } from './pipeline'
import type { ImageWorkerRequest, ImageWorkerResponse } from './types'

const scope = self as unknown as DedicatedWorkerGlobalScope
let activeJobId: string | null = null

function post(message: ImageWorkerResponse, transfer: Transferable[] = []) {
	scope.postMessage(message, { transfer })
}

async function run(request: ImageWorkerRequest) {
	if (activeJobId && activeJobId !== request.jobId) {
		post({ type: 'job:failed', jobId: request.jobId, code: 'ENCODE_FAILED', message: '当前 Worker 已有图片任务' })
		return
	}
	if (request.type === 'job:start' && (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined')) {
		post({ type: 'job:needs-main-decode', jobId: request.jobId, message: '当前浏览器需要使用兼容解码路径' })
		return
	}
	activeJobId = request.jobId
	try {
		const result = await compressImage({
			file: request.file,
			options: request.options,
			limits: request.limits,
			decoded: request.type === 'job:start-decoded' ? request.decoded : undefined,
			onProgress: (stage, progress, detail) => post({ type: 'job:progress', jobId: request.jobId, stage, progress, detail })
		})
		post({ type: 'job:done', jobId: request.jobId, result }, [result.bytes])
	} catch (error) {
		if (error instanceof NativeWorkerDecodeUnavailable && request.type === 'job:start') {
			post({ type: 'job:needs-main-decode', jobId: request.jobId, message: error.message })
			return
		}
		if (error instanceof ImagePipelineError) {
			post({ type: 'job:failed', jobId: request.jobId, code: error.code, message: error.message })
			return
		}
		const message = error instanceof Error ? error.message : '图片处理失败'
		const outOfMemory = error instanceof RangeError || /memory|allocation|out of bounds/i.test(message)
		post({ type: 'job:failed', jobId: request.jobId, code: outOfMemory ? 'OUT_OF_MEMORY' : 'ENCODE_FAILED', message: outOfMemory ? '浏览器内存不足，请限制最大宽度后重试' : message })
	} finally {
		activeJobId = null
	}
}

scope.onmessage = event => {
	void run(event.data as ImageWorkerRequest)
}

export {}
