'use client'

import { Files, GitBranch, History, Search, Server, X } from 'lucide-react'
import type { RepositoryOverview } from '@/lib/version-control/types'
import { RepositoryBranchFilter } from './repository-branch-filter'

export type RepositoryViewMode = 'history' | 'files'

export function RepositorySidebarHeader({
	mode,
	onModeChange,
	query,
	onQueryChange,
	placeholder,
	overview
}: {
	mode: RepositoryViewMode
	onModeChange: (mode: RepositoryViewMode) => void
	query: string
	onQueryChange: (query: string) => void
	placeholder: string
	overview: RepositoryOverview | null
}) {
	return (
		<header className='border-border space-y-2 border-b px-3 py-2'>
			<div className='flex min-w-0 items-center gap-2'>
				<nav aria-label='仓库视图' className='border-border bg-article/55 flex shrink-0 rounded-lg border p-0.5'>
					<ModeButton active={mode === 'history'} label='历史' icon={<History size={12} />} onClick={() => onModeChange('history')} />
					<ModeButton active={mode === 'files'} label='文件' icon={<Files size={12} />} onClick={() => onModeChange('files')} />
				</nav>
				{mode === 'history' && overview?.capabilities?.supportsBranchFilter ? <RepositoryBranchFilter /> : <BranchLabel overview={overview} />}
			</div>
			<div className='relative'>
				<Search size={13} className='text-secondary absolute top-1/2 left-3 -translate-y-1/2' />
				<input
					value={query}
					onChange={event => onQueryChange(event.target.value)}
					placeholder={placeholder}
					className='border-border bg-article/55 placeholder:text-secondary/60 focus:ring-brand/20 h-8 w-full rounded-lg border pr-9 pl-8 text-xs outline-none focus:ring-2 max-lg:h-10'
				/>
				{query && (
					<button onClick={() => onQueryChange('')} aria-label='清空搜索' className='text-secondary hover:text-primary absolute top-1/2 right-2 -translate-y-1/2 rounded p-1'>
						<X size={12} />
					</button>
				)}
			</div>
		</header>
	)
}

function BranchLabel({ overview }: { overview: RepositoryOverview | null }) {
	return (
		<div title={branchLabel(overview)} className='border-border bg-article/45 text-secondary flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 max-lg:h-9'>
			{overview?.repositoryKind === 'svn' ? <Server size={11} className='shrink-0 text-orange-300' /> : <GitBranch size={11} className='text-brand shrink-0' />}
			<span className='truncate font-mono text-[10px]'>{branchLabel(overview)}</span>
		</div>
	)
}

function ModeButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
	return (
		<button
			type='button'
			aria-pressed={active}
			onClick={onClick}
			className={`flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition max-lg:h-8 max-lg:px-3 ${active ? 'bg-background text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>
			{icon}
			{label}
		</button>
	)
}

function branchLabel(overview: RepositoryOverview | null) {
	if (overview?.repositoryKind === 'svn') return overview.svn?.relativeUrl || overview.currentBranch || 'SVN'
	return overview?.currentBranch || (overview?.isDetachedHead ? 'DETACHED' : overview?.isBare ? 'HEAD' : 'BRANCH')
}
