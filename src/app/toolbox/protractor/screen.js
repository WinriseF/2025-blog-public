// Each corner has its own ordered pair: magenta/green or magenta/cyan.
function scanRows(ctx, start, end, found) {
	const width = ctx.canvas.width
	if (end <= start) return
	const { data } = ctx.getImageData(0, start, width, end - start)
	for (let row = start; row < end; row++) {
		let previous = 0,
			lastColorX = -Infinity
		for (let col = 0; col < width; col++) {
			const i = ((row - start) * width + col) * 4
			const r = data[i],
				g = data[i + 1],
				b = data[i + 2]
			const color = r > 150 && g < 90 && b > 100 ? 1 : r < 100 && g > 150 ? (b < 120 ? 2 : b > 180 ? 3 : 0) : 0
			// Capture scaling can blend the seam between the two marker colors.
			if (!color) continue
			if (col - lastColorX > 3) previous = 0
			const seam = Math.round((lastColorX + col + 1) / 2)
			lastColorX = col
			if (color === previous) continue
			const id =
				previous === 1 && color === 2 ? 0 : previous === 2 && color === 1 ? 1 : previous === 1 && color === 3 ? 2 : previous === 3 && color === 1 ? 3 : -1
			if (id >= 0 && !found.has(id)) found.set(id, { id, x: seam, y: row })
			previous = color
		}
	}
}

function locate(found, rx, ry, bottomY, lastScale) {
	const points = Array.from(found.values(), p => ({
		x: p.x * rx,
		y: p.y * ry,
		u: p.id % 2 ? innerWidth - 6 : 6,
		v: p.id >= 2 ? bottomY : 0
	}))
	for (let i = 0; i < points.length; i++) {
		const a = points[i]
		for (const b of points.slice(i + 1)) {
			const du = b.u - a.u,
				dv = b.v - a.v,
				dx = b.x - a.x,
				dy = b.y - a.y
			const scale = (dx * du + dy * dv) / (du * du + dv * dv)
			if (scale > 0 && Math.abs(dx - scale * du) <= 3 * rx && Math.abs(dy - scale * dv) <= 3 * ry) return { x: a.x - a.u * scale, y: a.y - a.v * scale, scale }
		}
	}
	if (points.length === 1 && lastScale) {
		const a = points[0]
		return { x: a.x - a.u * lastScale, y: a.y - a.v * lastScale, scale: lastScale }
	}
}

export function mirrorScreen(video, output, bottomMarker, status) {
	const make = () => document.createElement('canvas')
	const scan = make(),
		cache = make(),
		snapshot = make()
	const capture = snapshot.getContext('2d')
	const probe = scan.getContext('2d', { willReadFrequently: true })
	const buffer = cache.getContext('2d'),
		view = output.getContext('2d')
	let frame,
		last,
		tracking,
		lostSince,
		lastProbe = -Infinity,
		lastSearch = -Infinity
	let sharpenTimer, lastPositionTime
	const sharpen = () => {
		output.style.filter = ''
	}
	const callback = typeof video.requestVideoFrameCallback === 'function'
	function next() {
		frame = callback ? video.requestVideoFrameCallback(update) : requestAnimationFrame(update)
	}
	function update(time) {
		next()
		if (!video.videoWidth || (!callback && time - lastProbe < 32)) return
		lastProbe = time
		const W = video.videoWidth,
			H = video.videoHeight
		const w = Math.min(W, 1000),
			h = Math.round((H * w) / W)
		if (cache.width !== W || cache.height !== H) {
			cache.width = snapshot.width = W
			cache.height = snapshot.height = H
			scan.width = w
			scan.height = h
			last = null
		}
		// Locate and mask the exact same capture, including during a fast drag.
		capture.drawImage(video, 0, 0)
		probe.drawImage(snapshot, 0, 0, w, h)
		let pos
		const found = new Map()
		const bottomY = bottomMarker.offsetTop
		if (last) {
			// Check both marker rows before falling back to a monitor-wide search.
			for (const offset of [0, bottomY]) {
				const row = Math.round(((last.y + offset * last.scale) * h) / H)
				scanRows(probe, Math.max(0, row - 20), Math.min(h, row + 21), found)
			}
			pos = locate(found, W / w, H / h, bottomY)
		}
		if (!pos && time - lastSearch >= 100) {
			lastSearch = time
			found.clear()
			scanRows(probe, 0, h, found)
			pos = locate(found, W / w, H / h, bottomY, last?.scale)
		}
		if (!pos) {
			lostSince ??= time
			if (time - lostSince >= 350 && tracking !== false) {
				status(last ? '定位暂停，背景已冻结' : '尚未定位')
				tracking = false
			}
			return
		}
		if (tracking !== true) status('')
		tracking = true
		lostSince = undefined
		if (last) {
			const distance = Math.hypot(pos.x - last.x, pos.y - last.y) / pos.scale
			const speed = distance / (time - lastPositionTime)
			if (distance > 3 && speed > 0.15) {
				output.style.filter = speed > 0.8 ? 'blur(2px)' : 'blur(1px)'
				clearTimeout(sharpenTimer)
				sharpenTimer = setTimeout(sharpen, 100)
			}
		}
		lastPositionTime = time
		last = pos
		const { x, y, scale } = pos
		const cw = innerWidth * scale,
			ch = innerHeight * scale
		// Exclude browser chrome and shadows as well as the measured viewport.
		const shadow = 64 * scale
		const top = y - Math.max(0, window.outerHeight - innerHeight) * scale - shadow
		buffer.save()
		buffer.beginPath()
		buffer.rect(0, 0, W, H)
		buffer.rect(x - shadow, top, cw + 2 * shadow, y + ch + shadow - top)
		buffer.clip('evenodd')
		buffer.drawImage(snapshot, 0, 0)
		buffer.restore()
		const ow = Math.max(1, Math.round(cw)),
			oh = Math.max(1, Math.round(ch))
		if (output.width !== ow || output.height !== oh) {
			output.width = ow
			output.height = oh
		}
		view.clearRect(0, 0, ow, oh)
		view.drawImage(cache, x, y, cw, ch, 0, 0, ow, oh)
	}
	next()
	return () => {
		if (callback) video.cancelVideoFrameCallback(frame)
		else cancelAnimationFrame(frame)
		clearTimeout(sharpenTimer)
		sharpen()
		cache.width = scan.width = snapshot.width = output.width = 1
	}
}
