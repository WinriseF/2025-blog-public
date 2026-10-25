import type { TimeThemeName } from '@/lib/time-theme'

type DayTheme = Exclude<TimeThemeName, 'night'>

const palettes: Record<DayTheme, { cool: number[]; warm: number[] }> = {
	dawn: { cool: [105, 157, 214], warm: [236, 186, 111] },
	noon: { cool: [80, 163, 197], warm: [121, 194, 181] },
	sunset: { cool: [160, 121, 191], warm: [231, 156, 115] }
}

function random(x: number, y: number) {
	const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
	return value - Math.floor(value)
}

function noise(x: number, y: number) {
	const ix = Math.floor(x)
	const iy = Math.floor(y)
	const fx = x - ix
	const fy = y - iy
	const sx = fx * fx * (3 - 2 * fx)
	const sy = fy * fy * (3 - 2 * fy)
	const top = random(ix, iy) * (1 - sx) + random(ix + 1, iy) * sx
	const bottom = random(ix, iy + 1) * (1 - sx) + random(ix + 1, iy + 1) * sx
	return top * (1 - sy) + bottom * sy
}

function cloudNoise(x: number, y: number) {
	return noise(x, y) * 0.55 + noise(x * 2.1 + 8, y * 2.1 + 3) * 0.28 + noise(x * 4.3, y * 4.3) * 0.12 + noise(x * 8.7, y * 8.7) * 0.05
}

function bandHeight(x: number) {
	return 0.73 - x * 0.53 + Math.sin(x * 7 + 1) * 0.065
}

/** A static translucent cloud texture; no assets, animation, or full-resolution noise work. */
export function drawDaylightAtmosphere(context: CanvasRenderingContext2D, width: number, height: number, theme: DayTheme) {
	const { cool, warm } = palettes[theme]
	const texture = document.createElement('canvas')
	texture.width = 240
	texture.height = Math.max(1, Math.round(240 * height / width))
	const textureContext = texture.getContext('2d')
	if (!textureContext) return
	const pixels = textureContext.createImageData(texture.width, texture.height)
	for (let py = 0; py < texture.height; py++) {
		for (let px = 0; px < texture.width; px++) {
			const x = px / texture.width
			const y = py / texture.height
			const warp = cloudNoise(x * 3 + 12, y * 3 + 5)
			const distance = (y - bandHeight(x) + (warp - 0.5) * 0.16) / 0.19
			const band = Math.exp(-distance * distance * 1.4)
			const detail = cloudNoise(x * 8 + warp * 2, y * 9 + warp)
			const density = Math.pow(Math.max(0, detail * 1.7 - 0.32), 1.15)
			const fade = Math.min(1, x / 0.1, (1 - x) / 0.1, y / 0.1, Math.max(0, (0.86 - y) / 0.16))
			const blend = Math.max(0, Math.min(1, 0.5 + (y - bandHeight(x)) * 3 + (warp - 0.5) * 0.6))
			const offset = (py * texture.width + px) * 4
			for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] = cool[channel] * (1 - blend) + warm[channel] * blend
			pixels.data[offset + 3] = Math.min(0.6, density * band * fade * 0.65) * 255
		}
	}
	textureContext.putImageData(pixels, 0, 0)
	context.drawImage(texture, 0, 0, width, height)

	// Small luminous points follow the cloud band and leave the greeting clear.
	for (let index = 0; index < 48; index++) {
		const x = 0.07 + random(index + 1, 15) * 0.86
		const y = bandHeight(x) + (random(index + 1, 29) - 0.5) * 0.27
		const radius = 0.35 + random(index + 1, 48) * 0.55
		context.fillStyle = `rgba(255,255,255,${0.42 + random(index + 1, 67) * 0.48})`
		context.beginPath()
		context.arc(x * width, y * height, radius, 0, Math.PI * 2)
		context.fill()
	}
	for (const [x, y] of [[0.12, 0.62], [0.86, 0.24], [0.91, 0.39]]) {
		const glow = context.createRadialGradient(x * width, y * height, 0, x * width, y * height, 4)
		glow.addColorStop(0, 'rgba(255,255,255,0.9)')
		glow.addColorStop(0.2, 'rgba(255,255,255,0.45)')
		glow.addColorStop(1, 'rgba(255,255,255,0)')
		context.fillStyle = glow
		context.fillRect(x * width - 4, y * height - 4, 8, 8)
	}
}
