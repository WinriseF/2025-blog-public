async function convertToPng(blob: Blob) {
	const url = URL.createObjectURL(blob)
	try {
		const image = new Image()
		image.src = url
		await image.decode()
		const canvas = document.createElement('canvas')
		canvas.width = image.naturalWidth
		canvas.height = image.naturalHeight
		const context = canvas.getContext('2d')
		if (!context) throw new Error('无法创建图片复制画布')
		context.drawImage(image, 0, 0)
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(result => result ? resolve(result) : reject(new Error('无法生成剪贴板图片')), 'image/png')
		})
	} finally {
		URL.revokeObjectURL(url)
	}
}

export async function copyImageToClipboard(blob: Blob) {
	if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持复制图片')
	const ClipboardImageItem = ClipboardItem as typeof ClipboardItem & { supports?: (type: string) => boolean }
	const keepsFormat = blob.type === 'image/png' || ClipboardImageItem.supports?.(blob.type) === true
	const type = keepsFormat ? blob.type : 'image/png'
	const data = keepsFormat ? blob : convertToPng(blob)
	await navigator.clipboard.write([new ClipboardImageItem({ [type]: data })])
}
