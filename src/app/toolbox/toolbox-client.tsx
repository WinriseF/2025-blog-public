'use client'

import Link from 'next/link'
import { ArrowUpRight, FileText, ImageIcon, Send } from 'lucide-react'
import { motion } from 'motion/react'
import { INIT_DELAY } from '@/consts'

const tools = [
	{
		href: '/toolbox/compress',
		label: '图片压缩',
		desc: 'PNG / JPG 转 WEBP',
		tone: 'from-teal-400/20 via-cyan-300/10 to-transparent',
		icon: ImageIcon
	},
	{
		href: '/toolbox/markdown',
		label: 'Markdown 查看器',
		desc: '本地预览 .md 文件',
		tone: 'from-amber-300/20 via-lime-200/10 to-transparent',
		icon: FileText
	},
	{
		href: '/t',
		label: '快传',
		desc: '公网中转 / 局域网互传',
		tone: 'from-sky-400/20 via-emerald-300/10 to-transparent',
		icon: Send
	}
]

export function ToolboxClient() {
	return (
		<main className='mx-auto max-w-[1180px] px-6 pt-28 pb-12 text-sm max-sm:px-4 max-sm:pt-24'>
			<motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: INIT_DELAY }} className='max-w-2xl'>
				<p className='text-secondary text-xs tracking-[0.22em] uppercase'>Toolbox</p>
				<h1 className='mt-2 text-3xl font-semibold tracking-normal text-primary max-sm:text-2xl'>客户端工具箱</h1>
			</motion.header>

			<section className='mt-8 grid gap-4 md:grid-cols-3'>
				{tools.map(({ href, label, desc, tone, icon: Icon }, index) => (
					<motion.div key={href} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: INIT_DELAY + index * 0.06 }}>
						<Link
							href={href}
							className='group relative flex min-h-[170px] flex-col overflow-hidden rounded-lg border border-border bg-article p-5 shadow-[0_18px_60px_-42px_var(--color-primary)] transition duration-300 hover:-translate-y-1 hover:border-brand/45 hover:shadow-[0_24px_70px_-46px_var(--color-brand)]'>
							<span className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-br ${tone}`} />
							<span className='pointer-events-none absolute inset-x-5 top-16 h-px bg-linear-to-r from-transparent via-border to-transparent' />
							<span className='relative flex items-start justify-between gap-4'>
								<span className='border-brand/25 bg-brand/5 text-brand flex size-12 items-center justify-center rounded-lg border transition duration-300 group-hover:border-brand/55 group-hover:bg-brand/10 group-hover:text-brand'>
									<Icon size={22} />
								</span>
								<span className='text-secondary group-hover:text-primary flex size-9 items-center justify-center rounded-full border border-border bg-background/40 transition'>
									<ArrowUpRight size={16} />
								</span>
							</span>
							<span className='relative mt-7 block text-lg font-semibold'>{label}</span>
							<span className='text-secondary relative mt-2 block text-sm'>{desc}</span>
						</Link>
					</motion.div>
				))}
			</section>
		</main>
	)
}
