'use client'

import Link from 'next/link'
import { ArrowLeft, Camera, DraftingCompass, Pause, PictureInPicture2, Play, RotateCcw, Square, ZoomIn, ZoomOut, Minus, Plus } from 'lucide-react'
import { memo, useEffect, useRef, useState, type PointerEvent } from 'react'
import { mirrorScreen } from './screen'
import TimeAtmosphereBackground from '@/layout/backgrounds/time-atmosphere-background'
import { useTimeTheme } from '@/components/time-theme-provider'
import styles from './protractor.module.css'

const zoomLevels = [0.6, 0.8, 1, 1.25, 1.5, 2]
const defaultZoom = zoomLevels.indexOf(1)

const Scale = memo(function Scale({ radius }: { radius: number }) {
	const paths = ['', '', '', '']
	const labels = []
	const interval = radius >= 180 ? 10 : radius >= 110 ? 15 : 30
	const step = radius >= 250 ? 0.5 : 1
	for (let a = 0; a <= 180; a += step) {
		const level = a % interval === 0 || a % 10 === 0 ? 3 : a % 5 === 0 ? 2 : Number.isInteger(a) ? 1 : 0
		const outer = point(a, radius)
		const inner = point(a, radius - [3, 6, 10, 15][level])
		paths[level] += `M${outer.x},${outer.y}L${inner.x},${inner.y}`
		if (a % interval === 0) {
			const label = point(a, radius - 28)
			labels.push(
				<text className={styles.tickLabel} key={a} x={label.x} y={label.y - (a === 0 || a === 180 ? 7 : 0)}>
					{a}
				</text>
			)
		}
	}
	return (
		<g className='stroke-secondary fill-primary'>
			{paths.map((d, i) => (
				<path key={i} fill='none' d={d} strokeWidth={[0.6, 0.8, 1, 1.4][i]} strokeOpacity={[0.55, 0.7, 0.9, 1][i]} />
			))}
			{labels}
		</g>
	)
})
const point = (angle: number, radius: number) => ({
	x: Math.cos((angle * Math.PI) / 180) * radius,
	y: -Math.sin((angle * Math.PI) / 180) * radius
})

function AngleStepButton({ increase = false, disabled, onStep }: { increase?: boolean; disabled: boolean; onStep: () => void }) {
	const timer = useRef<number | undefined>(undefined)
	const repeated = useRef(false)
	function stop() {
		window.clearTimeout(timer.current)
	}
	useEffect(() => {
		if (disabled) return
		window.addEventListener('blur', stop)
		return () => {
			stop()
			window.removeEventListener('blur', stop)
		}
	}, [disabled])
	const label = increase ? '增加' : '减少'
	return (
		<button
			aria-label={label + ' 0.1 度'}
			title={label + ' 0.1°'}
			disabled={disabled}
			onPointerDown={event => {
				if (!event.isPrimary || event.button !== 0) return
				stop()
				repeated.current = false
				event.currentTarget.setPointerCapture(event.pointerId)
				function repeat() {
					repeated.current = true
					onStep()
					timer.current = window.setTimeout(repeat, 80)
				}
				timer.current = window.setTimeout(repeat, 350)
			}}
			onPointerUp={stop}
			onLostPointerCapture={stop}
			onPointerCancel={stop}
			onContextMenu={event => event.preventDefault()}
			onClick={event => {
				if (!repeated.current || event.detail === 0) onStep()
			}}>
			{increase ? <Plus /> : <Minus />}
		</button>
	)
}

