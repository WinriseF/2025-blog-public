import { CheckCircle2, LoaderCircle, type LucideIcon } from 'lucide-react'

export type ZipFeedback = {
	state: 'working' | 'done' | 'error' | 'canceled'
	title: string
	detail?: string
	percent?: number
}

export function ZipAction({ label, icon: Icon, feedback, secondary, disabled, onClick }: {
	label: string
	icon: LucideIcon
	feedback?: ZipFeedback | null
	secondary?: boolean
	disabled?: boolean
	onClick: () => void
}) {
	const working = feedback?.state === 'working'
	const done = feedback?.state === 'done'
	const value = working && feedback.percent !== undefined ? Math.max(0, Math.min(99, Math.floor(feedback.percent))) : undefined
	const Mark = working ? LoaderCircle : done ? CheckCircle2 : Icon
	const text = (working || done) ? feedback.title : label

	return <div className='min-w-0'>
		<button type='button' disabled={working || disabled} onClick={onClick} title={done ? label : undefined}
			className={'relative isolate flex min-h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl border px-4 py-3 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
				(working ? 'border-brand/40 bg-brand/10 text-primary' : done ? 'border-brand/45 bg-brand/20 text-primary hover:bg-brand/25' : secondary ? 'border-brand/25 bg-brand/5 text-brand hover:bg-brand/10 disabled:opacity-45' : 'border-transparent bg-brand text-background hover:opacity-90 disabled:opacity-45')}>
			{value !== undefined && <span aria-hidden='true' className='absolute inset-y-0 left-0 -z-10 bg-linear-to-r from-brand/45 to-brand/80 transition-[width] duration-150 ease-out motion-reduce:transition-none' style={{ width: value + '%' }} />}
			<Mark size={17} aria-hidden='true' className={'shrink-0 ' + (working ? 'animate-spin motion-reduce:animate-none' : '')} />
			<span className='min-w-0 truncate'>{text}</span>
			{value !== undefined && <span className='tabular-nums'>{value}%</span>}
		</button>
		{working && <span className='sr-only' role='progressbar' aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} />}
		{feedback && !(working || done) && <p role='status' className='mt-1.5 break-words text-xs text-secondary'>{feedback.title}</p>}
		{feedback?.detail && <p className='mt-1.5 truncate text-xs text-secondary' title={feedback.detail}>{feedback.detail}</p>}
	</div>
}
