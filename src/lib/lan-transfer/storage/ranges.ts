export type ChunkRange = [number, number]

export function mergeRanges(ranges: ChunkRange[]) {
	if (!ranges.length) return []
	const sorted = ranges.slice().sort((a, b) => a[0] - b[0])
	const merged: ChunkRange[] = []
	for (const range of sorted) {
		const last = merged[merged.length - 1]
		if (!last || range[0] > last[1] + 1) merged.push([range[0], range[1]])
		else last[1] = Math.max(last[1], range[1])
	}
	return merged
}

export function addRange(ranges: ChunkRange[], index: number) {
	return mergeRanges([...ranges, [index, index]])
}

export function hasChunk(ranges: ChunkRange[], index: number) {
	return ranges.some(([start, end]) => index >= start && index <= end)
}

export function countRanges(ranges: ChunkRange[]) {
	return ranges.reduce((sum, [start, end]) => sum + Math.max(0, end - start + 1), 0)
}
