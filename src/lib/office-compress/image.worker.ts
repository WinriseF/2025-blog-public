/// <reference lib="webworker" />
import { optimizeOfficeImage } from './image'
import type { ImageCompressionPreset } from '../image-compress/types'

const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = async (event: MessageEvent<{ file: File; preset: ImageCompressionPreset }>) => {
	const bytes = await optimizeOfficeImage(event.data.file, event.data.preset)
	scope.postMessage(bytes, bytes ? [bytes] : [])
}
