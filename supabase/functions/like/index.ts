import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

async function sha256(value: string) {
	const data = new TextEncoder().encode(value)
	const hash = await crypto.subtle.digest('SHA-256', data)
	return Array.from(new Uint8Array(hash))
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders })
	}

	const url = new URL(req.url)
	const slug = url.searchParams.get('slug')?.trim()

	if (!slug) {
		return Response.json({ error: 'missing slug' }, { status: 400, headers: corsHeaders })
	}

	const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

	if (req.method === 'GET') {
		const { data, error } = await supabase.from('post_likes').select('count').eq('slug', slug).maybeSingle()

		if (error) {
			return Response.json({ error: error.message }, { status: 500, headers: corsHeaders })
		}

		return Response.json(
			{ count: data?.count ?? 0 },
			{
				headers: {
					...corsHeaders,
					'Cache-Control': 'public, max-age=30'
				}
			}
		)
	}

	if (req.method === 'POST') {
		const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || 'unknown'
		const ipHash = await sha256(`${slug}:${ip}`)

		const { error: limitError } = await supabase.from('post_like_daily_limits').insert({ slug, ip_hash: ipHash })

		if (limitError?.code === '23505') {
			const { data } = await supabase.from('post_likes').select('count').eq('slug', slug).maybeSingle()
			return Response.json({ count: data?.count ?? 0, reason: 'rate_limited' }, { status: 200, headers: corsHeaders })
		}

		if (limitError) {
			return Response.json({ error: limitError.message }, { status: 500, headers: corsHeaders })
		}

		const { data, error } = await supabase.rpc('increment_post_like', {
			like_slug: slug
		})

		if (error) {
			return Response.json({ error: error.message }, { status: 500, headers: corsHeaders })
		}

		return Response.json({ count: data ?? 1 }, { headers: corsHeaders })
	}

	return Response.json({ error: 'method not allowed' }, { status: 405, headers: corsHeaders })
})
