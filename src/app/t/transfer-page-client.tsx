'use client'

import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { toast } from 'sonner'

const TransferTool = dynamic(() => import('../toolbox/transfer-tool').then(mod => mod.TransferTool), {
	ssr: false,
	loading: () => <div className='text-secondary rounded-2xl border border-border bg-article px-4 py-3 text-sm'>中转站加载中...</div>
})

type TransferPageClientProps = {
	initialCode?: string
}

export function TransferPageClient({ initialCode = '' }: TransferPageClientProps) {
	useEffect(() => {
		const url = new URL(window.location.href)
		const agentReady = url.searchParams.get('agent-ready')
		if (agentReady === null) return

		if (agentReady === '1') {
			toast.success('极速组件已准备完成', {
				description: '以后只需在网页开启极速模式；如果移动或重命名 EXE，请再次双击它。',
				duration: 8000
			})
		} else {
			toast.error('极速组件注册失败', {
				description: '请重试；仍然失败时可查看“文档/WinriseF-Agent-Logs”中的最新日志。',
				duration: 10000
			})
		}

		url.searchParams.delete('agent-ready')
		const search = url.searchParams.toString()
		window.history.replaceState(
			window.history.state,
			'',
			`${url.pathname}${search ? `?${search}` : ''}${url.hash}`
		)
	}, [])

	return <TransferTool initialCode={initialCode} />
}
