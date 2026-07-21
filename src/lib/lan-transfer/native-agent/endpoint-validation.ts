export type NativeEndpointAddressKind = 'private-ipv4' | 'ula-ipv6' | 'gua-ipv6'

export function validLanWebTransportEndpoint(value: string) {
	return validLanEndpoint(value, 'https:', '/winrisef/benchmark/v3', true)
}

export function validLanHttpBaseEndpoint(value: string) {
	return validLanEndpoint(value, 'http:', '/winrisef/lna/v1', false)
}

export function validLanFileHttpEndpoint(value: string) {
	return validLanEndpoint(value, 'http:', '/winrisef/file/v1', false)
}

export function validLanFileWebTransportEndpoint(value: string) {
	return validLanEndpoint(value, 'https:', '/winrisef/file/v1', true)
}

export function endpointAddressKind(endpoint: string): NativeEndpointAddressKind | null {
	try {
		return ipAddressKind(new URL(endpoint).hostname)
	} catch {
		return null
	}
}

export function filterNativeEndpoints(values: unknown[], validate: (value: string) => boolean) {
	return [...new Set(values.filter((value): value is string => typeof value === 'string' && validate(value)))]
}

export function ipAddressKind(value: string): NativeEndpointAddressKind | null {
	const hostname = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
	if (!hostname || hostname.includes('%')) return null
	const ipv4 = parseIpv4(hostname)
	if (ipv4) {
		const [a, b] = ipv4
		return a === 10 || (a === 100 && b! >= 64 && b! <= 127) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)
			? 'private-ipv4'
			: null
	}
	const ipv6 = parseIpv6(hostname)
	if (!ipv6 || isIpv4Mapped(ipv6)) return null
	if ((ipv6[0]! & 0xfe00) === 0xfc00) return 'ula-ipv6'
	if ((ipv6[0]! & 0xe000) !== 0x2000) return null
	if (ipv6[0] === 0x2001 && ipv6[1] === 0x0db8) return null
	return 'gua-ipv6'
}

function validLanEndpoint(value: string, protocol: 'http:' | 'https:', pathname: string, publicIpv6: boolean) {
	try {
		const url = new URL(value)
		const addressKind = ipAddressKind(url.hostname)
		return (
			url.protocol === protocol &&
			url.pathname === pathname &&
			Boolean(url.port) &&
			Number(url.port) > 0 &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash &&
			Boolean(addressKind) &&
			(publicIpv6 || addressKind !== 'gua-ipv6')
		)
	} catch {
		return false
	}
}

function parseIpv4(value: string) {
	const parts = value.split('.')
	if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part))) return null
	const octets = parts.map(Number)
	return octets.every(octet => octet <= 255) ? octets : null
}

function parseIpv6(value: string) {
	if (!/^[0-9a-f:]+$/i.test(value) || value.split('::').length > 2) return null
	const compressed = value.includes('::')
	const [left = '', right = ''] = value.split('::')
	const before = left ? left.split(':') : []
	const after = right ? right.split(':') : []
	if ([...before, ...after].some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return null
	const missing = 8 - before.length - after.length
	if ((!compressed && missing !== 0) || (compressed && missing < 1)) return null
	return [...before.map(part => Number.parseInt(part, 16)), ...new Array<number>(missing).fill(0), ...after.map(part => Number.parseInt(part, 16))]
}

function isIpv4Mapped(segments: number[]) {
	return segments.slice(0, 5).every(segment => segment === 0) && segments[5] === 0xffff
}
