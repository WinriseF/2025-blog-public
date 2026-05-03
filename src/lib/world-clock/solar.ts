import tzLookup from 'tz-lookup'

export interface Coordinates {
	lat: number
	lon: number
}

export interface VectorValues {
	x: number
	y: number
	z: number
}

export interface WorldClockReading {
	coordinates: Coordinates
	timeZone: string
	utcOffset: string
	standardDate: string
	standardTime: string
	solarDate: string
	solarTime: string
	equationOfTimeMinutes: number
	sunAltitude: number
	daylightLabel: string
	subsolar: Coordinates
}

const DAY_MS = 86_400_000
const J2000 = 2451545.0

export function toRadians(value: number) {
	return (value * Math.PI) / 180
}

export function toDegrees(value: number) {
	return (value * 180) / Math.PI
}

export function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

export function normalizeDegrees(value: number) {
	return ((value % 360) + 360) % 360
}

export function normalizeLongitude(value: number) {
	const normalized = ((((value + 180) % 360) + 360) % 360) - 180
	return normalized === -180 ? 180 : normalized
}

export function coordinatesToVector({ lat, lon }: Coordinates, radius = 1): VectorValues {
	const phi = toRadians(lon + 180)
	const theta = toRadians(90 - lat)
	const sinTheta = Math.sin(theta)

	return {
		x: -Math.cos(phi) * sinTheta * radius,
		y: Math.cos(theta) * radius,
		z: Math.sin(phi) * sinTheta * radius
	}
}

export function vectorToCoordinates({ x, y, z }: VectorValues): Coordinates {
	const radius = Math.hypot(x, y, z) || 1
	let phi = Math.atan2(z, -x)
	if (phi < 0) phi += Math.PI * 2

	return {
		lat: toDegrees(Math.asin(clamp(y / radius, -1, 1))),
		lon: normalizeLongitude(toDegrees(phi) - 180)
	}
}

export function getJulianDate(date: Date) {
	return date.getTime() / DAY_MS + 2440587.5
}

function getGreenwichMeanSiderealTime(julianDate: number) {
	const t = (julianDate - J2000) / 36525
	return normalizeDegrees(280.46061837 + 360.98564736629 * (julianDate - J2000) + 0.000387933 * t * t - (t * t * t) / 38710000)
}

export function getSubsolarPoint(date: Date): Coordinates {
	const julianDate = getJulianDate(date)
	const t = (julianDate - J2000) / 36525
	const meanLongitude = normalizeDegrees(280.46646 + t * (36000.76983 + t * 0.0003032))
	const meanAnomaly = normalizeDegrees(357.52911 + t * (35999.05029 - 0.0001537 * t))
	const anomalyRad = toRadians(meanAnomaly)
	const equationOfCenter =
		Math.sin(anomalyRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
		Math.sin(2 * anomalyRad) * (0.019993 - 0.000101 * t) +
		Math.sin(3 * anomalyRad) * 0.000289
	const trueLongitude = meanLongitude + equationOfCenter
	const omega = 125.04 - 1934.136 * t
	const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(toRadians(omega))
	const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))
	const meanObliquity = 23 + (26 + seconds / 60) / 60
	const obliquity = meanObliquity + 0.00256 * Math.cos(toRadians(omega))
	const apparentLongitudeRad = toRadians(apparentLongitude)
	const obliquityRad = toRadians(obliquity)
	const rightAscension = normalizeDegrees(toDegrees(Math.atan2(Math.cos(obliquityRad) * Math.sin(apparentLongitudeRad), Math.cos(apparentLongitudeRad))))
	const declination = toDegrees(Math.asin(Math.sin(obliquityRad) * Math.sin(apparentLongitudeRad)))
	const greenwichSiderealTime = getGreenwichMeanSiderealTime(julianDate)

	return {
		lat: declination,
		lon: normalizeLongitude(rightAscension - greenwichSiderealTime)
	}
}

export function getEquationOfTimeMinutes(date: Date) {
	const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0)
	const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - startOfYear) / DAY_MS)
	const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
	const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24)

	return 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma))
}

