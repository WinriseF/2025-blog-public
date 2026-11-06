import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'

// Library assets only: no database file or query is sent to this endpoint.
export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
	const { asset } = await params
	if (asset !== 'index.mjs' && asset !== 'sqlite3.wasm') return new Response(null, { status: 404 })
	const bytes = await readFile(path.join(process.cwd(), 'node_modules/@sqlite.org/sqlite-wasm/dist', asset))
	return new Response(new Uint8Array(bytes), {
		headers: {
			'Content-Type': asset.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8',
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	})
}
