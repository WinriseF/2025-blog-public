import fixture from '../../../../protocol-fixtures/native-file-v1.json'

type NativeFileProtocolFixture = {
	lanSessionVersion: number
	bridgeVersion: number
	fileVersion: number
	bridgeFrameMaxBytes: number
	lnaHttp: { basePath: string; segmentBytes: number; parallelism: number; ioBlockBytes: number }
	webTransport: { path: string; connections: number; lanesPerConnection: number; extentBytes: number; ioBlockBytes: number }
	authorization: { hardExpiryMs: number; idleTimeoutMs: number; lnaTokenBytes: number; webTransportTokenBytes: number }
	dataPlanes: string[]
	directions: string[]
}

export const nativeFileProtocolFixture: NativeFileProtocolFixture = fixture
