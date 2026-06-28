import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

type ToolPageShellProps = {
	eyebrow: string
	title: string
	description: string
	children: ReactNode
	mobileFlush?: boolean
}

export function ToolPageShell({ eyebrow, title, description, children, mobileFlush = false }: ToolPageShellProps) {
	const shellClass = `relative mx-auto max-w-[1280px] px-6 pt-28 pb-12 text-sm max-sm:pt-24 ${mobileFlush ? 'max-sm:px-0' : 'max-sm:px-4'}`
	const headerClass = `mb-5 flex flex-col items-start sm:absolute sm:top-8 sm:right-6 sm:mb-0 sm:max-w-[360px] sm:items-end sm:text-right ${mobileFlush ? 'max-sm:px-4' : ''}`
	const mainClass = `card bg-article static overflow-auto rounded-xl p-8 sm:mt-24 ${
		mobileFlush ? 'max-sm:overflow-visible max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:[backdrop-filter:none] max-sm:[box-shadow:none]' : 'max-sm:p-4'
	}`

	return (
		<div className={shellClass}>
			<header className={headerClass}>
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
			<main className={mainClass}>{children}</main>
		</div>
	)
}
