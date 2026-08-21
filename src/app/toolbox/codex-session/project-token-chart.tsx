'use client'

import type { ProjectTokenBucket } from '@/lib/codex-session/types'

const compactNumber = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })

export default function ProjectTokenChart({ data }: { data: ProjectTokenBucket[] }) {
	const visible = data.slice(0, 12)
	const maximum = Math.max(visible[0]?.total ?? 0, 1)
	return (
		<div className='space-y-3 px-1 py-2'>
			{visible.map(project => <div key={project.key} className='grid min-w-0 grid-cols-[minmax(140px,220px)_minmax(120px,1fr)_70px] items-center gap-3 text-xs max-sm:grid-cols-[minmax(90px,120px)_minmax(90px,1fr)_58px]'>
				<span className='break-words font-medium' title={project.key}>{project.label}</span>
				<span className='h-3 overflow-hidden rounded-full bg-border/45' title={`${project.key}\n${project.total.toLocaleString('zh-CN')} Token`}>
					<span className='bg-brand block h-full rounded-full' style={{ width: `${Math.max((project.total / maximum) * 100, 0.8)}%` }} />
				</span>
				<span className='text-secondary text-right font-mono text-[11px] tabular-nums' title={project.total.toLocaleString('zh-CN')}>{compactNumber.format(project.total)}</span>
			</div>)}
		</div>
	)
}
