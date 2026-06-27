import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

type ToolPageShellProps = {
	eyebrow: string
	title: string
	description: string
	children: ReactNode
}

export function ToolPageShell({ eyebrow, title, description, children }: ToolPageShellProps) {
	return (
		<div className='relative mx-auto max-w-[1280px] px-6 pt-28 pb-12 text-sm max-sm:px-4 max-sm:pt-24'>
			<header className='mb-5 flex flex-col items-start sm:absolute sm:top-8 sm:right-6 sm:mb-0 sm:max-w-[360px] sm:items-end sm:text-right'>
				<Link href='/toolbox' className='text-secondary hover:text-primary mb-4 inline-flex items-center gap-2 text-xs font-medium transition'>
					<ArrowLeft size={14} />
					工具箱
				</Link>
				<div>
					<p className='text-secondary text-xs tracking-[0.2em] uppercase'>{eyebrow}</p>
					<h1 className='mt-1 text-2xl font-semibold'>{title}</h1>
					<p className='text-secondary mt-2'>{description}</p>
				</div>
			</header>
			<main className='card bg-article static overflow-auto rounded-xl p-8 sm:mt-24 max-sm:p-4'>{children}</main>
		</div>
	)
}
