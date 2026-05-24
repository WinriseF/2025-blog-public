import { NextResponse } from 'next/server'
import { getNewsArticle } from '@/lib/news'

type NewsArticleRouteContext = {
	params: Promise<{
		date: string
	}>
}

export async function GET(_request: Request, context: NewsArticleRouteContext) {
	const { date } = await context.params
	const result = await getNewsArticle(date)

	if (!result.ok) {
		return NextResponse.json(
			{
				error: result.error
			},
			{
				status: result.status || 400
			}
		)
	}

	return NextResponse.json(result.data, {
		headers: {
			'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400'
		}
	})
}
