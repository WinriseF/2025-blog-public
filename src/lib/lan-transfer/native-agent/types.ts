export const NATIVE_AGENT_BRIDGE_VERSION = 1
export const NATIVE_AGENT_BENCHMARK_VERSION = 2

export type LanNativeAgentAdvertisement = {
	bridgeVersion: typeof NATIVE_AGENT_BRIDGE_VERSION
	benchmarkVersion: typeof NATIVE_AGENT_BENCHMARK_VERSION
	ownerDeviceId: string
	endpoints: string[]
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
	certificateSha256: string
	launchToken: string
	expiresAt: number
}

export type LanNativeBenchmarkDirection = 'browser-to-agent' | 'agent-to-browser'

export type LanNativeBenchmarkProgress = {
	direction: LanNativeBenchmarkDirection
	bytes: number
	totalBytes: number
	startedAt: number
}

export type LanNativeBenchmarkResult = {
	direction: LanNativeBenchmarkDirection
	bytes: number
	clientElapsedMs: number
	agentElapsedMs: number
	clientMbps: number
	agentMbps: number
}
