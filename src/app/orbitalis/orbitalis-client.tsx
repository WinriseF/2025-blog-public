'use client'

import Link from 'next/link'
import { ArrowLeft, CircleHelp, LoaderCircle, Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { attachLunarController, type LunarState } from './lunar-controller'
import { initialTextureState, sceneAssetUrl, TEXTURE_QUALITIES } from './scene-assets'
import styles from './orbitalis.module.css'

const initialState: LunarState = {
	phase: 'poster', rotating: false, dragging: false, zoom: 1, fallbackReason: null
}

export default function OrbitalisClient() {
	const surface = useRef<HTMLButtonElement>(null)
	const host = useRef<HTMLSpanElement>(null)
	const controller = useRef<ReturnType<typeof attachLunarController> | null>(null)
	const [state, setState] = useState(initialState)
	const [texture, setTexture] = useState(initialTextureState)
	const [attempt, setAttempt] = useState(0)
	const ready = state.phase === 'ready'
	const fallback = state.phase === 'fallback'

	useEffect(() => {
		if (!surface.current || !host.current) return
		let active = true
		setState(initialState)
		setTexture(initialTextureState)
		const attached = attachLunarController(surface.current, host.current, setState, async (...args) => {
			const { createLunarScene } = await import('./lunar-scene')
			return createLunarScene(...args, next => { if (active) setTexture(next) })
		})
		controller.current = attached
		return () => {
			active = false
			attached.destroy()
			controller.current = null
		}
	}, [attempt])

	const status = fallback
		? state.fallbackReason?.kind === 'gpu-memory' ? '显存不足，当前显示静态预览' : '三维场景暂时无法加载，当前显示静态预览'
		: state.phase === 'loading' ? '正在载入星球与环形空间站…'
		: state.phase === 'poster' ? '点击场景，开始探索'
		: state.stationDragging ? '正在拖动空间站 · 可绕至星球前后'
		: state.stationHovered ? '按住空间站拖动 · 调整位置与轨道倾角'
		: state.rotating ? '空间站公转 · 圆环独立自转中' : '动态已暂停 · 拖动或缩放继续探索'
	const textureStatus = texture.loading
		? `正在加载 ${texture.requested} 贴图${texture.active ? ` · 当前 ${texture.active}` : ''}`
		: texture.active && texture.dimensions ? `${texture.active} · ${texture.dimensions[0]} × ${texture.dimensions[1]}` : '贴图准备中'

	return (
		<div className={styles.observatory}>
			<button
				ref={surface}
				type='button'
				className={styles.surface}
				data-phase={state.phase}
				data-dragging={state.dragging}
				aria-busy={state.phase === 'loading'}
				aria-disabled={fallback}
				aria-label='探索场景：拖星球旋转，拖空间站前后环绕；滚轮或双指缩放，Shift 拖动平移，方向键旋转，加减键缩放，Home 复位'
				aria-describedby='orbitalis-instructions'>
				<span
					className={`${styles.preview} ${ready ? styles.hidden : ''}`}
					style={{ backgroundImage: `linear-gradient(#0008, #0008), url("${sceneAssetUrl('space-background-v1.webp')}")` }}>
					<img
						src={sceneAssetUrl('observatory-poster-v1.webp')}
						alt='彩色风暴星球与精细的环形空间站'
						width={1600}
						height={1200}
						decoding='async'
						draggable={false}
						className={styles.poster}
					/>
				</span>
				<span ref={host} className={`${styles.canvas} ${ready ? styles.ready : ''}`} />
			</button>
			<header className={styles.masthead}>
				<Link href='/' className={styles.back} aria-label='返回博客首页'><ArrowLeft size={16} />返回首页</Link>
				<div className={styles.brand}>ORBITALIS<span>/</span>PELAGIA</div>
			</header>
			<div className={styles.interaction}>
				<div className={styles.qualityRow}>
					{fallback ? (
						<button type='button' className={styles.retry} onClick={() => setAttempt(value => value + 1)}><RotateCcw size={14} />重新加载</button>
					) : (
						<div className={styles.qualities} role='group' aria-label='星球贴图清晰度'>
							{TEXTURE_QUALITIES.map(quality => (
								<button
									key={quality}
									type='button'
									aria-pressed={texture.requested === quality}
									disabled={!ready || !texture.supported.includes(quality)}
									title={ready && !texture.supported.includes(quality) ? '此分辨率超出当前设备的贴图上限' : `${quality} 星球贴图`}
									onClick={() => controller.current?.selectTextureQuality(quality)}>{quality}</button>
							))}
						</div>
					)}
					<details className={styles.help}>
						<summary aria-label='操作说明' title='操作说明'><CircleHelp size={14} /></summary>
						<p id='orbitalis-instructions' className={styles.instructions}>
							拖动星球：旋转视角<br />拖动空间站：调整轨道<br />滚轮 / 双指：缩放<br />Shift 拖动：平移<br />方向键：旋转 · Home：复位
						</p>
					</details>
				</div>
				{!fallback && (
					<>
						<div className={styles.controlRow}>
							<div className={styles.controls}>
								<button type='button' aria-label={state.rotating ? '暂停旋转' : '自动旋转'} title={state.rotating ? '暂停旋转' : '自动旋转'} aria-pressed={state.rotating} disabled={!ready} onClick={() => controller.current?.toggleRotation()}>{state.rotating ? <Pause size={14} /> : <Play size={14} />}</button>
								<span className={styles.divider} />
								<button type='button' aria-label='复位视角' title='复位视角' disabled={!ready} onClick={() => controller.current?.reset()}><RotateCcw size={14} /></button>
							</div>
							<div className={`${styles.controls} ${styles.zoom}`} role='group' aria-label='缩放视角'>
								<button type='button' aria-label='缩小视角' title='缩小视角' disabled={!ready || state.zoom <= 1} onClick={() => controller.current?.zoomOut()}><Minus size={14} /></button>
								<output aria-label='当前放大倍数'>{Number(state.zoom.toFixed(1))}×</output>
								<button type='button' aria-label='放大视角' title='放大视角' disabled={!ready || state.zoom >= 6} onClick={() => controller.current?.zoomIn()}><Plus size={14} /></button>
							</div>
						</div>
						<span className={styles.textureStatus} role='status'>{texture.loading && <LoaderCircle size={10} className={styles.spinner} />}{textureStatus}</span>
					</>
				)}
				<p className={styles.status} role='status'>{status}</p>
				{!fallback && texture.error && <p className={styles.error} role='alert'>{texture.error}</p>}
			</div>
		</div>
	)
}
