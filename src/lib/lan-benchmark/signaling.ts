import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { LAN_BENCHMARK_PROTOCOL_VERSION, randomBenchmarkId, type BenchmarkRole, type BenchmarkSession } from './types'

export type BenchmarkSignalType = 'hello' | 'offer' | 'answer' | 'candidate' | 'leave'

export type BenchmarkSignal = {
	version: typeof LAN_BENCHMARK_PROTOCOL_VERSION
	type: BenchmarkSignalType
	roomId: string
	tokenHash: string
	from: string
	to: string
	role: BenchmarkRole
	description?: RTCSessionDescriptionInit
	candidate?: RTCIceCandidateInit | null
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
let client: SupabaseClient | null = null

function getClient() {
	if (!supabaseUrl || !supabaseKey) throw new Error('连接服务未配置，暂不能进行双端基准测试')
	client ||= createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } })
	return client
}

function base64url(bytes: Uint8Array) {
	let value = ''
	bytes.forEach(byte => { value += String.fromCharCode(byte) })
	return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(bytes: number) {
	const value = new Uint8Array(bytes)
	crypto.getRandomValues(value)
	return base64url(value)
}

async function hash(value: string) {
	return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

function isSignal(value: unknown): value is BenchmarkSignal {
	if (!value || typeof value !== 'object') return false
	const signal = value as Partial<BenchmarkSignal>
	return signal.version === LAN_BENCHMARK_PROTOCOL_VERSION
		&& ['hello', 'offer', 'answer', 'candidate', 'leave'].includes(signal.type || '')
		&& typeof signal.roomId === 'string'
		&& typeof signal.tokenHash === 'string'
		&& typeof signal.from === 'string'
		&& typeof signal.to === 'string'
		&& (signal.role === 'host' || signal.role === 'guest')
}

export async function createBenchmarkSession(role: BenchmarkRole, roomId = randomToken(9), token = randomToken(18)): Promise<BenchmarkSession> {
	return { roomId, token, tokenHash: await hash(token), instanceId: randomBenchmarkId('instance'), role }
}

export class BenchmarkSignalingClient {
	private channel: RealtimeChannel | null = null
	private closed = false
	private helloTimer: number | null = null
	private resolveReady!: () => void
	private rejectReady!: (error: Error) => void
	readonly ready: Promise<void>

	constructor(
		private readonly session: BenchmarkSession,
		private readonly onSignal: (signal: BenchmarkSignal) => void,
		private readonly onStatus: (status: string) => void,
	) {
		this.ready = new Promise<void>((resolve, reject) => {
			this.resolveReady = resolve
			this.rejectReady = reject
		})
		this.connect()
	}

	private connect() {
		try {
			const channel = getClient().channel(`lan-benchmark:${this.session.roomId}`, { config: { broadcast: { ack: true, self: false } } })
			this.channel = channel
			channel.on('broadcast', { event: 'benchmark' }, event => this.receive(event.payload))
			channel.subscribe(status => {
				if (this.closed || this.channel !== channel) return
				if (status === 'SUBSCRIBED') {
					this.onStatus('诊断信令已连接，正在等待另一台设备')
					this.resolveReady()
					void this.send('hello').catch(() => {})
					this.helloTimer = window.setInterval(() => void this.send('hello').catch(() => {}), 3_000)
					return
				}
				if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
					this.onStatus('诊断信令连接失败')
					this.rejectReady(new Error('诊断信令连接失败'))
				}
			})
		} catch (error) {
			this.rejectReady(error instanceof Error ? error : new Error('无法创建诊断信令'))
		}
	}

	private receive(value: unknown) {
		if (!isSignal(value)) return
		if (value.roomId !== this.session.roomId || value.tokenHash !== this.session.tokenHash || value.from === this.session.instanceId) return
		if (value.to !== '*' && value.to !== this.session.instanceId) return
		this.onSignal(value)
	}

	async send(type: BenchmarkSignalType, details: Pick<BenchmarkSignal, 'description' | 'candidate'> = {}, to = '*') {
		if (this.closed || !this.channel) return
		const signal: BenchmarkSignal = {
			version: LAN_BENCHMARK_PROTOCOL_VERSION,
			type,
			roomId: this.session.roomId,
			tokenHash: this.session.tokenHash,
			from: this.session.instanceId,
			to,
			role: this.session.role,
			...details,
		}
		const result = await this.channel.send({ type: 'broadcast', event: 'benchmark', payload: signal })
		if (result !== 'ok') throw new Error('诊断信令发送失败')
	}

	async close() {
		if (this.closed) return
		this.closed = true
		if (this.helloTimer !== null) window.clearInterval(this.helloTimer)
		this.helloTimer = null
		const channel = this.channel
		this.channel = null
		if (!channel) return
		await channel.send({ type: 'broadcast', event: 'benchmark', payload: { version: LAN_BENCHMARK_PROTOCOL_VERSION, type: 'leave', roomId: this.session.roomId, tokenHash: this.session.tokenHash, from: this.session.instanceId, to: '*', role: this.session.role } satisfies BenchmarkSignal }).catch(() => {})
		await getClient().removeChannel(channel).catch(() => {})
	}
}
