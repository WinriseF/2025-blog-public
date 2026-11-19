import { isPageKey } from '../_shared/page-key.ts'

const headers = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'content-type'
}

Deno.serve(async request => {
	const reply = (status: number) => new Response(null, { status, headers })
	if (request.method === 'OPTIONS') return reply(204)
	const reading = request.method === 'GET'
	if (!reading && request.method !== 'POST') return reply(405)

	const key = reading ? '' : await request.text()
	if (!reading && !isPageKey(key)) return reply(400)

	const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
	const result = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${reading ? 'total_page_views' : 'increment_page_view'}`, {
		method: 'POST',
		headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(reading ? {} : { p_page_key: key })
	})
	if (!result.ok) return reply(502)
	if (reading) return Response.json(await result.json(), { headers: { ...headers, 'Cache-Control': 'public, max-age=30' } })
	return reply(204)
})
