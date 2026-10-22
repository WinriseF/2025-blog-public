'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

const TransferTool = dynamic(() => import('../toolbox/transfer-tool').then(mod => mod.TransferTool), {
	ssr: false,
	loading: () => <p role='status' className='text-secondary py-12 text-center text-sm'>快传加载中…</p>
})

type TransferPageClientProps = {
	initialCode?: string
}

export function TransferPageClient({ initialCode = '' }: TransferPageClientProps) {
	return (
		<div className='relative mx-auto w-full max-w-[1040px] px-4 pt-24 pb-12 text-primary sm:px-8 sm:pt-28'>
			<Link href='/' className='text-secondary mb-5 inline-flex items-center gap-2 rounded-lg px-1 py-2 text-sm hover:text-brand'><ArrowLeft size={16} />返回网站</Link>
			<main className='rounded-[28px] border border-brand/10 bg-article p-5 shadow-[0_20px_70px_-45px_var(--color-primary)] sm:p-8 lg:p-10'>
				<TransferTool initialCode={initialCode} />
			</main>
		</div>
	)
}
