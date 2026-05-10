import useSWR from 'swr'

const BLOG_WORD_CLOUD_URL = '/blogs/word-cloud.json'

export type BlogWordCloudArticleRef = {
	slug: string
	title: string
	count: number
}

export type BlogWordCloudWord = {
	text: string
	weight: number
	count: number
	articles: BlogWordCloudArticleRef[]
}

export type BlogWordCloudGroup = {
	year: string
	articleCount: number
	words: BlogWordCloudWord[]
}

export type BlogWordCloudData = {
	years: BlogWordCloudGroup[]
	all: BlogWordCloudGroup
}

const fetcher = async (url: string): Promise<BlogWordCloudData> => {
	const res = await fetch(url, { cache: 'force-cache' })
	if (!res.ok) {
		throw new Error('Failed to load blog word cloud')
	}
	return res.json()
}

export function useBlogWordCloud() {
	const { data, error, isLoading } = useSWR<BlogWordCloudData>(BLOG_WORD_CLOUD_URL, fetcher, {
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		revalidateIfStale: false,
		dedupingInterval: 5 * 60 * 1000,
		keepPreviousData: true
	})

	return {
		data,
		years: data?.years || [],
		loading: isLoading,
		error
	}
}
