import { loadJxlCodec } from './cdn'

export async function jxlToPng(blob: Blob) {
	const codec = await loadJxlCodec()
	const image = await codec.decode(await blob.arrayBuffer())
	const canvas = document.createElement('canvas')
	canvas.width = image.width
	canvas.height = image.height
	const context = canvas.getContext('2d')
	if (!context) throw new Error('无法创建 JPEG XL 画布')
	context.putImageData(image, 0, 0)
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(result => result ? resolve(result) : reject(new Error('无法生成 JPEG XL 预览')), 'image/png')
	})
}
