const HEALTH_HEADERS = {
	'Cache-Control': 'no-store',
	'X-Health-Check': 'ok'
}

function healthy(): Response {
	return new Response(null, {
		status: 204,
		headers: HEALTH_HEADERS
	})
}

export function GET(): Response {
	return healthy()
}

export function HEAD(): Response {
	return healthy()
}
