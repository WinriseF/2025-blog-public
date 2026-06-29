import type { ReactNode } from 'react'

type ToolPageShellProps = {
	children: ReactNode
	mobileFlush?: boolean
}

export function ToolPageShell({ children, mobileFlush = false }: ToolPageShellProps) {
	const shellClass = `relative mx-auto max-w-[1280px] px-6 pt-36 pb-12 text-sm max-sm:pt-24 ${mobileFlush ? 'max-sm:px-0' : 'max-sm:px-4'}`
	const mainClass = `card bg-article static overflow-auto rounded-xl p-8 ${
		mobileFlush ? 'max-sm:overflow-visible max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:[backdrop-filter:none] max-sm:[box-shadow:none]' : 'max-sm:p-4'
	}`

	return (
		<div className={shellClass}>
			<main className={mainClass}>{children}</main>
		</div>
	)
}
