export const NATIVE_AGENT_BRIDGE_VERSION = 3
export const NATIVE_AGENT_BENCHMARK_VERSION = 3
export const NATIVE_AGENT_LNA_HTTP_VERSION = 1
export const NATIVE_AGENT_FILE_VERSION = 1

export type LanNativeBenchmarkDirection = 'browser-to-agent' | 'agent-to-browser'

export const NATIVE_AGENT_SESSION_COUNT = 6

export type LanNativePublicIpv6State = 'not-present' | 'authorizing' | 'available' | 'unavailable'

export type LanNativeAgentAdvertisement = {
	bridgeVersion: typeof NATIVE_AGENT_BRIDGE_VERSION
	benchmarkVersion: typeof NATIVE_AGENT_BENCHMARK_VERSION
	ownerDeviceId: string
	endpoints: string[]
	lnaHttpVersion: typeof NATIVE_AGENT_LNA_HTTP_VERSION
	lnaHttpEndpoints: string[]
	fileVersion: typeof NATIVE_AGENT_FILE_VERSION
	fileHttpEndpoints: string[]
	fileWebTransportEndpoints: string[]
	certificateSha256: string
	networkEpoch: string
	publicIpv6State: LanNativePublicIpv6State
}

export type LanNativeAgentTicket = LanNativeAgentAdvertisement & {
	token: string
	expiresAt: number
}

export type LanNativeAgentCallback = {
	nonce: string
	bridgeEndpoint: string
	benchmarkEndpoints: string[]
	lnaHttpEndpoints: string[]
	fileHttpEndpoints: string[]
	fileWebTransportEndpoints: string[]
	certificateSha256: string
	launchToken: string
	expiresAt: number
	bridgeVersion: typeof NATIVE_AGENT_BRIDGE_VERSION
	networkEpoch: string
	publicIpv6State: LanNativePublicIpv6State
}

export type LanNativeNetworkEndpointSnapshot = {
	networkEpoch: string
	benchmarkEndpoints: string[]
	lnaHttpEndpoints: string[]
	fileHttpEndpoints: string[]
	fileWebTransportEndpoints: string[]
	publicIpv6State: LanNativePublicIpv6State
}

export type LanNativeFileDirection = 'agent-to-browser' | 'browser-to-agent'
export type LanNativeFileDataPlane = 'native-lna-http' | 'native-webtransport'

export type LanNativeSelectedFile = {
	sourceId: string
	name: string
	mime: string
	size: number
	lastModified: number
}

export type LanNativeTransferAuthorization =
	| { kind: 'lna-http'; token: string }
	| { kind: 'web-transport'; tokens: string[] }

export type LanNativeTransferGrant = {
	transferId: string
	attachmentId: string
	ownerDeviceId: string
	authorization: LanNativeTransferAuthorization
	fileHttpEndpoints: string[]
	fileWebTransportEndpoints: string[]
	certificateSha256: string
	networkEpoch: string
}

export type LanNativeTransferEvent =
	| { type: 'transfer-progress'; transferId: string; attachmentId: string; bytes: number }
	| { type: 'transfer-confirming'; transferId: string; attachmentId: string; bytes: number }
	| { type: 'transfer-complete'; transferId: string; attachmentId: string }
	| { type: 'transfer-failed'; transferId: string; attachmentId: string; error: string }
	| { type: 'transfer-cancelled'; transferId: string; attachmentId: string }

export type LanNativeBenchmarkProgress = {
	direction: LanNativeBenchmarkDirection
	transport: 'lna-http' | 'webtransport'
	sessionCount: number
	bytes: number
	totalBytes: number
	startedAt: number
}

export type LanNativeBenchmarkResult = {
	direction: LanNativeBenchmarkDirection
	transport: 'lna-http' | 'webtransport'
	sessionCount: number
	bytes: number
	clientElapsedMs: number
	agentElapsedMs: number
	clientMbps: number
	agentMbps: number
}
