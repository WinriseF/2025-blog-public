import { NextResponse } from 'next/server'
import { getNewsNowFocus, getNewsNowFocusUrl } from '@/lib/news'

export async function GET() {
	const sourceUrl = getNewsNowFocusUrl()
	const result = await getNewsNowFocus()

	if (!result.ok) {
		return NextResponse.json(
			{
				error: result.error,
				sourceUrl
			},
			{
				status: result.status || 502
			}
		)
	}

	return NextResponse.json(
		{
			sourceUrl,
			sources: result.data
		},
		{
			headers: {
				'Cache-Control': 'public, max-age=180, stale-while-revalidate=900'
			}
		}
	)
}
