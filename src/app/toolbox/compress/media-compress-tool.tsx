'use client'

import { useState } from 'react'
import { FileVideo, Image as ImageIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { INIT_DELAY } from '@/consts'
import { ImageCompressPanel } from '../compress-tool'
import { VideoCompressPanel } from './video-compress-panel'

type CompressMode = 'image' | 'video'

export function MediaCompressTool() {
	const [mode, setMode] = useState<CompressMode>('image')
	const shouldReduceMotion = useReducedMotion()

	return (
		<div className='relative text-sm'>
			<div className='mx-auto mb-8 max-w-5xl'>
				<motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: INIT_DELAY }}>
					<h1 className='text-2xl font-semibold tracking-normal text-primary'>媒体压缩</h1>
					<p className='text-secondary mt-3 text-sm'>图片与视频均在本机浏览器处理，不上传服务器</p>
				</motion.div>

				<div className='mt-6 inline-flex rounded-xl border border-border bg-background/30 p-1'>
					{([
						{ id: 'image' as const, label: '图片压缩', icon: ImageIcon },
						{ id: 'video' as const, label: '视频压缩', icon: FileVideo }
					]).map(item => {
						const Icon = item.icon
						return (
							<button
								key={item.id}
								type='button'
								onClick={() => setMode(item.id)}
								className={`flex items-center gap-2 rounded-lg px-4 py-2.5 font-medium transition ${mode === item.id ? 'bg-brand text-background shadow-sm' : 'text-secondary hover:text-primary'}`}>
								<Icon size={16} />
								{item.label}
							</button>
						)
					})}
				</div>
			</div>

			<div className={mode === 'image' ? 'block' : 'hidden'} aria-hidden={mode !== 'image'}>
				<ImageCompressPanel />
			</div>
			<div className={mode === 'video' ? 'block' : 'hidden'} aria-hidden={mode !== 'video'}>
				<VideoCompressPanel />
			</div>
		</div>
	)
}

