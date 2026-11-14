'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { ArrowLeft, Check, ChevronRight, CreditCard, FileText, IdCard, MemoryStick, RotateCcw, Ruler, Search, Smartphone, Usb, X } from 'lucide-react'
import {
	ALIGNMENT_TOLERANCE,
	calibrationScale,
	compareCardSamples,
	fitRulerCalibration,
	screenStamp,
	type CalibrationResult,
	type CalibrationSample
} from '@/lib/screen-ruler'
import { searchReferences, referenceBrands, referenceLengths, rulerReferences, type RulerReference } from '@/lib/ruler-references'
import { useElementSize } from './use-element-size'
import styles from './ruler.module.css'

type CalibrationDialogProps = {
	initialScale: number
	onSave: (result: CalibrationResult) => void
	onClose: () => void
}

export function CalibrationDialog({ initialScale, onSave, onClose }: CalibrationDialogProps) {
	const dialog = useRef<HTMLDialogElement>(null)
	const [selected, setSelected] = useState<RulerReference | 'ruler' | 'custom' | null>(null)
	const [query, setQuery] = useState('')
	const [expanded, setExpanded] = useState<Record<string, boolean>>({})
	const [limits, setLimits] = useState<Record<string, number>>({})
	const searching = Boolean(query.trim())
	const { references: filtered, showRuler, showCustom } = useMemo(() => searchReferences(query), [query])
	const groups = [
		{ id: 'phone', label: '手机', icon: Smartphone, hint: '按品牌选择机型' },
		{ id: 'identity', label: '身份证 / 证件', icon: IdCard, hint: '按国家和证件版本选择' },
		{ id: 'card', label: '银行卡', icon: CreditCard, hint: '标准尺寸银行卡' },
		{ id: 'memory', label: '存储卡', icon: MemoryStick, hint: 'SD 大卡 / microSD（TF）卡' },
		{ id: 'connector', label: 'USB 插头', icon: Usb, hint: 'U 盘 / 数据线 · 可能不够准确' },
		{ id: 'custom', label: '自定义参照物', icon: FileText, hint: '拖动对齐实物，填写已知长度' },
		{ id: 'ruler', label: '实体尺', icon: Ruler, hint: '使用带毫米刻度的尺子' }
	]

	function toggleGroup(id: string) {
		setExpanded(previous => ({ ...previous, [id]: !previous[id] }))
	}
	function referenceButton(item: RulerReference) {
		return (
			<button key={item.id} onClick={() => setSelected(item)}>
				<span>
					{item.name}
					<small>
						{item.region} · {item.category === 'phone' ? '长 × 宽' : item.category === 'connector' ? '金属壳高 × 宽' : '短边 × 长边'} {item.heightMm} ×{' '}
						{item.widthMm} mm
					</small>
				</span>
				<ChevronRight size={18} aria-hidden='true' />
			</button>
		)
	}

	useEffect(() => {
		dialog.current?.showModal()
	}, [])

	useEffect(() => {
		dialog.current?.querySelector<HTMLElement>('[data-stage-focus]')?.focus()
	}, [selected])

	return (
		<dialog
			ref={dialog}
			className={styles.dialog}
			data-stage={selected ? 'align' : 'select'}
			data-custom={selected === 'custom'}
			onCancel={onClose}
			onClose={onClose}
			aria-labelledby='calibration-title'>
			{selected ? (
				<CalibrationSession reference={selected} initialScale={initialScale} onSave={onSave} onClose={onClose} onBack={() => setSelected(null)} />
			) : (
				<>
					<div className={styles.dialogHeader}>
						<div>
							<p className={styles.eyebrow}>屏幕校准</p>
							<h2 id='calibration-title' data-stage-focus tabIndex={-1}>
								选择校准参照物
							</h2>
						</div>
						<button aria-label='关闭校准' onClick={onClose}>
							<X size={20} />
						</button>
					</div>
					<div className={styles.catalogFilters}>
						<label className={styles.catalogSearch}>
							<Search size={18} aria-hidden='true' />
							<input
								aria-label='搜索校准参照物'
								type='search'
								placeholder='搜索参照物、型号或品牌'
								autoCapitalize='none'
								autoCorrect='off'
								spellCheck={false}
								value={query}
								onChange={event => {
									setQuery(event.target.value)
									setLimits({})
									setExpanded(
										event.target.value.trim()
											? Object.fromEntries([...groups.map(group => group.id), ...referenceBrands.map(brand => brand.id)].map(id => [id, true]))
											: {}
									)
								}}
							/>
						</label>
					</div>
					<p className={styles.calibrationHint}>
						{searching ? `找到 ${filtered.length + Number(showRuler) + Number(showCustom)} 个参照物` : '选择手边的实物，或自定义已知长度'}
					</p>
					<div className={styles.catalogList}>
						{groups.map(({ id, label, icon: Icon, hint }) => {
							const items = filtered.filter(item => item.category === id)
							if (id === 'ruler' ? !showRuler : id === 'custom' ? !showCustom : !items.length) return null
							const directReference =
								id === 'custom' || id === 'ruler' ? id : rulerReferences.filter(item => item.category === id).length === 1 ? items[0] : null
							return (
								<CatalogGroup
									key={id}
									id={id}
									label={label}
									hint={hint}
									icon={<Icon size={22} aria-hidden='true' />}
									expanded={directReference ? undefined : Boolean(expanded[id])}
									onToggle={() => (directReference ? setSelected(directReference) : toggleGroup(id))}>
									{directReference ? null : id === 'phone' ? (
										[...referenceBrands]
											.sort((a, b) => (searching ? filtered.findIndex(item => item.brand === a.id) - filtered.findIndex(item => item.brand === b.id) : 0))
											.map(brand => {
												const models = items.filter(item => item.brand === brand.id)
												if (!models.length) return null
												const limit = limits[brand.id] || 40
												return (
													<CatalogGroup
														key={brand.id}
														id={brand.id}
														label={brand.label}
														hint={`${models.length} 个型号 / 版本`}
														expanded={Boolean(expanded[brand.id])}
														onToggle={() => toggleGroup(brand.id)}>
														<div className={styles.referenceOptions}>
															{models.slice(0, limit).map(referenceButton)}
															{models.length > limit && (
																<button onClick={() => setLimits(previous => ({ ...previous, [brand.id]: limit + 40 }))}>
																	显示更多（还有 {models.length - limit} 个）
																</button>
															)}
														</div>
													</CatalogGroup>
												)
											})
									) : (
										<div className={styles.referenceOptions}>{items.map(referenceButton)}</div>
									)}
								</CatalogGroup>
							)
						})}
						{!filtered.length && !showRuler && !showCustom && (
							<>
								<p className={styles.smallNote}>没有找到匹配的参照物，可换个关键词，或使用已知长度的实物校准。</p>
								<div className={styles.referenceOptions}>
									<button onClick={() => setSelected('custom')}>
										<span>使用自定义长度</span>
										<ChevronRight size={18} aria-hidden='true' />
									</button>
								</div>
							</>
						)}
					</div>
				</>
			)}
		</dialog>
	)
}