export function getSunAltitude(date: Date, coordinates: Coordinates) {
	const point = coordinatesToVector(coordinates)
	const sun = coordinatesToVector(getSubsolarPoint(date))
	const dot = clamp(point.x * sun.x + point.y * sun.y + point.z * sun.z, -1, 1)
	return toDegrees(Math.asin(dot))
}

export function getDaylightLabel(altitude: number) {
	if (altitude >= 6) return '白昼'
	if (altitude >= 0) return '低角度日照'
	if (altitude >= -6) return '民用晨昏'
	if (altitude >= -12) return '航海晨昏'
	if (altitude >= -18) return '天文晨昏'
	return '夜晚'
}

function getTimeZoneAt({ lat, lon }: Coordinates) {
	try {
		return tzLookup(lat, lon)
	} catch {
		const offset = clamp(Math.round(lon / 15), -12, 14)
		if (offset === 0) return 'Etc/UTC'
		return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${Math.abs(offset)}`
	}
}

function getDateTimeParts(date: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat('zh-CN', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(date)

	const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || ''

	return {
		year: getPart('year'),
		month: getPart('month'),
		day: getPart('day'),
		hour: getPart('hour'),
		minute: getPart('minute'),
		second: getPart('second')
	}
}

function getUtcOffsetLabel(date: Date, timeZone: string) {
	try {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hour: '2-digit',
			timeZoneName: 'shortOffset'
		}).formatToParts(date)
		const value = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT'
		if (value === 'GMT') return 'UTC+00:00'

		const match = value.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
		if (!match) return value.replace('GMT', 'UTC')

		const [, sign, hours, minutes = '00'] = match
		return `UTC${sign}${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`
	} catch {
		return 'UTC'
	}
}

function getSolarDate(date: Date, lon: number, equationOfTimeMinutes: number) {
	const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000
	const apparentSolarMinutes = utcMinutes + lon * 4 + equationOfTimeMinutes
	const solarDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + apparentSolarMinutes * 60_000)

	return {
		date: `${solarDate.getUTCFullYear()}-${String(solarDate.getUTCMonth() + 1).padStart(2, '0')}-${String(solarDate.getUTCDate()).padStart(2, '0')}`,
		time: `${String(solarDate.getUTCHours()).padStart(2, '0')}:${String(solarDate.getUTCMinutes()).padStart(2, '0')}:${String(solarDate.getUTCSeconds()).padStart(2, '0')}`
	}
}

export function getWorldClockReading(date: Date, coordinates: Coordinates): WorldClockReading {
	const normalizedCoordinates = {
		lat: clamp(coordinates.lat, -90, 90),
		lon: normalizeLongitude(coordinates.lon)
	}
	const timeZone = getTimeZoneAt(normalizedCoordinates)
	const standardParts = getDateTimeParts(date, timeZone)
	const equationOfTimeMinutes = getEquationOfTimeMinutes(date)
	const solarDate = getSolarDate(date, normalizedCoordinates.lon, equationOfTimeMinutes)
	const sunAltitude = getSunAltitude(date, normalizedCoordinates)

	return {
		coordinates: normalizedCoordinates,
		timeZone,
		utcOffset: getUtcOffsetLabel(date, timeZone),
		standardDate: `${standardParts.year}-${standardParts.month}-${standardParts.day}`,
		standardTime: `${standardParts.hour}:${standardParts.minute}:${standardParts.second}`,
		solarDate: solarDate.date,
		solarTime: solarDate.time,
		equationOfTimeMinutes,
		sunAltitude,
		daylightLabel: getDaylightLabel(sunAltitude),
		subsolar: getSubsolarPoint(date)
	}
}

export function formatCoordinate(value: number, positive: string, negative: string) {
	const direction = value >= 0 ? positive : negative
	return `${Math.abs(value).toFixed(2)}°${direction}`
}

export function formatSignedMinutes(value: number) {
	const sign = value >= 0 ? '+' : '-'
	return `${sign}${Math.abs(value).toFixed(1)} min`
}
