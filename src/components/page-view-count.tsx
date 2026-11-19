'use client'

import useSWR from 'swr'
import { pageViewEndpoint } from './page-view'

export function PageViewCount({ scope }: { scope: 'site' | 'toolbox' }) {
	const { data: views } = useSWR<number>(scope === 'toolbox' ? `${pageViewEndpoint}?scope=toolbox` : pageViewEndpoint, async (url: string) => {
		const response = await fetch(url)
		if (!response.ok) throw new Error('访问量读取失败')
		return response.json()
	})

	return (
		<p className='text-secondary mt-2 min-h-5 text-sm tabular-nums'>
			{typeof views === 'number' && `${scope === 'toolbox' ? '工具箱' : '全站'}累计访问 ${views.toLocaleString('zh-CN')} 次`}
		</p>
	)
}
