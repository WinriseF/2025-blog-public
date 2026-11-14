'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Check, X } from 'lucide-react'
import type { RulerReference } from '@/lib/ruler-references'
import type { CalibrationResult } from '@/lib/screen-ruler'
import {
	estimatePhoneScreen,
	phoneScreenDimensions,
	phoneScreenEnvironment,
	phoneScreenLabels,
	type PhoneScreenEnvironment
} from '@/lib/phone-screen-calibration'
import styles from './ruler.module.css'

export function PhoneCalibrationSession({
	reference,
	onSave,
	onBack,
	onClose,
	onManual
}: {
	reference: RulerReference
	onSave: (result: CalibrationResult) => void
	onBack: () => void
	onClose: () => void
	onManual: () => void
}) {
	const screens = (reference.screens || []).filter(screen => screen.kind !== 'rear')
	const [kind, setKind] = useState(screens.length === 1 ? screens[0].kind : '')
	const [environment, setEnvironment] = useState<PhoneScreenEnvironment | null>(null)
	const [saveError, setSaveError] = useState('')
	const selected = screens.find(screen => screen.kind === kind)
	const estimate = selected && environment ? estimatePhoneScreen(selected, environment) : null
	const error = saveError || estimate?.error

	useEffect(() => {
		const update = () => {
			setEnvironment(phoneScreenEnvironment())
			setSaveError('')
		}
		let resolution: MediaQueryList
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

	function save() {
		if (!selected || selected.kind === 'rear') return
		const latest = estimatePhoneScreen(selected, phoneScreenEnvironment())
		if (latest.error) {
			setSaveError(latest.error)
			return
		}
		onSave({
			pxPerMm: latest.pxPerMm,
			method: 'device',
			checkErrorMm: null,
			referenceId: reference.id,
			referenceName: reference.name,
			screenKind: selected.kind
		})
	}

	return (
		<>
			<div className={styles.dialogHeader}>
				<button data-stage-focus aria-label='返回选择手机型号' onClick={onBack}>
					<ArrowLeft size={20} />
				</button>
				<div className={styles.calibrationHeading}>
					<p className={styles.eyebrow}>当前手机 · 按屏幕规格估算</p>
					<h2 id='calibration-title'>{reference.name}</h2>
				</div>
				<button aria-label='关闭校准' onClick={onClose}>
					<X size={20} />
				</button>
			</div>
			<p className={styles.calibrationHint}>请确认这是正在打开此页面的手机。{reference.region.replace(' · 折叠状态', '')}</p>
			{screens.length > 1 && <p className={styles.calibrationHint}>选择当前正在使用的屏幕：</p>}
			<div className={`${styles.referenceOptions} ${styles.deviceScreens}`}>
				{screens.map(screen => (
					<button
						key={screen.kind}
						aria-pressed={kind === screen.kind}
						onClick={() => {
							setKind(screen.kind)
							setSaveError('')
						}}>
						<span>
							{phoneScreenLabels[screen.kind]}
							<small>
								{screen.diagonalInches ? `${screen.diagonalInches} 英寸` : '对角线未明确'}
								{screen.resolutionWidthPx && ` · ${screen.resolutionWidthPx} × ${screen.resolutionHeightPx}`}
								{!phoneScreenDimensions(screen) && ' · 请用实物校准'}
							</small>
						</span>
						{kind === screen.kind && <Check size={18} aria-hidden='true' />}
					</button>
				))}
			</div>
			<p className={styles.calibrationHint}>
				无需拖动对齐，应用后即可测量。型号估算尚未经实物复核，曲面屏或规格舍入可能影响准确度；需要更准时，可再用银行卡等实物校准。
			</p>
			{selected && (
				<div className={styles.referenceDetails}>
					{selected.sources.map((source, i) => (
						<a key={source} href={source} target='_blank' rel='noreferrer'>
							官方屏幕参数{i ? ` ${i + 1}` : ''}
						</a>
					))}
				</div>
			)}
			{error && (
				<p role='alert' className={styles.error}>
					{error}
				</p>
			)}
			<div className={styles.dialogButtons}>
				<button onClick={onManual}>改用实物校准</button>
				<button className={styles.primary} disabled={!estimate?.pxPerMm || Boolean(error)} onClick={save}>
					应用型号，开始测量
				</button>
			</div>
		</>
	)
}
