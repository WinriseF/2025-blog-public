export function validLanWebTransportEndpoint(value: string) {
	return validLanEndpoint(value, 'https:', '/winrisef/benchmark/v3')
}

export function validLanHttpBaseEndpoint(value: string) {
	return validLanEndpoint(value, 'http:', '/winrisef/lna/v1')
}

function validLanEndpoint(value: string, protocol: 'http:' | 'https:', pathname: string) {
	try {
		const url = new URL(value)
		return (
			url.protocol === protocol &&
			url.pathname === pathname &&
			Boolean(url.port) &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash &&
			isLocalIpv4(url.hostname)
		)
	} catch {
		return false
	}
}

function isLocalIpv4(hostname: string) {
	const octets = hostname.split('.').map(Number)
	if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
	return (
		octets[0] === 10 ||
		(octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127) ||
		(octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
		(octets[0] === 192 && octets[1] === 168) ||
		(octets[0] === 169 && octets[1] === 254)
	)
}
