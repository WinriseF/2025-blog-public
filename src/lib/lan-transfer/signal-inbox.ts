import type { LanPeer, LanSignalMessage } from './types'

const signalTtlMs = 10_000

export function newerLanPeer(current: LanPeer | undefined, candidate: LanPeer) {
	if (!current || candidate.startedAt !== current.startedAt) return !current || candidate.startedAt > current.startedAt
	return candidate.instanceId > current.instanceId
}

// Broadcast and Presence can arrive in either order, including during page replacement.
export class LanSignalInbox {
	private peers = new Map<string, LanPeer>()
	private retiredInstances = new Set<string>()
	private pending = new Map<string, { receivedAt: number; message: LanSignalMessage }[]>()

	confirm(peer: LanPeer) {
		const previous = this.peers.get(peer.deviceId)
		if (previous && peer.startedAt < previous.startedAt) return false
		if (previous && previous.instanceId !== peer.instanceId) {
			if (!newerLanPeer(previous, peer)) return false
			const oldKey = this.key(previous.deviceId, previous.instanceId)
			this.retiredInstances.add(oldKey)
			this.pending.delete(oldKey)
			if (this.retiredInstances.size > 64) this.retiredInstances.delete(this.retiredInstances.values().next().value as string)
		}
		this.peers.set(peer.deviceId, peer)
		return true
	}

	push(message: LanSignalMessage) {
		this.prune()
		const key = this.key(message.fromDeviceId, message.fromInstanceId)
		if (this.retiredInstances.has(key)) return
		const messages = this.pending.get(key) || []
		messages.push({ receivedAt: Date.now(), message })
		this.pending.set(key, messages.slice(-64))
		if (this.pending.size > 32) this.pending.delete(this.pending.keys().next().value as string)
	}

	take(peer: LanPeer) {
		this.prune()
		const key = this.key(peer.deviceId, peer.instanceId)
		const messages = this.pending.get(key) || []
		this.pending.delete(key)
		return messages.map(entry => entry.message)
	}

	clear() {
		this.peers.clear()
		this.retiredInstances.clear()
		this.pending.clear()
	}

	private prune() {
		const cutoff = Date.now() - signalTtlMs
		for (const [key, entries] of this.pending) {
			const current = entries.filter(entry => entry.receivedAt > cutoff)
			if (current.length) this.pending.set(key, current)
			else this.pending.delete(key)
		}
	}

	private key(deviceId: string, instanceId: string) {
		return `${deviceId}:${instanceId}`
	}
}
