'use client'

import { FolderGit2, GitBranch, Server, X } from 'lucide-react'
import { useVersionControlStore } from '@/lib/version-control/store'

export function RepositoryCandidatePicker() {
	const candidates = useVersionControlStore(state => state.candidates)
	const choose = useVersionControlStore(state => state.chooseRepositoryCandidate)
	const clearCandidates = useVersionControlStore(state => state.clearCandidates)
	if (!candidates.length) return null
	return (
		<div className='fixed inset-0 z-[180] flex items-center justify-center bg-black/65 p-5 backdrop-blur-sm'>
			<section className='border-border bg-background w-full max-w-lg rounded-2xl border p-5 shadow-2xl'>
				<header className='flex items-start gap-3'>
					<div className='bg-brand/12 text-brand flex size-9 items-center justify-center rounded-lg'>
						<FolderGit2 size={18} />
					</div>
					<div className='min-w-0 flex-1'>
						<h2 className='text-sm font-semibold'>检测到多个版本控制仓库</h2>
						<p className='text-secondary mt-1 text-xs leading-5'>这个目录同时包含 Git 和 SVN，请明确选择要查看的后端。</p>
					</div>
					<button onClick={clearCandidates} className='text-secondary hover:text-primary rounded p-1' aria-label='关闭'>
						<X size={16} />
					</button>
				</header>
				<div className='mt-5 space-y-2'>
					{candidates.map(candidate => {
						const isSvn = candidate.repositoryKind === 'svn'
						return (
							<button
								key={candidate.candidateId}
								onClick={() => void choose(candidate.candidateId)}
								className='border-border bg-article/60 hover:border-brand/60 hover:bg-brand/8 flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition'>
								<span className={`flex size-9 items-center justify-center rounded-lg ${isSvn ? 'bg-orange-500/12 text-orange-300' : 'bg-green-500/12 text-green-300'}`}>
									{isSvn ? <Server size={17} /> : <GitBranch size={17} />}
								</span>
								<span className='min-w-0 flex-1'>
									<span className='block text-sm font-medium'>{isSvn ? 'SVN 工作副本' : 'Git 仓库'}</span>
									<span className='text-secondary mt-0.5 block truncate text-[11px]'>{candidate.displayName}{candidate.relativeUrl ? ` · ${candidate.relativeUrl}` : ''}</span>
								</span>
							</button>
						)
					})}
				</div>
			</section>
		</div>
	)
}
