'use client'

import { motion } from 'motion/react'
import Link from 'next/link'
import { getAssetUrl } from '@/lib/asset-url'
import { OptimizedImage } from '@/components/optimized-image'

export interface Project {
	name: string
	year: number
	description: string
	image: string
	url: string
	tags: string[]
	github?: string
	npm?: string
}

interface ProjectCardProps {
	project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
	const primaryLinkLabel = project.url.startsWith('/blog/') ? '文章' : 'Website'

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.9 }}
			animate={{ opacity: 1, scale: 1 }}
			className='bg-card relative flex flex-col gap-4 rounded-[40px] border p-6 shadow-[0_40px_50px_-32px_rgba(0,0,0,0.05)] backdrop-blur'>
			<div className='flex items-start gap-4'>
				<OptimizedImage
					src={getAssetUrl(project.image)}
					alt={project.name}
					width={64}
					height={64}
					className='h-16 w-16 shrink-0 rounded-xl object-cover'
				/>
				<div className='flex-1'>
					<div className='flex items-center gap-2'>
						<h3 className='text-lg font-semibold'>{project.name}</h3>
						<span className='text-secondary text-sm'>{project.year}</span>
					</div>
					<div className='mt-2 flex flex-wrap gap-2'>
						{project.tags.map(tag => (
							<span key={tag} className='text-secondary bg-card rounded-lg px-2 py-1 text-xs'>
								{tag}
							</span>
						))}
					</div>
				</div>
			</div>

			<p className='text-secondary text-sm leading-relaxed'>{project.description}</p>

			<div className='flex flex-wrap gap-2'>
				<Link
					href={project.url}
					target={project.url.startsWith('/') ? undefined : '_blank'}
					rel={project.url.startsWith('/') ? undefined : 'noopener noreferrer'}
					className='bg-card hover:bg-bg rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors'>
					{primaryLinkLabel}
				</Link>
				{project.github && (
					<Link
						href={project.github}
						target='_blank'
						rel='noopener noreferrer'
						className='bg-card hover:bg-bg rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors'>
						GitHub
					</Link>
				)}
				{project.npm && (
					<Link
						href={project.npm}
						target='_blank'
						rel='noopener noreferrer'
						className='bg-card hover:bg-bg rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors'>
						NPM
					</Link>
				)}
			</div>
		</motion.div>
	)
}
