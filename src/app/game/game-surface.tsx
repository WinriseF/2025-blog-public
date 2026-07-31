'use client'

import Link from 'next/link'
import { Home, Pause, Play, RotateCcw, Sparkles } from 'lucide-react'
import type { PointerEventHandler, RefObject } from 'react'

export type GameSurfaceHud = {
	phase: 'ready' | 'running' | 'paused' | 'lost' | 'cleared'
	score: number
	lives: number
	level: number
	combo: number
	balls: number
	bricks: number
	message: string
}

type GameSurfaceProps = {
	canvasRef: RefObject<HTMLCanvasElement | null>
	hud: GameSurfaceHud
	maxBalls: number
	onPointerMove: PointerEventHandler<HTMLElement>
	onPointerDown: PointerEventHandler<HTMLElement>
	onReset: () => void
	onStart: () => void
	onTogglePause: () => void
}

export function GameSurface({ canvasRef, hud, maxBalls, onPointerMove, onPointerDown, onReset, onStart, onTogglePause }: GameSurfaceProps) {
	const phaseTitle =
		hud.phase === 'ready'
			? '准备发射'
			: hud.phase === 'paused'
				? '暂停中'
				: hud.phase === 'lost'
					? '重新来过'
					: hud.phase === 'cleared'
						? '清屏完成'
						: ''

	return (
		<section
			className='fixed inset-0 z-[80] overflow-hidden bg-[#10135d] text-white select-none'
			style={{ touchAction: 'none' }}
			onPointerMove={onPointerMove}
			onPointerDown={onPointerDown}>
			<canvas ref={canvasRef} className='absolute inset-0 h-full w-full' />

			<header className='pointer-events-none absolute inset-x-3 top-2 z-10 flex items-center justify-between gap-2 sm:inset-x-5 sm:top-3'>
				<div className='pointer-events-auto flex items-center gap-3'>
					<Link
						href='/'
						onPointerDown={event => event.stopPropagation()}
						className='flex h-10 w-10 items-center justify-center border border-white/15 bg-[#06092f]/88 text-white shadow-[0_14px_34px_-22px_rgba(0,0,0,0.9)] transition-colors hover:bg-[#111765] sm:h-12 sm:w-12'
						aria-label='返回首页'>
						<Home className='h-5 w-5 sm:h-6 sm:w-6' />
					</Link>
					<div className='hidden sm:block'>
						<div className='text-base font-black tracking-[0.16em] text-white uppercase'>Bounce Bloom</div>
						<div className='mt-0.5 text-[10px] font-medium tracking-[0.28em] text-cyan-200/70 uppercase'>multi ball breakout</div>
					</div>
				</div>

				<div className='pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/12 bg-[#080c3f]/62 px-4 py-1.5 shadow-[0_18px_44px_-30px_rgba(0,0,0,0.86)] backdrop-blur-md sm:gap-4 sm:px-5'>
					<div className='flex items-center gap-2 text-2xl font-black sm:text-3xl'>
						<span className='h-3 w-3 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.9)]' />
						<span>{hud.score}</span>
					</div>
					<div className='hidden h-7 w-px bg-white/14 sm:block' />
					<div className='hidden items-center gap-3 text-xs font-bold text-white/80 sm:flex'>
						<span>Lv.{hud.level}</span>
						<span>{hud.lives} 命</span>
						<span>{hud.balls}/{maxBalls} 球</span>
					</div>
				</div>

				<div className='pointer-events-auto flex items-center gap-2'>
					<button
						type='button'
						onClick={event => {
							event.stopPropagation()
							onReset()
						}}
						onPointerDown={event => event.stopPropagation()}
						className='flex h-10 w-10 items-center justify-center border border-white/15 bg-[#06092f]/88 text-white shadow-[0_14px_34px_-22px_rgba(0,0,0,0.9)] transition-colors hover:bg-[#111765] sm:h-12 sm:w-12'
						aria-label='重新开始'>
						<RotateCcw className='h-5 w-5 sm:h-6 sm:w-6' />
					</button>
					<button
						type='button'
						onClick={event => {
							event.stopPropagation()
							onTogglePause()
						}}
						onPointerDown={event => event.stopPropagation()}
						className='flex h-10 w-10 items-center justify-center border border-white/15 bg-[#06092f]/88 text-white shadow-[0_14px_34px_-22px_rgba(0,0,0,0.9)] transition-colors hover:bg-[#111765] sm:h-12 sm:w-12'
						aria-label={hud.phase === 'paused' ? '继续' : '暂停'}>
						{hud.phase === 'paused' ? <Play className='h-5 w-5 sm:h-6 sm:w-6' /> : <Pause className='h-5 w-5 sm:h-6 sm:w-6' />}
					</button>
				</div>
			</header>

			<div className='pointer-events-none absolute right-4 bottom-4 left-4 z-10 flex flex-wrap items-end justify-between gap-3 sm:right-7 sm:bottom-6 sm:left-7'>
				<div className='rounded-2xl border border-white/10 bg-[#06092f]/52 px-4 py-3 text-xs font-medium text-white/72 backdrop-blur-md sm:text-sm'>
					鼠标 / 触控移动挡板，空格发射，P 暂停，R 重开
				</div>
				<div className='rounded-2xl border border-cyan-200/16 bg-cyan-200/10 px-4 py-3 text-xs font-semibold text-cyan-100 backdrop-blur-md sm:text-sm'>
					剩余砖块 {hud.bricks} · 连击 {hud.combo}
				</div>
			</div>

			{hud.phase !== 'running' && (
				<div className='pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-5'>
					<div className='pointer-events-auto w-[min(520px,calc(100vw-2rem))] border border-white/16 bg-[#070b35]/78 p-6 text-center shadow-[0_30px_90px_-42px_rgba(0,0,0,0.96)] backdrop-blur-xl sm:p-8'>
						<div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cyan-200/14 text-cyan-100'>
							<Sparkles className='h-6 w-6' />
						</div>
						<h1 className='mt-5 text-3xl font-black tracking-tight sm:text-5xl'>{phaseTitle}</h1>
						<p className='mt-3 text-sm leading-6 text-white/68 sm:text-base'>{hud.message}</p>
						<button
							type='button'
							onClick={event => {
								event.stopPropagation()
								onStart()
							}}
							onPointerDown={event => event.stopPropagation()}
							className='mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-[#11145c] shadow-[0_20px_48px_-24px_rgba(255,255,255,0.9)] transition-transform hover:scale-105 active:scale-95'>
							{hud.phase === 'cleared' ? '下一关' : hud.phase === 'lost' ? '重新开始' : '开始弹弹弹'}
						</button>
					</div>
				</div>
			)}
		</section>
	)
}
