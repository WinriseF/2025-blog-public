function classifyTransferObject(key) {
	if (/\/chunks\/part-\d+\.bin$/.test(key)) return 'chunk'
	if (key.endsWith('/meta.json')) return 'meta'
	if (key.endsWith('/consumed.json')) return 'consumed'
	if (key.startsWith('transfer/codes/')) return 'code-index'
	if (key.startsWith('transfer/expires/')) return 'expire-index'
	if (key.startsWith('transfer/rate/')) return 'rate'
	return 'other'
}

function normalizeTopLimit(value, limits) {
	const number = Number(value)
	if (!Number.isFinite(number)) return limits.statsTopLimit
	return Math.max(0, Math.min(limits.statsMaxTopLimit, Math.floor(number)))
}

function compactErrorMessage(error) {
	const message = error instanceof Error ? error.message : String(error)
	return message.replace(/\s+/g, ' ').slice(0, 300)
}

export async function assertTransferAdminPassword(input, context) {
	const expected = context.getRequiredEnv(context.env, 'TRANSFER_ADMIN_PASSWORD_HASH')
	const password = String(input?.password || '')
	if (!password || !context.safeEqual(await context.sha256(password), expected)) throw new context.TransferError(401, 'unauthorized', 'Invalid admin password')
}

export async function collectTransferStats(input, context) {
	await assertTransferAdminPassword(input, context)
	const store = await context.getTransferStore(context.env)
	const topLimit = normalizeTopLimit(input?.topLimit, context.limits)
	const { blobs } = await store.list({ prefix: 'transfer/', consistency: 'strong' })
	const rows = []
	const errors = []
	const byType = {}
	let totalBytes = 0

	for (let index = 0; index < blobs.length; index += context.limits.statsMetadataBatchSize) {
		const batch = blobs.slice(index, index + context.limits.statsMetadataBatchSize)
		const details = await Promise.all(
			batch.map(async blob => {
				const type = classifyTransferObject(blob.key)
				try {
					const metadata = await store.getMetadata(blob.key, { consistency: 'strong' })
					const bytes = Number(metadata?.headers?.['content-length'] || 0)
					return {
						key: blob.key,
						type,
						bytes: Number.isFinite(bytes) ? bytes : 0,
						contentType: metadata?.contentType || '',
						etag: metadata?.etag || blob.etag || ''
					}
				} catch (error) {
					return {
						key: blob.key,
						type,
						bytes: 0,
						contentType: '',
						etag: blob.etag || '',
						error: compactErrorMessage(error)
					}
				}
			})
		)

		for (const item of details) {
			totalBytes += item.bytes
			const bucket = byType[item.type] || { count: 0, bytes: 0 }
			bucket.count += 1
			bucket.bytes += item.bytes
			byType[item.type] = bucket
			rows.push(item)
			if (item.error) errors.push({ key: item.key, type: item.type, message: item.error })
		}
	}

	rows.sort((a, b) => b.bytes - a.bytes)
	const top = rows
		.filter(item => !item.error)
		.slice(0, topLimit)
	return {
		ok: true,
		generatedAt: Date.now(),
		store: context.transferStoreName(context.env),
		objectCount: rows.length,
		totalBytes,
		byType,
		metadataErrorCount: errors.length,
		errors: errors.slice(0, topLimit),
		top
	}
}
