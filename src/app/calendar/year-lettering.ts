import { getYearDigits, type PenStroke } from './year-lettering-data'

type Point = [number, number]
type Section = { left: Point; right: Point }
type Sample = Section & { center: Point; distance: number }
type Stroke = { samples: Sample[]; ends: number[]; chunks: string[]; length: number; full: string; bounds: Point }

const chunkSize = 48
const strokeCache = new WeakMap<PenStroke, Stroke>()

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const pointMix = (a: Point, b: Point, t: number): Point => [mix(a[0], b[0], t), mix(a[1], b[1], t)]
const smooth = (t: number) => t * t * (3 - 2 * t)
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

// Convex pen cells grow monotonically, including at tight turns and crossings.
// A broad reveal mask would expose future strokes or miss the glyph's edges.
function cellPath(a: Section, b: Section) {
	const points = [a.left, b.left, b.right, a.right].sort((p, q) => p[0] - q[0] || p[1] - q[1])
	const chain = (points: Point[]) => {
		const result: Point[] = []
		for (const point of points) {
			while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) result.pop()
			result.push(point)
		}
		return result.slice(0, -1)
	}
	return [...chain(points), ...chain([...points].reverse())]
		.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(3)},${point[1].toFixed(3)}`).join('') + 'Z'
}

function buildStroke(data: PenStroke, originX: number): Stroke {
	const cached = strokeCache.get(data)
	if (cached) return cached
	const samples: Sample[] = []
	let start = data.start
	for (const curve of data.curves) {
		const controlLength = Math.hypot(curve[0] - start[0], curve[1] - start[1]) +
			Math.hypot(curve[2] - curve[0], curve[3] - curve[1]) + Math.hypot(curve[4] - curve[2], curve[5] - curve[3])
		const count = Math.max(12, Math.ceil(controlLength / 1.3))
		for (let step = samples.length ? 1 : 0; step <= count; step++) {
			const t = step / count, u = 1 - t
			const x = u ** 3 * start[0] + 3 * u * u * t * curve[0] + 3 * u * t * t * curve[2] + t ** 3 * curve[4] - originX
			const y = u ** 3 * start[1] + 3 * u * u * t * curve[1] + 3 * u * t * t * curve[3] + t ** 3 * curve[5] - 600
			const dx = 3 * u * u * (curve[0] - start[0]) + 6 * u * t * (curve[2] - curve[0]) + 3 * t * t * (curve[4] - curve[2])
			const dy = 3 * u * u * (curve[1] - start[1]) + 6 * u * t * (curve[3] - curve[1]) + 3 * t * t * (curve[5] - curve[3])
			const halfWidth = mix(start[2], curve[6], smooth(t)) / 2
			const tangent = Math.hypot(dx, dy)
			const nx = -dy / tangent * halfWidth, ny = dx / tangent * halfWidth
			const previous = samples[samples.length - 1]
			samples.push({
				center: [x, y], left: [x + nx, y + ny], right: [x - nx, y - ny],
				distance: previous ? previous.distance + Math.hypot(x - previous.center[0], y - previous.center[1]) : 0
			})
		}
		start = [curve[4], curve[5], curve[6]]
	}
	const pieces = samples.slice(1).map((sample, index) => cellPath(samples[index], sample))
	const ends = [0]
	for (const piece of pieces) ends.push(ends[ends.length - 1] + piece.length)
	const full = pieces.join('')
	// Overlap one already-written cell so separate paths cannot leave seam lines.
	const chunks = Array.from({ length: Math.ceil(pieces.length / chunkSize) }, (_, index) =>
		full.slice(ends[Math.max(0, index * chunkSize - 1)], ends[Math.min(pieces.length, (index + 1) * chunkSize)])
	)
	const bounds: Point = [Infinity, -Infinity]
	for (const sample of samples) {
		bounds[0] = Math.min(bounds[0], sample.left[0], sample.right[0])
		bounds[1] = Math.max(bounds[1], sample.left[0], sample.right[0])
	}
	const stroke = { samples, ends, chunks, length: samples[samples.length - 1].distance, full, bounds }
	strokeCache.set(data, stroke)
	return stroke
}

export function getWrittenFrame(stroke: Stroke, progress: number) {
	if (progress <= 0) return { complete: 0, path: '' }
	if (progress >= 1) return { complete: stroke.chunks.length, path: '' }
	const distance = stroke.length * smooth(progress)
	let low = 1, high = stroke.samples.length - 1
	while (low < high) {
		const middle = (low + high) >> 1
		if (stroke.samples[middle].distance < distance) low = middle + 1
		else high = middle
	}
	const a = stroke.samples[low - 1], b = stroke.samples[low]
	const fraction = (distance - a.distance) / (b.distance - a.distance)
	const tip = { left: pointMix(a.left, b.left, fraction), right: pointMix(a.right, b.right, fraction) }
	const complete = Math.floor((low - 1) / chunkSize)
	const start = stroke.ends[Math.max(0, complete * chunkSize - 1)]
	return { complete, path: stroke.full.slice(start, stroke.ends[low - 1]) + cellPath(a, tip) }
}

export function createYearLettering(year: number) {
	let x = 0, start = 150
	const tracks = getYearDigits(year).flatMap(digit => {
		const offset = x
		x += digit.advance
		return digit.strokes.map(data => {
			const duration = digit.duration / digit.strokes.length
			const track = { stroke: buildStroke(data, digit.originX), x: offset, start, duration }
			start += duration + 100
			return track
		})
	})
	const left = Math.min(...tracks.map(track => track.stroke.bounds[0] + track.x)) - 12
	const right = Math.max(...tracks.map(track => track.stroke.bounds[1] + track.x)) + 12
	return { tracks, duration: start - 100, viewBox: `${left} -12 ${right - left} 312` }
}