function CatalogGroup({
	id,
	label,
	hint,
	icon,
	expanded,
	onToggle,
	children
}: {
	id: string
	label: string
	hint: string
	icon?: ReactNode
	expanded?: boolean
	onToggle: () => void
	children?: ReactNode
}) {
	return (
		<section className={styles.catalogGroup} data-nested={!icon}>
			<button
				className={styles.catalogGroupToggle}
				aria-label={label}
				aria-expanded={expanded}
				aria-controls={expanded === undefined ? undefined : `reference-group-${id}`}
				onClick={onToggle}>
				{icon && <span className={styles.catalogGroupIcon}>{icon}</span>}
				<span>
					{label}
					<small>{hint}</small>
				</span>
				<ChevronRight className={styles.catalogChevron} size={18} aria-hidden='true' />
			</button>
			<AnimatePresence initial={false}>
				{expanded && (
					<CatalogGroupPanel key={id} id={id}>
						{children}
					</CatalogGroupPanel>
				)}
			</AnimatePresence>
		</section>
	)
}

function CatalogGroupPanel({ id, children }: { id: string; children: ReactNode }) {
	const present = useIsPresent()
	const reducedMotion = useReducedMotion()
	return (
		<motion.div
			id={`reference-group-${id}`}
			className={styles.catalogGroupPanel}
			inert={!present}
			aria-hidden={!present}
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: 'auto', opacity: 1 }}
			exit={{ height: 0, opacity: 0 }}
			transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}>
			<div className={styles.catalogGroupContent}>{children}</div>
		</motion.div>
	)
}

