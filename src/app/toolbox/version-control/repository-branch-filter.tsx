'use client'

import { ChevronDown, GitBranch, Loader2 } from 'lucide-react'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { RepositoryBranch } from '@/lib/version-control/types'

export function RepositoryBranchFilter() {
	const branches = useVersionControlStore(state => state.branches)
	const loaded = useVersionControlStore(state => state.branchesLoaded)
	const loading = useVersionControlStore(state => state.branchesLoading)
	const selected = useVersionControlStore(state => state.branchFilter)
	const load = useVersionControlStore(state => state.loadBranches)
	const setFilter = useVersionControlStore(state => state.setBranchFilter)
	const selectedSet = new Set(selected)
	const toggle = (id: string) => setFilter(selectedSet.has(id) ? selected.filter(item => item !== id) : [...selected, id])

	return (
		<details onToggle={event => event.currentTarget.open && void load()} className='group relative min-w-0 flex-1'>
			<summary
				aria-label='筛选提交分支'
				className='border-border bg-article/45 text-secondary hover:text-primary flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-lg border px-2 [&::-webkit-details-marker]:hidden'>
				<GitBranch size={11} className='text-brand shrink-0' />
				<span className='min-w-0 flex-1 truncate font-mono text-[10px]'>{filterLabel(branches, selected)}</span>
				<ChevronDown size={11} className='shrink-0 transition-transform group-open:rotate-180' />
			</summary>
			<div className='border-border bg-bg absolute top-8 right-0 z-40 max-h-72 w-full min-w-56 overflow-y-auto overscroll-contain rounded-lg border p-1 shadow-2xl'>
				<BranchOption label='全部分支' checked={!selected.length} onChange={() => setFilter([])} />
				{loading ? (
					<div className='text-secondary flex h-16 items-center justify-center gap-2 text-[10px]'>
						<Loader2 size={12} className='animate-spin' />
						正在读取分支…
					</div>
				) : loaded ? (
					<>
						<BranchGroup title='本地分支' kind='branch' branches={branches} selected={selectedSet} onToggle={toggle} />
						<BranchGroup title='远程分支' kind='remote-branch' branches={branches} selected={selectedSet} onToggle={toggle} />
					</>
				) : null}
			</div>
		</details>
	)
}

function BranchGroup({
	title,
	kind,
	branches,
	selected,
	onToggle
}: {
	title: string
	kind: RepositoryBranch['kind']
	branches: RepositoryBranch[]
	selected: Set<string>
	onToggle: (id: string) => void
}) {
	const items = branches.filter(branch => branch.kind === kind)
	if (!items.length) return null
	return (
		<div className='border-border mt-1 border-t pt-1'>
			<p className='text-secondary px-2 py-1 text-[9px]'>{title}</p>
			{items.map(branch => (
				<BranchOption
					key={branch.id}
					label={branch.name}
					checked={selected.has(branch.id)}
					current={branch.current}
					onChange={() => onToggle(branch.id)}
				/>
			))}
		</div>
	)
}

function BranchOption({ label, checked, current, onChange }: { label: string; checked: boolean; current?: boolean; onChange: () => void }) {
	return (
		<label title={label} className='hover:bg-article flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-[10px]'>
			<input type='checkbox' checked={checked} onChange={onChange} className='accent-brand size-3 shrink-0' />
			<span className='min-w-0 flex-1 truncate font-mono'>{label}</span>
			{current && <span className='text-brand shrink-0 text-[9px]'>当前</span>}
		</label>
	)
}

function filterLabel(branches: RepositoryBranch[], selected: string[]) {
	if (!selected.length) return '全部分支'
	if (selected.length === 1) return branches.find(branch => branch.id === selected[0])?.name || '1 个分支'
	return selected.length + ' 个分支'
}
