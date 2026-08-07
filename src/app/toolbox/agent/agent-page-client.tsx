'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import {
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	CircleAlert,
	CircleDashed,
	FolderGit2,
	Gauge,
	HardDrive,
	Network,
	ShieldCheck
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { OptimizedImage } from '@/components/optimized-image'
import { INIT_DELAY } from '@/consts'
import { getAssetUrl } from '@/lib/asset-url'

export type AgentRegistrationState = 'idle' | 'ready' | 'failed'

const statusContent = {
	idle: {
		label: '按需运行',
		title: '等待功能调用',
		description: '选择下方工具后，浏览器会通过系统协议按需唤起 Agent。',
		icon: CircleDashed,
		iconClass: 'border-brand/30 bg-brand/10 text-brand'
	},
	ready: {
		label: '注册成功',
		title: 'Agent 已准备好',
		description: '当前 EXE 已注册为 winrisef:// 处理程序，可以从网页启动本机能力。',
		icon: CheckCircle2,
		iconClass: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-500'
	},
	failed: {
		label: '注册失败',
		title: '协议处理程序未写入',
		description: '请再次双击 Agent；仍然失败时，检查“文档 / WinriseF-Agent-Logs”中的最新日志。',
		icon: CircleAlert,
		iconClass: 'border-red-400/35 bg-red-400/10 text-red-500'
	}
} satisfies Record<AgentRegistrationState, { label: string; title: string; description: string; icon: typeof CircleDashed; iconClass: string }>

const capabilities = [
	{
		href: '/t',
		title: '快传与本机加速',
		description: '在设备间传递消息与文件，并为桌面端提供系统文件选择、原生磁盘读写与多通道直连。',
		meta: 'WebRTC · HTTP/TCP · QUIC',
		icon: Network,
		accent: 'border-sky-400/30 bg-sky-400/10 text-sky-500'
	},
	{
		href: '/toolbox/version-control',
		title: 'Git / SVN 版本控制器',
		description: '在浏览器中只读审阅本机仓库、历史记录和版本差异，每次会话都由系统目录选择器授权。',
		meta: 'Git · SVN · Local only',
		icon: FolderGit2,
		accent: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-500'
	}
]

const operatingModel = [
	{ label: '便携运行', description: '单个 EXE，不安装服务', icon: HardDrive },
	{ label: '按需启动', description: '关闭功能页即释放会话', icon: Gauge },
	{ label: '本机授权', description: '敏感文件由系统选择器确认', icon: ShieldCheck }
]

export function AgentPageClient({ initialStatus }: { initialStatus: AgentRegistrationState }) {
	const shouldReduceMotion = useReducedMotion()
	const status = statusContent[initialStatus]
	const StatusIcon = status.icon

	useEffect(() => {
		if (initialStatus === 'idle') return
		const url = new URL(window.location.href)
		if (!url.searchParams.has('agent-ready')) return
		url.searchParams.delete('agent-ready')
		const search = url.searchParams.toString()
		window.history.replaceState(window.history.state, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`)
	}, [initialStatus])

	return (
		<main className='mx-auto max-w-[1180px] px-6 pt-28 pb-16 text-sm max-sm:px-4 max-sm:pt-24'>
			<motion.div initial={shouldReduceMotion ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: INIT_DELAY }}>
				<Link href='/toolbox' className='text-secondary hover:text-primary inline-flex items-center gap-2 text-xs transition'>
					<ArrowLeft size={14} /> 返回工具箱
				</Link>
			</motion.div>

			<motion.section
				initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ delay: INIT_DELAY + 0.05 }}
				className='border-border bg-article/55 relative mt-7 overflow-hidden border-y'>
				<div className='grid lg:grid-cols-[1.35fr_.65fr]'>
					<div className='flex items-center gap-8 px-8 py-10 max-sm:flex-col max-sm:items-start max-sm:px-5 max-sm:py-7'>
						<div className='border-border bg-background/45 flex size-32 shrink-0 items-center justify-center rounded-lg border max-sm:size-24'>
							<OptimizedImage
								src={getAssetUrl('/images/toolbox/winrisef-toolbox-agent.png')}
								alt='WinriseF Toolbox Agent 标志'
								className='size-[108px] object-contain max-sm:size-20'
								loading='eager'
							/>
						</div>
						<div>
							<h1 className='text-primary text-4xl font-semibold tracking-normal max-sm:text-3xl'>WinriseF Toolbox Agent</h1>
							<p className='text-secondary mt-4 max-w-2xl text-base leading-7'>连接浏览器与 Windows 本机能力，为不同工具提供受控、短期且按需启动的本机通道。</p>
						</div>
					</div>

					<div className='border-border flex flex-col justify-center border-t px-7 py-8 lg:border-t-0 lg:border-l' aria-live='polite'>
						<div className='flex items-center gap-3'>
							<span className={`flex size-11 items-center justify-center rounded-full border ${status.iconClass}`}>
								<StatusIcon size={20} />
							</span>
							<p className='font-semibold'>{status.label}</p>
						</div>
						<h2 className='mt-6 text-xl font-semibold'>{status.title}</h2>
						<p className='text-secondary mt-3 leading-6'>{status.description}</p>
					</div>
				</div>
			</motion.section>

			<section className='mt-10'>
				<div className='flex items-end justify-between gap-4'>
					<h2 className='text-2xl font-semibold'>本机能力入口</h2>
					<span className='text-secondary hidden text-xs sm:block'>同一时间仅运行一个 Agent 会话</span>
				</div>

				<div className='mt-5 grid gap-4 md:grid-cols-2'>
					{capabilities.map(({ href, title, description, meta, icon: Icon, accent }, index) => (
						<motion.div
							key={href}
							initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
							transition={{ delay: INIT_DELAY + 0.12 + index * 0.07 }}>
							<Link
								href={href}
								className='group border-border bg-article hover:border-brand/45 flex min-h-[236px] flex-col rounded-lg border p-6 shadow-[0_20px_70px_-52px_var(--color-primary)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_80px_-56px_var(--color-brand)]'>
								<span className='flex items-start justify-between gap-4'>
									<span className={`flex size-12 items-center justify-center rounded-lg border ${accent}`}>
										<Icon size={22} />
									</span>
									<span className='border-border bg-background/40 text-secondary group-hover:border-brand/40 group-hover:text-brand flex size-9 items-center justify-center rounded-full border transition'>
										<ArrowRight size={16} />
									</span>
								</span>
								<span className='mt-6 text-xl font-semibold'>{title}</span>
								<span className='text-secondary mt-3 leading-6'>{description}</span>
								<span className='border-border text-secondary mt-auto border-t pt-4 font-mono text-[11px]'>{meta}</span>
							</Link>
						</motion.div>
					))}
				</div>
			</section>

			<motion.section
				initial={shouldReduceMotion ? false : { opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: INIT_DELAY + 0.28 }}
				className='border-border mt-8 grid border-y md:grid-cols-3'>
				{operatingModel.map(({ label, description, icon: Icon }, index) => (
					<div key={label} className={`flex items-center gap-4 px-5 py-6 ${index ? 'border-border border-t md:border-t-0 md:border-l' : ''}`}>
						<Icon size={19} className='text-brand shrink-0' />
						<div>
							<h3 className='font-semibold'>{label}</h3>
							<p className='text-secondary mt-1 text-xs'>{description}</p>
						</div>
					</div>
				))}
			</motion.section>
		</main>
	)
}
