'use client'

import { readTextFileFromRepo } from '@/lib/github-client'

export type BlogIndexItem = {
	slug: string
	title: string
	tags: string[]
	date: string
	summary?: string
	cover?: string
}

async function readBlogsIndex(token: string, owner: string, repo: string, branch: string): Promise<BlogIndexItem[]> {
	const indexPath = 'public/blogs/index.json'
	const txt = await readTextFileFromRepo(token, owner, repo, indexPath, branch)
	return txt ? JSON.parse(txt) : []
}

function sortBlogsIndex(list: BlogIndexItem[]) {
	return list.sort((a, b) => b.date.localeCompare(a.date))
}

export async function prepareBlogsIndex(token: string, owner: string, repo: string, item: BlogIndexItem, branch: string): Promise<string> {
	const list = await readBlogsIndex(token, owner, repo, branch)
	const map = new Map<string, BlogIndexItem>(list.map(i => [i.slug, i]))
	map.set(item.slug, item)
	const next = sortBlogsIndex(Array.from(map.values()))
	return JSON.stringify(next, null, 2)
}

export async function removeBlogsFromIndex(token: string, owner: string, repo: string, slugs: string[], branch: string): Promise<string> {
	const list = await readBlogsIndex(token, owner, repo, branch)
	const slugSet = new Set(slugs.filter(Boolean))
	const next = list.filter(item => !slugSet.has(item.slug))
	return JSON.stringify(next, null, 2)
}