function CalibrationSession({
	initialScale,
	reference,
	onSave,
	onClose,
	onBack
}: CalibrationDialogProps & { reference: RulerReference | 'ruler' | 'custom'; onBack: () => void }) {
	const object = typeof reference === 'string' ? null : reference
	const method = typeof reference === 'string' ? reference : reference.category === 'phone' || reference.category === 'connector' ? reference.category : 'card'
	const [axis, setAxis] = useState<'width' | 'height'>('width')
	const lengths = object ? referenceLengths(object, axis) : [85.6, 85.6, 53.98]
	const edgeName = method === 'phone' ? (axis === 'width' ? '机身宽度' : '机身长度') : method === 'connector' ? '金属壳宽度' : '长边'
	const area = useElementSize<HTMLDivElement>()
	const [step, setStep] = useState(0)
	const [pixels, setPixels] = useState(lengths[0] * initialScale)
	const [samples, setSamples] = useState<CalibrationSample[]>([])
	const [answer, setAnswer] = useState('')
	const [error, setError] = useState('')
	const [zoomed, setZoomed] = useState(false)
	const [displayChanged, setDisplayChanged] = useState(false)
	const [trialPixels, setTrialPixels] = useState<number[]>([])
	const [result, setResult] = useState<CalibrationResult | null>(null)
	const baseline = useRef<ReturnType<typeof screenStamp> | null>(null)
	const drag = useRef<{ id: number; coordinate: number; pixels: number } | null>(null)
	const [fractions] = useState(() => [0.46 + Math.random() * 0.05, 0.26 + Math.random() * 0.05, 0.86 + Math.random() * 0.05])
	const vertical = area.height > area.width
	const maxPixels = Math.max(40, (vertical ? area.height : area.width) - (method === 'ruler' ? 16 : 0))
	const referenceMm = lengths[Math.min(step, 2)]
	const fit = samples.length === 3 ? fitRulerCalibration(samples) : null
	const minPixels = method === 'connector' || method === 'custom' || object?.category === 'memory' ? 4 : 40
	const linePixels = method !== 'ruler' ? Math.max(minPixels, Math.min(maxPixels, pixels)) : trialPixels[step] || 40
	// Custom alignment stays in pixels; a smaller viewport must not save its clipped preview.
	const lineDoesNotFit = (method === 'custom' ? pixels : method === 'ruler' ? linePixels : 0) > maxPixels
	const steps =
		method === 'custom'
			? ['对齐并填写长度']
			: method !== 'ruler'
				? [`对齐${edgeName}`, '再次对齐', method !== 'card' ? '独立复核' : '短边检查']
				: ['测量第一段', '测量第二段', '测量第三段', '独立复核']

	useEffect(() => {
		baseline.current = screenStamp()
		let resolution: MediaQueryList
		const update = () => {
			const next = screenStamp()
			setZoomed(Math.abs((window.visualViewport?.scale || 1) - 1) >= 0.01)
			if (baseline.current && (next.dpr !== baseline.current.dpr || next.width !== baseline.current.width || next.height !== baseline.current.height))
				setDisplayChanged(true)
		}
		const watch = () => {
			resolution?.removeEventListener('change', watch)
			update()
			resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
			resolution.addEventListener('change', watch)
		}
		watch()
		window.addEventListener('resize', update)
		window.visualViewport?.addEventListener('resize', update)
		return () => {
			resolution.removeEventListener('change', watch)
			window.removeEventListener('resize', update)
			window.visualViewport?.removeEventListener('resize', update)
		}
	}, [])

	useLayoutEffect(() => {
		if (method !== 'ruler' || !area.ref.current) return
		// Measure after entering calibration, while the dialog is already open.
		const bounds = area.ref.current.getBoundingClientRect()
		const available = Math.max(40, Math.max(bounds.width, bounds.height) - 16)
		setTrialPixels([...fractions, 0.65].map(fraction => Math.round(available * fraction)))
	}, [method, fractions, area.ref])

	function restart() {
		setTrialPixels([...fractions, 0.62 + Math.random() * 0.07].map(fraction => Math.round(maxPixels * fraction)))
		setStep(0)
		setSamples([])
		setResult(null)
		setAnswer('')
		setError('')
		setPixels(lengths[0] * initialScale)
		baseline.current = screenStamp()
		setDisplayChanged(false)
	}
	function changePixels(value: number) {
		setPixels(Math.max(minPixels, Math.min(maxPixels, value)))
		setError('')
	}
	function startDrag(event: PointerEvent<HTMLButtonElement>) {
		if (method === 'ruler' || !event.isPrimary || event.button !== 0) return
		event.currentTarget.setPointerCapture(event.pointerId)
		drag.current = { id: event.pointerId, coordinate: vertical ? event.clientY : event.clientX, pixels: linePixels }
	}
	function moveDrag(event: PointerEvent<HTMLButtonElement>) {
		if (!drag.current || drag.current.id !== event.pointerId) return
		// The start stays anchored; the adjustable end follows the pointer one-to-one.
		changePixels(drag.current.pixels + (vertical ? event.clientY : event.clientX) - drag.current.coordinate)
	}
	function submit() {
		if (zoomed || displayChanged || lineDoesNotFit) return
		if (method === 'custom') {
			const pxPerMm = calibrationScale(linePixels, Number(answer))
			if (!pxPerMm) {
				setError('请输入有效的实际长度（毫米），并检查实物两端是否对齐。')
				return
			}
			onSave({ pxPerMm, method, checkErrorMm: null })
			return
		}
		if (method !== 'ruler') {
			const scale = calibrationScale(linePixels, referenceMm)
			if (!scale) return
			if (step === 0) {
				setSamples([{ pixels: linePixels, mm: lengths[0] }])
				setPixels(linePixels * 0.92)
				setStep(1)
			} else if (step === 1) {
				if (!compareCardSamples(samples[0].pixels, linePixels)) {
					setError('两次对齐相差超过 2%，请重新校准并正对屏幕观察。')
					return
				}
				setSamples([...samples, { pixels: linePixels, mm: lengths[0] }])
				setPixels(((linePixels * lengths[2]) / lengths[0]) * 0.94)
				setStep(2)
			} else {
				const pxPerMm = (samples[0].pixels + samples[1].pixels) / (2 * lengths[0])
				const checkErrorMm = Math.abs(linePixels / pxPerMm - lengths[2])
				if (checkErrorMm > (method === 'connector' || object?.category === 'memory' ? lengths[2] * ALIGNMENT_TOLERANCE : 0.6)) {
					setError('复核与前两次校准不一致，请检查实物版本与对齐位置。')
					return
				}
				setResult({ pxPerMm, method, checkErrorMm, referenceId: object?.id })
			}
		} else {
			const mm = Number(answer)
			if (!calibrationScale(linePixels, mm)) {
				setError('请输入实体尺量到的有效毫米长度。')
				return
			}
			if (step < 3) {
				const next = [...samples, { pixels: linePixels, mm }]
				if (next.length === 3) {
					const fitted = fitRulerCalibration(next)
					if (!fitted || fitted.residualMm > 1) {
						setError('三次测量不一致，请重新校准。始终测量两条端线的中心。')
						return
					}
				}
				setSamples(next)
				setStep(step + 1)
				setAnswer('')
			} else if (fit) {
				const checkErrorMm = Math.abs(mm - linePixels / fit.pxPerMm)
				if (checkErrorMm > 1) {
					setError('本次复核偏差超过 1 mm，请检查读数或重新校准。')
					return
				}
				setResult({ pxPerMm: fit.pxPerMm, method, checkErrorMm })
			}
		}
	}

	const blocked = zoomed || displayChanged || (!result && lineDoesNotFit)
	return (
		<>
			<div className={styles.dialogHeader}>
				<button data-stage-focus aria-label='返回选择参照物' onClick={onBack}>
					<ArrowLeft size={20} />
				</button>
				<div className={styles.calibrationHeading}>
					<p className={styles.eyebrow}>{result ? '校准完成' : `第 ${step + 1} / ${steps.length} 步 · ${steps[step]}`}</p>
					<h2 id='calibration-title'>{result ? '刻度已与实物对齐' : object?.name || (method === 'custom' ? '自定义长度校准' : '实体尺校准')}</h2>
				</div>
				<button aria-label='关闭校准' onClick={onClose}>
					<X size={20} />
				</button>
			</div>
			{result ? (
				<div className={styles.calibrationResult}>
					<Check size={40} />
					<p>
						{method === 'phone'
							? '机身对齐与独立复核通过'
							: method === 'connector'
								? '插头宽度对齐与独立复核通过'
								: method === 'card'
									? '长边重复对齐与短边检查通过'
									: '三段测量与独立复核通过'}
					</p>
					{result.checkErrorMm !== null && (
						<strong>
							本次{method === 'card' ? '短边检查' : '复核'}偏差 {result.checkErrorMm.toFixed(2)} mm
						</strong>
					)}
					<p className={styles.smallNote}>这是本次检查的偏差，不代表所有测量的精度。换显示器或调整缩放后，请重新检查。</p>
					{method === 'connector' && <p className={styles.smallNote}>参照物较小，校准可能不够准确。</p>}
				</div>
			) : (
				<>
					{object && (
						<div className={styles.referenceDetails}>
							<p>
								{object.region}
								{method === 'phone' ? ' · 请用另一台手机作为实物参照，取下手机壳，对齐机身边缘。' : ''}
								{object.note ? ` · ${object.note}` : ''}
							</p>
							{object.sources.map((url, index) => (
								<a key={url} href={url} target='_blank' rel='noreferrer'>
									官方尺寸来源{object.sources.length > 1 ? ` ${index + 1}` : ''}
								</a>
							))}
						</div>
					)}
					{method === 'phone' && (
						<div className={styles.segment} aria-label='校准边'>
							{(['width', 'height'] as const).map(value => (
								<button
									key={value}
									aria-pressed={axis === value}
									onClick={() => {
										restart()
										setAxis(value)
										setPixels((value === 'width' ? object!.widthMm : object!.heightMm) * initialScale)
									}}>
									{value === 'width' ? '机身宽度' : '机身长度'}
								</button>
							))}
						</div>
					)}
					<p className={styles.calibrationHint}>
						{method === 'custom'
							? `将实物一端对齐固定的${vertical ? '上' : '左'}端线，拖动${vertical ? '下' : '右'}端线与另一端重合，再在下方填写这段实际长度。`
							: method !== 'ruler'
								? `将${method === 'phone' || method === 'connector' ? edgeName : step < 2 ? '实物长边' : '实物短边'}靠近屏幕，先对齐固定的${vertical ? '上' : '左'}端线，再拖动${vertical ? '下' : '右'}端与实物另一端重合。${step === 1 ? '请重新对齐一次。' : ''}`
								: '用实体尺测量两条端线中心之间的长度，然后输入毫米数。正对屏幕观察。'}
					</p>
					<div ref={area.ref} className={styles.calibrationArea} data-vertical={vertical} data-adjustable={method !== 'ruler'}>
						<div className={styles.referenceLine} data-testid='calibration-line' style={vertical ? { height: linePixels } : { width: linePixels }}>
							<i />
							{method !== 'custom' && <span>{method !== 'ruler' ? `${referenceMm} mm` : '测量这段线'}</span>}
							<i />
							{method !== 'ruler' && (
								<button
									className={styles.referenceHandle}
									aria-label='拖动调整参照线'
									disabled={!area.width}
									onKeyDown={event => {
										const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 0.5 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -0.5 : 0
										if (delta) {
											event.preventDefault()
											changePixels(linePixels + delta)
										}
									}}
									onPointerDown={startDrag}
									onPointerMove={moveDrag}
									onPointerUp={() => {
										drag.current = null
									}}
									onPointerCancel={() => {
										drag.current = null
									}}
									onLostPointerCapture={() => {
										drag.current = null
									}}>
									{vertical ? '↕' : '↔'}
								</button>
							)}
						</div>
					</div>
					{(method === 'ruler' || method === 'custom') && (
						<form
							className={styles.customLength}
							onSubmit={e => {
								e.preventDefault()
								submit()
							}}>
							<label htmlFor='measured-mm'>{method === 'custom' ? '实际长度' : '实测长度'}</label>
							<input
								id='measured-mm'
								autoComplete='off'
								type='number'
								inputMode='decimal'
								min='0.1'
								step='any'
								value={answer}
								onChange={e => {
									setAnswer(e.target.value)
									setError('')
								}}
							/>{' '}
							mm
						</form>
					)}
				</>
			)}
			<div className={styles.calibrationActions}>
				{(blocked || error) && (
					<p className={styles.error} role='alert'>
						{zoomed
							? '请恢复双指缩放后继续。'
							: displayChanged
								? '显示比例发生变化，请重新开始校准。'
								: lineDoesNotFit
									? method === 'custom'
										? '当前空间不足，已保留对齐长度。请恢复窗口大小或收起键盘；也可点击重置后重新对齐。'
										: '请收起键盘或恢复屏幕方向，让整段参照线可见。'
									: error}
					</p>
				)}
				{method === 'ruler' && !result && !blocked && !error && <p className={styles.smallNote}>请直接输入实际读数；最后一段仅用于检查，不参与比例计算。</p>}
				<div className={styles.dialogButtons}>
					<button aria-label='重新开始校准' onClick={() => restart()}>
						<RotateCcw size={18} />
					</button>
					<button
						className={styles.primary}
						disabled={
							blocked ||
							(!result && (!area.width || ((method === 'ruler' || method === 'custom') && (!Number.isFinite(Number(answer)) || Number(answer) <= 0))))
						}
						onClick={() => (result ? onSave(result) : submit())}>
						<Check size={18} />
						{result || method === 'custom' ? '保存校准，开始测量' : method !== 'ruler' ? '已对齐，继续' : '确认读数，继续'}
					</button>
				</div>
			</div>
		</>
	)
}
