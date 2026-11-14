'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import { ArrowLeft, ArrowLeftRight, LockKeyhole, Maximize, Minus, Plus, RotateCcw, Ruler, SlidersHorizontal, UnlockKeyhole } from 'lucide-react'
import { useTimeTheme } from '@/components/time-theme-provider'
import TimeAtmosphereBackground from '@/layout/backgrounds/time-atmosphere-background'
import {
	calibrationMatches,
	clampPosition,
	lengthLabel,
	parseCalibration,
	PREVIEW_PX_PER_MM,
	RULER_STORAGE_KEY,
	rulerTicks,
	screenStamp,
	type CalibrationResult,
	type RulerCalibration,
	type RulerUnit,
	type ScreenStamp
} from '@/lib/screen-ruler'
import styles from './ruler.module.css'
const CalibrationDialog = dynamic(() => import('./calibration-dialog').then(module => module.CalibrationDialog))
import { useElementSize } from './use-element-size'

export function RulerTool() {
	const { theme } = useTimeTheme()
	const root = useRef<HTMLDivElement>(null)
	const board = useElementSize<HTMLDivElement>()
	const [calibration, setCalibration] = useState<RulerCalibration | null>(null)
	const [stamp, setStamp] = useState<ScreenStamp | null>(null)
	const [pinchScale, setPinchScale] = useState(1)
	const [portrait, setPortrait] = useState(false)
	const [unit, setUnit] = useState<RulerUnit>('cm')
	const [direction, setDirection] = useState<'auto' | 'horizontal' | 'vertical'>('auto')
	const [positions, setPositions] = useState<[number, number]>([10, 50])
	const [active, setActive] = useState<0 | 1>(1)
	const [locked, setLocked] = useState(false)
	const [calibrating, setCalibrating] = useState<'reference' | 'device' | null>(null)
	const [fullscreen, setFullscreen] = useState(false)
	const [notice, setNotice] = useState('')
	const drag = useRef<{ index: 0 | 1; pointerId: number; offset: number } | null>(null)
	const vertical = direction === 'vertical' || (direction === 'auto' && portrait)
	const valid = Boolean(calibration && stamp && calibrationMatches(calibration, stamp) && Math.abs(pinchScale - 1) < 0.01)
	const pxPerMm = calibration?.pxPerMm || PREVIEW_PX_PER_MM
	const span = Math.max(0, (vertical ? board.height : board.width) - 48)
	const capacity = span / pxPerMm
	const ends = positions.map(p => clampPosition(p, capacity)) as [number, number]
	const length = Math.abs(ends[1] - ends[0])
	const ticks = rulerTicks(span, pxPerMm, unit)

	useEffect(() => {
		try {
			setCalibration(parseCalibration(localStorage.getItem(RULER_STORAGE_KEY)))
		} catch {
			/* Measurement still works without persistent storage. */
		}
		const update = () => {
			setStamp(screenStamp())
			setPortrait(window.innerWidth <= 640 && window.innerHeight > window.innerWidth)
			setPinchScale(window.visualViewport?.scale || 1)
		}
		const updateFullscreen = () => setFullscreen(document.fullscreenElement === root.current)
		let resolution: MediaQueryList
		const watchResolution = () => {
			resolution?.removeEventListener('change', watchResolution)
			update()
			resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
			resolution.addEventListener('change', watchResolution)
		}
		watchResolution()
		window.addEventListener('resize', update)
		window.addEventListener('focus', update)
		window.visualViewport?.addEventListener('resize', update)
		document.addEventListener('fullscreenchange', updateFullscreen)
		return () => {
			resolution.removeEventListener('change', watchResolution)
			window.removeEventListener('resize', update)
			window.removeEventListener('focus', update)
			window.visualViewport?.removeEventListener('resize', update)
			document.removeEventListener('fullscreenchange', updateFullscreen)
		}
	}, [])

	function saveCalibration(result: CalibrationResult) {
		const next: RulerCalibration = { version: 2, ...result, ...screenStamp() }
		setCalibration(next)
		setStamp(screenStamp())
		setCalibrating(null)
		setLocked(false)
		setPositions([0, 50])
		try {
			localStorage.setItem(RULER_STORAGE_KEY, JSON.stringify(next))
			setNotice(result.method === 'device' ? '手机型号已保存；当前为规格估算，未经实物复核' : '校准已保存在当前浏览器')
		} catch {
			setNotice('本次校准已生效；浏览器未允许保存，下次需要重新校准')
		}
	}
	function move(index: 0 | 1, mm: number) {
		setPositions(previous => {
			const next: [number, number] = [...previous]
			next[index] = clampPosition(mm, capacity)
			return next
		})
	}
	function coordinate(event: PointerEvent<HTMLButtonElement>) {
		const rect = board.ref.current!.getBoundingClientRect()
		return (vertical ? event.clientY - rect.top : event.clientX - rect.left) - 24
	}
	function pointerDown(event: PointerEvent<HTMLButtonElement>, index: 0 | 1) {
		if (!valid || locked || !event.isPrimary || event.button !== 0) return
		event.currentTarget.setPointerCapture(event.pointerId)
		drag.current = { index, pointerId: event.pointerId, offset: coordinate(event) - ends[index] * pxPerMm }
		setActive(index)
	}
	function pointerMove(event: PointerEvent<HTMLButtonElement>) {
		if (!drag.current || drag.current.pointerId !== event.pointerId || !valid || locked) return
		move(drag.current.index, (coordinate(event) - drag.current.offset) / pxPerMm)
	}
	function keyMove(event: KeyboardEvent<HTMLButtonElement>, index: 0 | 1) {
		if (!valid || locked) return
		const step = event.shiftKey ? 0.1 : 1
		const value =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? capacity
					: ['ArrowLeft', 'ArrowUp'].includes(event.key)
						? ends[index] - step
						: ['ArrowRight', 'ArrowDown'].includes(event.key)
							? ends[index] + step
							: null
		if (value !== null) {
			event.preventDefault()
			move(index, value)
		}
	}
	async function toggleFullscreen() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen()
			else if (root.current?.requestFullscreen) await root.current.requestFullscreen()
			else setNotice('当前浏览器不提供全屏；尺子已按可用屏幕显示')
		} catch {
			setNotice('未能进入全屏，仍可正常使用尺子')
		}
	}

	return (
		<div ref={root} className={styles.root} data-vertical={vertical} lang='zh-CN'>
			{stamp && <TimeAtmosphereBackground animated={false} theme={theme} />}
			<div className={styles.boardWrap}>
				<div ref={board.ref} className={styles.board} data-testid='ruler-board' data-vertical={vertical} data-calibrated={valid}>
					<svg
						className={styles.scale}
						width={board.width}
						height={board.height}
						aria-label={valid ? (calibration?.method === 'device' ? '按手机型号估算的尺子刻度' : '已校准的尺子刻度') : '未经校准的刻度预览'}>
						{ticks.map((tick, index) => (
							<g key={index}>
								{vertical ? (
									<>
										<line x1='0' x2={tick.size} y1={24 + tick.pixel} y2={24 + tick.pixel} />
										<line x1={board.width - tick.size} x2={board.width} y1={24 + tick.pixel} y2={24 + tick.pixel} />
										{tick.label !== null && (
											<>
												<text x='46' y={24 + tick.pixel} dominantBaseline='middle'>
													{tick.label}
												</text>
												<text x={board.width - 46} y={24 + tick.pixel} textAnchor='end' dominantBaseline='middle'>
													{tick.label}
												</text>
											</>
										)}
									</>
								) : (
									<>
										<line x1={24 + tick.pixel} x2={24 + tick.pixel} y1='0' y2={tick.size} />
										<line x1={24 + tick.pixel} x2={24 + tick.pixel} y1={board.height - tick.size} y2={board.height} />
										{tick.label !== null && (
											<>
												<text x={24 + tick.pixel} y='57' textAnchor='middle'>
													{tick.label}
												</text>
												<text x={24 + tick.pixel} y={board.height - 45} textAnchor='middle'>
													{tick.label}
												</text>
											</>
										)}
									</>
								)}
							</g>
						))}
					</svg>
					{valid ? (
						<>
							<div
								className={styles.selection}
								style={
									vertical
										? { top: 24 + Math.min(...ends) * pxPerMm, height: length * pxPerMm }
										: { left: 24 + Math.min(...ends) * pxPerMm, width: length * pxPerMm }
								}
							/>
							{ends.map((mm, index) => (
								<div
									key={index}
									className={styles.marker}
									data-endpoint={index}
									data-active={active === index}
									style={vertical ? { top: 24 + mm * pxPerMm } : { left: 24 + mm * pxPerMm }}>
									<button
										role='slider'
										aria-label={index === 0 ? '起点 A' : '终点 B'}
										aria-orientation={vertical ? 'vertical' : 'horizontal'}
										aria-valuemin={0}
										aria-valuemax={Number(capacity.toFixed(1))}
										aria-valuenow={Number(mm.toFixed(1))}
										aria-valuetext={`${mm.toFixed(1)} 毫米`}
										aria-disabled={locked}
										onFocus={() => setActive(index as 0 | 1)}
										onKeyDown={e => keyMove(e, index as 0 | 1)}
										onPointerDown={e => pointerDown(e, index as 0 | 1)}
										onPointerMove={pointerMove}
										onPointerUp={() => {
											drag.current = null
										}}
										onPointerCancel={() => {
											drag.current = null
										}}
										onLostPointerCapture={() => {
											drag.current = null
										}}>
										<span>{index === 0 ? 'A' : 'B'}</span>
										<i />
									</button>
								</div>
							))}
						</>
					) : null}
				</div>
			</div>
			<div className={`card ${styles.controls}`}>
				<header className={styles.header}>
					<Link href='/toolbox' aria-label='返回工具箱' className={styles.back}>
						<ArrowLeft size={18} />
						<span>工具箱</span>
					</Link>
					<h1>
						<Ruler size={19} />
						屏幕尺子
					</h1>
					<button className={styles.calibrateButton} onClick={() => setCalibrating('reference')}>
						<span className={valid ? styles.statusReady : styles.statusPending} />
						{valid ? (calibration?.method === 'device' ? '型号估算' : '已校准') : calibration ? '重新校准' : '校准屏幕'}
						<SlidersHorizontal size={15} />
					</button>
				</header>
				<section className={styles.readout} aria-label='测量结果'>
					<div>
						<p className={styles.eyebrow}>{valid ? '标记间距' : '屏幕实物测量'}</p>
						<div className={styles.value}>
							<output data-testid='measurement'>{valid ? lengthLabel(length, unit) : '—'}</output>
							<span>{unit}</span>
						</div>
						<p className={styles.subValue}>
							{valid
								? `${length.toFixed(1)} mm · ${calibration?.method === 'device' ? `${calibration.referenceName} · 型号估算` : calibration?.method === 'ruler' ? '实体尺复核通过' : calibration?.method === 'connector' ? 'USB 校准 · 可能不够准确' : calibration?.method === 'custom' ? '自定义长度校准' : '实物校准'}`
								: '未校准的刻度仅供预览'}
						</p>
					</div>
					<div className={styles.toolbar}>
						<div className={styles.segment} aria-label='刻度单位'>
							<button aria-pressed={unit === 'cm'} onClick={() => setUnit('cm')}>
								厘米
							</button>
							<button aria-pressed={unit === 'in'} onClick={() => setUnit('in')}>
								英寸
							</button>
						</div>
						<div className={styles.toolButtons}>
							<button
								onClick={() => {
									setDirection(vertical ? 'horizontal' : 'vertical')
									drag.current = null
								}}
								title='切换横竖方向'
								aria-label='切换横竖方向'>
								<ArrowLeftRight size={17} />
								<span>转向</span>
							</button>
							<button
								aria-label={locked ? '解锁标记' : '锁定标记'}
								aria-pressed={locked}
								disabled={!valid}
								onClick={() => {
									setLocked(!locked)
									drag.current = null
								}}>
								{locked ? <LockKeyhole size={17} /> : <UnlockKeyhole size={17} />}
								<span>{locked ? '解锁' : '锁定'}</span>
							</button>
							<button aria-label={fullscreen ? '退出全屏' : '全屏显示'} onClick={() => void toggleFullscreen()}>
								<Maximize size={17} />
								<span>全屏</span>
							</button>
						</div>
					</div>
				</section>
				{!valid && (
					<div className={styles.onboarding}>
						<Ruler size={29} />
						<h2>{Math.abs(pinchScale - 1) >= 0.01 ? '请恢复页面缩放' : calibration ? '屏幕比例发生变化' : '先校准，再测量'}</h2>
						<p>
							{Math.abs(pinchScale - 1) >= 0.01
								? '双指缩放会改变尺子的实际大小，恢复后即可继续。'
								: calibration
									? '请重新校准后继续测量。'
									: '选择手边的实物校准，也可填写已知长度。'}
						</p>
						<button className={styles.primary} onClick={() => setCalibrating('reference')}>
							开始校准
							<ArrowLeftRight size={17} />
						</button>
						<button onClick={() => setCalibrating('device')}>选择当前手机型号</button>
					</div>
				)}
				<footer className={styles.footer}>
					<div className={styles.fineControls}>
						<div className={styles.segment}>
							<button disabled={!valid} aria-pressed={active === 0} onClick={() => setActive(0)}>
								A 起点
							</button>
							<button disabled={!valid} aria-pressed={active === 1} onClick={() => setActive(1)}>
								B 终点
							</button>
						</div>
						<button aria-label='标记后退 0.1 毫米' disabled={!valid || locked} onClick={() => move(active, ends[active] - 0.1)}>
							<Minus size={18} />
						</button>
						<span>0.1 mm</span>
						<button aria-label='标记前进 0.1 毫米' disabled={!valid || locked} onClick={() => move(active, ends[active] + 0.1)}>
							<Plus size={18} />
						</button>
						<button aria-label='重置测量标记' disabled={!valid || locked} onClick={() => setPositions([0, Math.min(50, capacity)])}>
							<RotateCcw size={17} />
						</button>
					</div>
					<p className={styles.footerNote} role='status'>
						{notice && (
							<span>
								{notice}
								<br />
							</span>
						)}
						读数分辨率不代表精度。换显示器后请重新校准。
					</p>
				</footer>
			</div>
			{calibrating && <CalibrationDialog initialScale={pxPerMm} initialMode={calibrating} onSave={saveCalibration} onClose={() => setCalibrating(null)} />}
		</div>
	)
}
