import { isPageKey } from '../_shared/page-key.ts'

const headers = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'content-type'
}

Deno.serve(async request => {
	const reply = (status: number) => new Response(null, { status, headers })
	if (request.method === 'OPTIONS') return reply(204)
	if (request.method !== 'POST') return reply(405)

	const key = await request.text()
	if (!isPageKey(key)) return reply(400)

	const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
	const result = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/increment_page_view`, {
		method: 'POST',
		headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ p_page_key: key })
	})
	return reply(result.ok ? 204 : 502)
})
