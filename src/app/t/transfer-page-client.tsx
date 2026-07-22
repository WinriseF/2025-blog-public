'use client'

import dynamic from 'next/dynamic'

const TransferTool = dynamic(() => import('../toolbox/transfer-tool').then(mod => mod.TransferTool), {
	ssr: false,
	loading: () => <div className='text-secondary rounded-2xl border border-border bg-article px-4 py-3 text-sm'>中转站加载中...</div>
})

type TransferPageClientProps = {
	initialCode?: string
}

export function TransferPageClient({ initialCode = '' }: TransferPageClientProps) {
	return <TransferTool initialCode={initialCode} />
}
