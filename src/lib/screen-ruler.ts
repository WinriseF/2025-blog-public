export const RULER_STORAGE_KEY = 'winrisef:screen-ruler:v2'
export const PREVIEW_PX_PER_MM = 96 / 25.4
export type RulerUnit = 'cm' | 'in'
export type ScreenStamp = { dpr: number; width: number; height: number }
export type CalibrationResult = {
	pxPerMm: number
	method: 'card' | 'phone' | 'connector' | 'ruler' | 'custom'
	checkErrorMm: number | null
	referenceId?: string
}
export type RulerCalibration = ScreenStamp & CalibrationResult & { version: 2 }

export function screenStamp(): ScreenStamp {
	return { dpr: window.devicePixelRatio || 1, width: Math.min(screen.width, screen.height), height: Math.max(screen.width, screen.height) }
}

export function calibrationMatches(calibration: RulerCalibration, stamp: ScreenStamp) {
	return Math.abs(calibration.dpr - stamp.dpr) < 0.001 && calibration.width === stamp.width && calibration.height === stamp.height
}

export function parseCalibration(value: string | null): RulerCalibration | null {
	try {
		const data = JSON.parse(value || 'null') as RulerCalibration | null
		return data?.version === 2 &&
			['card', 'phone', 'connector', 'ruler', 'custom'].includes(data.method) &&
			(data.method === 'custom'
				? data.checkErrorMm === null
				: typeof data.checkErrorMm === 'number' && Number.isFinite(data.checkErrorMm) && data.checkErrorMm >= 0) &&
			[data.pxPerMm, data.dpr, data.width, data.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) &&
			data.pxPerMm >= 0.5 &&
			data.pxPerMm <= 40
			? data
			: null
	} catch {
		return null
	}
}

export function calibrationScale(pixels: number, millimeters: number) {
	const scale = pixels / millimeters
	return pixels > 0 && millimeters > 0 && Number.isFinite(scale) && scale >= 0.5 && scale <= 40 ? scale : null
}

export function clampPosition(value: number, capacity: number) {
	return Math.max(0, Math.min(capacity, value))
}

export type CalibrationSample = { pixels: number; mm: number }

// Origin-constrained least squares, fitting mm = slope * CSS px.
// Method: Muto (2025), https://doi.org/10.5265/jcogpsy.2415.
// Independently implemented; validation sample must not enter this fit.
export function fitRulerCalibration(samples: CalibrationSample[]) {
	if (samples.length < 3 || samples.some(s => !calibrationScale(s.pixels, s.mm))) return null
	const slope = samples.reduce((sum, s) => sum + s.pixels * s.mm, 0) / samples.reduce((sum, s) => sum + s.pixels ** 2, 0)
	const residualMm = Math.sqrt(samples.reduce((sum, s) => sum + (s.mm - s.pixels * slope) ** 2, 0) / samples.length)
	return { pxPerMm: 1 / slope, residualMm }
}

export function compareCardSamples(first: number, second: number) {
	return Math.abs(first - second) / ((first + second) / 2) <= 0.01
}

export function lengthLabel(mm: number, unit: RulerUnit) {
	return unit === 'cm' ? (mm / 10).toFixed(2) : (mm / 25.4).toFixed(3)
}

export function rulerTicks(lengthPx: number, pxPerMm: number, unit: RulerUnit) {
	const stepMm = unit === 'cm' ? 1 : 25.4 / 16
	const majorEvery = unit === 'cm' ? 10 : 16
	const halfEvery = majorEvery / 2
	return Array.from({ length: Math.min(5000, Math.floor(lengthPx / (stepMm * pxPerMm)) + 1) }, (_, i) => ({
		pixel: i * stepMm * pxPerMm,
		size: i % majorEvery === 0 ? 34 : i % halfEvery === 0 ? 23 : 12,
		label: i % majorEvery === 0 ? String(i / majorEvery) : null
	}))
}
