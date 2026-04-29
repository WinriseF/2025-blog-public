import { open, stat } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'

const AUDIO_PATH = path.join(process.cwd(), 'public', 'audio', 'kaze-no-sumika.mp3')
const MIME_TYPE = 'audio/mpeg'

function parseRange(range: string | null, size: number) {
	if (!range?.startsWith('bytes=')) return null

	const [startValue, endValue] = range.replace('bytes=', '').split('-')
	const start = startValue ? Number(startValue) : Math.max(size - Number(endValue), 0)
	const end = startValue ? (endValue ? Number(endValue) : size - 1) : size - 1

	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= size) return null
	return { start, end }
}

export async function HEAD() {
	const fileStat = await stat(AUDIO_PATH)

	return new Response(null, {
		headers: {
			'Accept-Ranges': 'bytes',
			'Cache-Control': 'public, max-age=31536000, immutable',
			'Content-Disposition': 'inline',
			'Content-Length': String(fileStat.size),
			'Content-Type': MIME_TYPE
		}
	})
}

export async function GET(request: Request) {
	const fileStat = await stat(AUDIO_PATH)
	const range = parseRange(request.headers.get('range'), fileStat.size)

	if (!range) {
		const file = await open(AUDIO_PATH, 'r')
		const buffer = Buffer.alloc(fileStat.size)
		await file.read(buffer, 0, fileStat.size, 0)
		await file.close()

		return new Response(buffer, {
			headers: {
				'Accept-Ranges': 'bytes',
				'Cache-Control': 'public, max-age=31536000, immutable',
				'Content-Disposition': 'inline',
				'Content-Length': String(fileStat.size),
				'Content-Type': MIME_TYPE
			}
		})
	}

	const chunkSize = range.end - range.start + 1
	const file = await open(AUDIO_PATH, 'r')
	const buffer = Buffer.alloc(chunkSize)
	await file.read(buffer, 0, chunkSize, range.start)
	await file.close()

	return new Response(buffer, {
		status: 206,
		headers: {
			'Accept-Ranges': 'bytes',
			'Cache-Control': 'public, max-age=31536000, immutable',
			'Content-Disposition': 'inline',
			'Content-Length': String(chunkSize),
			'Content-Range': `bytes ${range.start}-${range.end}/${fileStat.size}`,
			'Content-Type': MIME_TYPE
		}
	})
}
