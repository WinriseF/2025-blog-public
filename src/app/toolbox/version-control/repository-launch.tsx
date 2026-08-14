'use client'

import { useState } from 'react'
import { Cable, FolderGit2, Github, MonitorX } from 'lucide-react'
import { motion } from 'motion/react'
import { createVersionControlLaunchRequest, launchVersionControlAgent } from '@/lib/version-control/launch-client'
import { useVersionControlStore } from '@/lib/version-control/store'
import { RepositoryCandidatePicker } from './repository-candidate-picker'

export function RepositoryLaunch({ supported }: { supported: boolean }) {
	const [mode, setMode] = useState<'github' | 'local'>('github')
	const [repositoryUrl, setRepositoryUrl] = useState('')
	const connection = useVersionControlStore(state => state.connection)
	const loading = useVersionControlStore(state => state.loading)
	const error = useVersionControlStore(state => state.error)
	const setLaunch = useVersionControlStore(state => state.setLaunch)
	const openRemoteRepository = useVersionControlStore(state => state.openRemoteRepository)
	const selectRepository = useVersionControlStore(state => state.selectRepository)
	const clearError = useVersionControlStore(state => state.clearError)
	const connected = connection === 'connected'

	const launch = () => {
		clearError()
		const request = createVersionControlLaunchRequest()
		setLaunch(request.nonce)
		launchVersionControlAgent(request.uri)
	}

	const openRemote = (event: React.FormEvent) => {
		event.preventDefault()
		void openRemoteRepository(repositoryUrl)
	}

	const switchMode = (next: 'github' | 'local') => {
		clearError()
		setMode(next)
	}

	return (
		<main className='mx-auto flex min-h-[100dvh] w-full max-w-[860px] items-center px-6 py-24 text-sm max-sm:px-4'>
			<div className='grid w-full gap-12 lg:grid-cols-[360px_420px] lg:items-center lg:justify-center'>
				<motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
					<h1 className='text-primary text-5xl font-semibold tracking-[-.045em] max-sm:text-3xl'>版本控制器</h1>
					<p className='text-secondary mt-5 max-w-lg text-base leading-7'>预览 GitHub 或本机 Git / SVN 仓库历史与版本差异。</p>
				</motion.section>

				<motion.section
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1 }}
					className='border-border bg-article relative overflow-hidden rounded-2xl border p-7 shadow-[0_30px_100px_-55px_var(--color-brand)] max-sm:p-5'>
					<div className='bg-brand/8 pointer-events-none absolute -top-20 -right-16 size-56 rounded-full blur-3xl' />
					<div className='border-border bg-background/45 relative mb-6 grid grid-cols-2 rounded-lg border p-1'>
						<ModeButton active={mode === 'github'} onClick={() => switchMode('github')}>
							<Github size={14} /> GitHub
						</ModeButton>
						<ModeButton active={mode === 'local'} onClick={() => switchMode('local')}>
							<FolderGit2 size={14} /> 本机
						</ModeButton>
					</div>

					{mode === 'github' ? (
						<form onSubmit={openRemote} className='relative'>
							<h2 className='text-xl font-semibold'>打开远端仓库</h2>
							<div className='mt-5'>
								<input
									value={repositoryUrl}
									onChange={event => setRepositoryUrl(event.target.value)}
									placeholder='https://github.com/owner/repo'
									autoFocus
									className='border-border bg-background/60 placeholder:text-secondary/60 focus:border-brand h-11 w-full rounded-lg border px-3 text-xs outline-none'
								/>
							</div>
							{error && <ErrorButton error={error} clear={clearError} />}
							<button
								type='submit'
								disabled={loading || !repositoryUrl.trim()}
								className='bg-brand text-background mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3.5 font-semibold transition hover:brightness-110 disabled:opacity-50'>
								<Github size={18} />
								{loading ? '正在读取…' : '打开仓库'}
							</button>
						</form>
					) : !supported ? (
						<div className='relative py-6 text-center'>
							<MonitorX className='text-secondary mx-auto' size={36} />
							<h2 className='mt-4 text-lg font-semibold'>当前设备不支持本机模式</h2>
						</div>
					) : (
						<div className='relative'>
							<h2 className='text-xl font-semibold'>
								{connected
									? 'Agent 已连接'
									: connection === 'connecting'
										? '正在连接 Agent'
										: connection === 'launching'
											? '等待 Agent 回调'
											: '连接本机 Agent'}
							</h2>
							{error && <ErrorButton error={error} clear={clearError} />}
							<button
								onClick={connected ? selectRepository : launch}
								disabled={connection === 'connecting' || connection === 'launching'}
								className='bg-brand text-background mt-7 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3.5 font-semibold transition hover:brightness-110 disabled:opacity-50'>
								{connected ? <FolderGit2 size={18} /> : <Cable size={18} />}
								{connected ? '选择项目' : '启动 Agent'}
							</button>
						</div>
					)}
				</motion.section>
			</div>
			<RepositoryCandidatePicker />
		</main>
	)
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs transition ${active ? 'bg-article text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>
			{children}
		</button>
	)
}

function ErrorButton({ error, clear }: { error: string; clear: () => void }) {
	return (
		<button type='button' onClick={clear} className='mt-4 w-full rounded-lg border border-red-400/35 bg-red-400/8 px-4 py-3 text-left text-xs text-red-300'>
			{error}
		</button>
	)
}
