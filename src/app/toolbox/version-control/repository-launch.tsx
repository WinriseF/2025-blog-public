'use client'

import Link from 'next/link'
import { ArrowLeft, Cable, FolderGit2, HardDrive, LockKeyhole, MonitorX } from 'lucide-react'
import { motion } from 'motion/react'
import { createVersionControlLaunchRequest, launchVersionControlAgent } from '@/lib/version-control/launch-client'
import { useVersionControlStore } from '@/lib/version-control/store'
import { RepositoryCandidatePicker } from './repository-candidate-picker'

export function RepositoryLaunch({ supported }: { supported: boolean }) {
	const connection = useVersionControlStore(state => state.connection)
	const error = useVersionControlStore(state => state.error)
	const setLaunch = useVersionControlStore(state => state.setLaunch)
	const selectRepository = useVersionControlStore(state => state.selectRepository)
	const clearError = useVersionControlStore(state => state.clearError)
	const connected = connection === 'connected'

	const launch = () => {
		clearError()
		const request = createVersionControlLaunchRequest()
		setLaunch(request.nonce)
		launchVersionControlAgent(request.uri)
	}

	return (
		<main className='mx-auto flex min-h-[100dvh] max-w-[1120px] items-center px-6 py-28 max-sm:px-4'>
			<div className='grid w-full gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center'>
				<section>
					<Link href='/toolbox' className='text-secondary hover:text-primary inline-flex items-center gap-2 text-xs'>
						<ArrowLeft size={14} /> 返回工具箱
					</Link>
					<p className='text-brand mt-10 font-mono text-xs tracking-[.24em] uppercase'>Local repository forensics</p>
					<h1 className='text-primary mt-4 max-w-2xl text-5xl font-semibold tracking-[-.045em] max-sm:text-3xl'>版本控制器</h1>
					<p className='text-secondary mt-5 max-w-xl text-base leading-8'>
						在浏览器里审阅本机 Git 或 SVN 历史、工作区和版本差异。Agent 只在本机回环地址工作，仓库读取保持只读。
					</p>
					<div className='mt-8 flex flex-wrap gap-3 text-xs'>
						<Feature icon={LockKeyhole}>不切换分支，不改 Git 元数据</Feature>
						<Feature icon={HardDrive}>源码不经过公网</Feature>
						<Feature icon={FolderGit2}>每次会话重新选择项目</Feature>
					</div>
				</section>

				<motion.section
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					className='border-border bg-article relative overflow-hidden rounded-2xl border p-7 shadow-[0_30px_100px_-55px_var(--color-brand)]'>
					<div className='bg-brand/8 pointer-events-none absolute -top-20 -right-16 size-56 rounded-full blur-3xl' />
					{!supported ? (
						<div className='relative text-center'>
							<MonitorX className='text-secondary mx-auto' size={36} />
							<h2 className='mt-4 text-lg font-semibold'>当前设备不受支持</h2>
							<p className='text-secondary mt-2 leading-6'>版本控制器仅支持 Windows 桌面版 Chromium 浏览器。</p>
						</div>
					) : (
						<div className='relative'>
							<div className='flex items-center justify-between'>
								<span className='text-secondary font-mono text-xs'>WINRISEF AGENT / VC V2</span>
								<span className={`size-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-secondary/40'}`} />
							</div>
							<h2 className='mt-8 text-xl font-semibold'>
								{connected
									? 'Agent 已连接'
									: connection === 'connecting'
										? '正在建立本机通道'
										: connection === 'launching'
											? '等待 Agent 回调'
											: '启动只读 Agent'}
							</h2>
									<p className='text-secondary mt-3 min-h-12 leading-6'>
										{connected ? '现在由系统目录选择器授权一个 Git 仓库或 SVN 工作副本。' : '同一个便携 EXE 会按功能启动；此模式不会开启局域网服务或申请防火墙权限。'}
							</p>
							{error && (
								<button onClick={clearError} className='mt-4 w-full rounded-lg border border-red-400/35 bg-red-400/8 px-4 py-3 text-left text-xs text-red-300'>
									{error}
								</button>
							)}
							<button
								onClick={connected ? selectRepository : launch}
								disabled={connection === 'connecting' || connection === 'launching'}
								className='bg-brand text-background mt-7 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3.5 font-semibold transition hover:brightness-110 disabled:opacity-50'>
									{connected ? <FolderGit2 size={18} /> : <Cable size={18} />}
									{connected ? '选择 Git / SVN 项目' : '启动并连接 Agent'}
							</button>
							<p className='text-secondary mt-4 text-center text-[11px]'>与“快传”极速模式互斥 · 关闭页面即释放会话</p>
							{connection === 'launching' && (
								<p className='mt-3 text-center text-[11px] text-amber-300'>没有弹出回调页？请先安装或升级 WinriseF Toolbox Agent，再点击重试。</p>
							)}
						</div>
					)}
				</motion.section>
			</div>
			<RepositoryCandidatePicker />
		</main>
	)
}

function Feature({ icon: Icon, children }: { icon: typeof LockKeyhole; children: React.ReactNode }) {
	return (
		<span className='border-border bg-article/60 text-secondary flex items-center gap-2 rounded-full border px-3 py-2'>
			<Icon size={14} className='text-brand' />
			{children}
		</span>
	)
}
