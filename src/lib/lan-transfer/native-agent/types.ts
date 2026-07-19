export const NATIVE_AGENT_BRIDGE_VERSION = 1
export const NATIVE_AGENT_BENCHMARK_VERSION = 3
export const NATIVE_AGENT_LNA_HTTP_VERSION = 1

export type LanNativeBenchmarkDirection = 'browser-to-agent' | 'agent-to-browser'

export const NATIVE_AGENT_BROWSER_TO_AGENT_SESSIONS = 6
export const NATIVE_AGENT_AGENT_TO_BROWSER_SESSIONS = 6

export function nativeAgentBenchmarkSessionCount(direction: LanNativeBenchmarkDirection) {
	return direction === 'browser-to-agent' ? NATIVE_AGENT_BROWSER_TO_AGENT_SESSIONS : NATIVE_AGENT_AGENT_TO_BROWSER_SESSIONS
}

export type LanNativeAgentAdvertisement = {
	bridgeVersion: typeof NATIVE_AGENT_BRIDGE_VERSION
	benchmarkVersion: typeof NATIVE_AGENT_BENCHMARK_VERSION
	ownerDeviceId: string
	endpoints: string[]
	lnaHttpVersion: typeof NATIVE_AGENT_LNA_HTTP_VERSION
	lnaHttpEndpoints: string[]
	certificateSha256: string
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
	certificateSha256: string
	launchToken: string
	expiresAt: number
}

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
