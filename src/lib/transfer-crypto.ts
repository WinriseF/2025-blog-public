'use client'

import type { TransferPublicMeta } from './transfer-types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const PROOF_LABEL = encoder.encode('message-transfer-proof-v1')
const DEFAULT_ITERATIONS = 150000

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const { buffer, byteOffset, byteLength } = bytes
	if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer
	return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer
}

export function bytesToBase64Url(bytes: Uint8Array) {
	let binary = ''
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value: string) {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

export function encodeTextPayload(value: string) {
	return encoder.encode(value)
}

export function decodeTextPayload(value: Uint8Array) {
	return decoder.decode(value)
}

async function sha256(bytes: Uint8Array) {
	const hash = await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(bytes))
	return new Uint8Array(hash)
}

function concatBytes(...chunks: Uint8Array[]) {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
	const output = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.length
	}
	return output
}

async function derive(password: string, salt: Uint8Array) {
	const material = await crypto.subtle.importKey('raw', bytesToArrayBuffer(encoder.encode(password)), 'PBKDF2', false, ['deriveBits'])
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt: bytesToArrayBuffer(salt),
			iterations: DEFAULT_ITERATIONS
		},
		material,
		256
	)
	const rawKey = new Uint8Array(bits)
	const key = await crypto.subtle.importKey('raw', bytesToArrayBuffer(rawKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
	const proof = bytesToBase64Url(await sha256(concatBytes(PROOF_LABEL, rawKey)))
	return { key, proof }
}

export async function encryptTransferPayload(plain: Uint8Array, password: string) {
	const salt = crypto.getRandomValues(new Uint8Array(16))
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const { key, proof } = await derive(password, salt)
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytesToArrayBuffer(iv) }, key, bytesToArrayBuffer(plain))
	return {
		cipher: new Uint8Array(cipher),
		salt: bytesToBase64Url(salt),
		iv: bytesToBase64Url(iv),
		proof
	}
}

export async function deriveTransferProof(password: string, meta: TransferPublicMeta) {
	return derive(password, base64UrlToBytes(meta.salt))
}

export async function decryptTransferPayload(cipher: ArrayBuffer, password: string, meta: TransferPublicMeta) {
	const { key } = await deriveTransferProof(password, meta)
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesToArrayBuffer(base64UrlToBytes(meta.iv)) }, key, cipher)
	return new Uint8Array(plain)
}