export function Protractor() {
	const { theme } = useTimeTheme()
	const [size, setSize] = useState({ width: 0, height: 0 })
	const [zoom, setZoom] = useState(defaultZoom)
	const [offset, setOffset] = useState({ x: 0, y: 0 })
	const [base, setBase] = useState(0),
		[angle, setAngle] = useState(45)
	const [notice, setNotice] = useState('')
	const [mode, setMode] = useState<'screen' | 'camera' | null>(null)
	const [pending, setPending] = useState(false),
		[frozen, setFrozen] = useState(false)
	const [floating, setFloating] = useState(false)
	const media = size.width ? navigator.mediaDevices : undefined
	const video = useRef<HTMLVideoElement>(null),
		canvas = useRef<HTMLCanvasElement>(null),
		marker = useRef<HTMLElement>(null)
	const stream = useRef<MediaStream | null>(null),
		cleanup = useRef<(() => void) | null>(null)
	const child = useRef<Window | null>(null),
		generation = useRef(0)
	const plane = useRef<SVGSVGElement>(null)
	const drag = useRef<{ kind: string; id: number; dx: number; dy: number; fine: boolean; pointerAngle: number; startAngle: number } | null>(null)
	useEffect(() => {
		const surface = plane.current!
		let distance = 0
		function wheel(event: WheelEvent) {
			if (event.ctrlKey || event.metaKey || !event.deltaY) return
			event.preventDefault()
			const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? innerHeight : 1
			if (Math.sign(distance) !== Math.sign(event.deltaY)) distance = 0
			distance += event.deltaY * unit
			if (Math.abs(distance) < 36) return
			const step = -Math.sign(distance)
			distance = 0
			changeZoom(step)
		}
		surface.addEventListener('wheel', wheel, { passive: false })
		return () => surface.removeEventListener('wheel', wheel)
	}, [])
	useEffect(() => {
		const resize = () => {
			setSize({ width: innerWidth, height: innerHeight })
			setOffset({ x: 0, y: 0 })
		}
		resize()
		setFloating(new URLSearchParams(location.search).has('float'))
		addEventListener('resize', resize)
		addEventListener('pagehide', stop)
		return () => {
			removeEventListener('resize', resize)
			removeEventListener('pagehide', stop)
			stop()
			child.current?.close()
		}
	}, [])
	function stop() {
		generation.current++
		cleanup.current?.()
		cleanup.current = null
		stream.current?.getTracks().forEach(t => t.stop())
		stream.current = null
		if (video.current) video.current.srcObject = null
		setPending(false)
		setMode(null)
		setFrozen(false)
		setNotice('')
	}
	async function start(next: 'screen' | 'camera') {
		const id = ++generation.current
		setPending(true)
		try {
			const media = navigator.mediaDevices
			const s =
				next === 'screen'
					? await media.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: { ideal: 30, max: 30 } }, audio: false })
					: await media.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
			if (id !== generation.current) {
				s.getTracks().forEach(t => t.stop())
				return
			}
			stream.current = s
			const track = s.getVideoTracks()[0],
				surface = track.getSettings().displaySurface
			if (next === 'screen' && surface && surface !== 'monitor') {
				stop()
				setNotice('需要共享整个显示器')
				return
			}
			track.onended = stop
			const player = video.current!
			player.srcObject = s
			setMode(next)
			await player.play()
			if (id !== generation.current) return
			setNotice('')
			if (next === 'screen') {
				cleanup.current = mirrorScreen(player, canvas.current!, marker.current!, setNotice)
			}
			setPending(false)
		} catch (error) {
			if (id !== generation.current) return
			stop()
			setNotice(error instanceof DOMException && error.name === 'NotAllowedError' ? '未获得取景权限' : '无法开启取景')
		}
	}
	async function openWindow() {
		if (child.current && !child.current.closed) {
			child.current.focus()
			return
		}
		const url = new URL(location.href)
		url.searchParams.set('float', '1')
		const pip = (window as Window & { documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> } })
			.documentPictureInPicture
		try {
			const id = generation.current
			const win = await pip?.requestWindow({ width: 540, height: 420 }).catch(() => null)
			if (id !== generation.current) {
				win?.close()
				return
			}
			if (win) {
				child.current = win
				const frame = win.document.createElement('iframe')
				frame.title = '量角器'
				frame.src = url.href
				frame.allow = 'display-capture'
				frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0'
				win.document.title = '量角器'
				win.document.body.append(frame)
			} else {
				const popup = window.open(url.href, 'protractor', 'popup,width=540,height=420')
				if (!popup) throw new Error()
				child.current = popup
			}
			setNotice('')
		} catch {
			setNotice('无法打开小窗')
		}
	}
	function changeZoom(step: number) {
		setZoom(i => Math.max(0, Math.min(zoomLevels.length - 1, i + step)))
	}
	const radius = Math.min(size.width * 0.41, size.height * 0.32, 310) * zoomLevels[zoom]
	const cx = size.width / 2 + offset.x,
		cy = size.height * 0.56 + offset.y,
		end = point(angle, radius)
	function move(e: PointerEvent<SVGSVGElement>) {
		const active = drag.current
		if (!active || active.id !== e.pointerId) return
		const a = (Math.atan2(cy - e.clientY, e.clientX - cx) * 180) / Math.PI
		if (active.kind === 'center')
			setOffset({
				x: Math.max(0, Math.min(size.width, e.clientX + active.dx)) - size.width / 2,
				y: Math.max(0, Math.min(size.height, e.clientY + active.dy)) - size.height * 0.56
			})
		else if (active.kind === 'base') setBase(a)
		else if (active.fine) {
			const delta = ((a - active.pointerAngle + 540) % 360) - 180
			setAngle(Math.max(0, Math.min(180, active.startAngle + delta / 10)))
		} else {
			const delta = (a - base + 360) % 360
			setAngle(delta <= 180 ? delta : delta < 270 ? 180 : 0)
		}
	}
	return (
		<section className='text-primary bg-bg fixed inset-0 isolate overflow-hidden' data-capture={Boolean(mode)}>
			{!floating && !mode && size.width > 0 && <TimeAtmosphereBackground animated={false} theme={theme} />}
			<video className='absolute inset-0 size-full bg-[#172024] object-contain' ref={video} muted playsInline autoPlay hidden={mode !== 'camera'} />
			<canvas className='absolute inset-0 size-full' ref={canvas} hidden={mode !== 'screen'} />
			<svg
				ref={plane}
				className='absolute inset-0 size-full touch-none select-none'
				aria-label='交互量角器'
				onPointerDown={e => {
					const kind = (e.target as SVGElement).dataset.grip
					if (!kind || drag.current) return
					drag.current = {
						kind,
						id: e.pointerId,
						dx: cx - e.clientX,
						dy: cy - e.clientY,
						fine: e.shiftKey,
						startAngle: angle,
						pointerAngle: (Math.atan2(cy - e.clientY, e.clientX - cx) * 180) / Math.PI
					}
					e.currentTarget.setPointerCapture(e.pointerId)
				}}
				onPointerMove={move}
				onLostPointerCapture={() => {
					drag.current = null
				}}>
				{radius > 0 && (
					<g transform={`translate(${cx} ${cy}) rotate(${-base})`}>
						<path className={styles.face} d={`M ${-radius} 0 A ${radius} ${radius} 0 0 1 ${radius} 0 Z`} />
						<path
							className='stroke-secondary fill-none opacity-[.38]'
							d={`M ${-radius * 0.69} 0 A ${radius * 0.69} ${radius * 0.69} 0 0 1 ${radius * 0.69} 0`}
						/>
						<path
							className='fill-brand/15 stroke-brand'
							d={`M 0 0 L ${radius * 0.37} 0 A ${radius * 0.37} ${radius * 0.37} 0 0 0 ${end.x * 0.37} ${end.y * 0.37} Z`}
						/>
						<Scale radius={radius} />
						<path className='stroke-brand fill-none' strokeWidth={2.5} d={`M ${radius} 0 L 0 0 L ${end.x} ${end.y}`} />
						{[
							{ kind: 'base', x: radius, y: 0 },
							{ kind: 'angle', ...end },
							{ kind: 'center', x: 0, y: 0 }
						].map(({ kind, x, y }) => (
							<g key={kind} transform={`translate(${x} ${y})`}>
								<circle r={6} className='fill-article stroke-brand pointer-events-none' strokeWidth={2} />
								<circle r={20} data-grip={kind} className='cursor-grab fill-transparent active:cursor-grabbing' />
							</g>
						))}
					</g>
				)}
			</svg>
			<footer className={`card ${styles.controls}`}>
				<div className={styles.reading}>
					{!floating && (
						<Link href='/toolbox' className={styles.back} aria-label='返回工具箱'>
							<ArrowLeft size={18} />
						</Link>
					)}
					<h1>
						<DraftingCompass size={18} />
						量角器
					</h1>
					<div className='ml-auto flex items-center gap-0.5'>
						<AngleStepButton disabled={Math.round(angle * 10) === 0} onStep={() => setAngle(a => Math.max(0, Math.round(a * 10) - 1) / 10)} />
						<output aria-label='夹角'>{angle.toFixed(1)}°</output>
						<AngleStepButton increase disabled={Math.round(angle * 10) === 1800} onStep={() => setAngle(a => Math.min(1800, Math.round(a * 10) + 1) / 10)} />
					</div>
				</div>
				<nav>
					{!mode && media?.getDisplayMedia && (
						<button aria-label={floating ? '共享整屏' : '桌面小窗'} disabled={pending} onClick={() => (floating ? start('screen') : openWindow())}>
							<PictureInPicture2 />
							<span className={styles.modeLabel}>{floating ? '共享整屏' : '桌面小窗'}</span>
						</button>
					)}
					{!mode && !floating && media?.getUserMedia && (
						<button aria-label='摄像头' disabled={pending} onClick={() => start('camera')}>
							<Camera />
							<span className={styles.modeLabel}>摄像头</span>
						</button>
					)}
					{mode === 'camera' && (
						<button
							disabled={pending}
							onClick={async () => {
								const v = video.current!
								if (v.paused) {
									try {
										await v.play()
										setFrozen(false)
									} catch {
										setNotice('无法恢复取景')
									}
								} else {
									v.pause()
									setFrozen(true)
								}
							}}>
							{frozen ? <Play /> : <Pause />}
							{frozen ? '继续取景' : '定格'}
						</button>
					)}
					{mode && (
						<button onClick={stop}>
							<Square />
							结束取景
						</button>
					)}
					<div role='group' aria-label='尺面缩放' className='border-border inline-flex rounded-lg border'>
						<button aria-label='缩小尺面' title='缩小尺面' disabled={zoom === 0} onClick={() => changeZoom(-1)}>
							<ZoomOut />
						</button>
						<button aria-label='放大尺面' title='放大尺面' disabled={zoom === zoomLevels.length - 1} onClick={() => changeZoom(1)}>
							<ZoomIn />
						</button>
					</div>
					<button
						aria-label='复位'
						title='复位'
						onClick={() => {
							setOffset({ x: 0, y: 0 })
							setBase(0)
							setAngle(45)
							setZoom(defaultZoom)
						}}>
						<RotateCcw />
					</button>
				</nav>
				{notice && <p role='status'>{notice}</p>}
			</footer>
			{['left', 'right', 'bottomLeft', 'bottomRight'].map((side, i) => (
				<i key={side} ref={i === 2 ? marker : undefined} className={`${styles.marker} ${styles[side]}`} hidden={mode !== 'screen'} />
			))}
		</section>
	)
}
