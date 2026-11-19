const imageTypes: Record<string, string> = {
	apng: 'image/apng',
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	ico: 'image/x-icon',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	svg: 'image/svg+xml',
	webp: 'image/webp'
}
const zipTypes: Record<string, string> = {
	jfif: 'image/jpeg',
	jpe: 'image/jpeg',
	jif: 'image/jpeg',
	pjpeg: 'image/jpeg',
	pjp: 'image/jpeg',
	cur: 'image/x-icon',
	heic: 'image/heic',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	jxl: 'image/jxl',
	ttf: 'font/ttf',
	otf: 'font/otf',
	woff: 'font/woff',
	woff2: 'font/woff2',
	pdf: 'application/pdf',
	mp4: 'video/mp4',
	m4v: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	ogv: 'video/ogg',
	mkv: 'video/x-matroska',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	m4a: 'audio/mp4',
	m4b: 'audio/mp4',
	aac: 'audio/aac',
	flac: 'audio/flac',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	opus: 'audio/ogg; codecs=opus',
	weba: 'audio/webm'
}

function extension(path: string) {
	return /\.([a-z\d]+)$/i.exec(path)?.[1].toLowerCase() ?? ''
}

export function imageMimeType(path: string) {
	const ext = extension(path)
	return Object.hasOwn(imageTypes, ext) ? imageTypes[ext] : undefined
}

export function filePreviewType(path: string) {
	const image = imageMimeType(path)
	if (image) return image
	const ext = extension(path)
	if (Object.hasOwn(zipTypes, ext)) return zipTypes[ext]
	if (
		/^(?:txt|srt|vtt|diff|patch|jsonc|ndjson|md|markdown|log|csv|tsv|json|jsonl|xml|html?|css|scss|js|jsx|mjs|cjs|ts|tsx|vue|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|sh|sql|ya?ml|toml|ini|conf|properties|env|gitignore)$/i.test(
			ext
		) ||
		/(?:^|\/)(?:readme|license|dockerfile|makefile)$/i.test(path)
	)
		return 'text/plain'
}
