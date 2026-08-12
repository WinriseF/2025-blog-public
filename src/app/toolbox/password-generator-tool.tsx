'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Check, ChevronDown, Copy, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { INIT_DELAY } from '@/consts'
import {
	DEFAULT_PASSPHRASE_OPTIONS,
	DEFAULT_PIN_OPTIONS,
	DEFAULT_RANDOM_OPTIONS,
	estimatePassphraseEntropy,
	estimatePinEntropy,
	estimateRandomPasswordEntropy,
	generatePassphrase,
	generatePin,
	generateRandomPassword,
	getPasswordStrength,
	loadPassphraseWordlist,
	type CharacterGroupName,
	type PassphraseLanguage,
	type PassphraseResult,
	type PassphraseWord,
	type PasswordMode
} from '@/lib/password-generator'

const modeOptions: Array<{ mode: PasswordMode; label: string }> = [
	{ mode: 'random', label: '随机字符' },
	{ mode: 'passphrase', label: '易记口令' },
	{ mode: 'pin', label: 'PIN' }
]

const characterGroupOptions: Array<{ name: CharacterGroupName; label: string; sample: string }> = [
	{ name: 'uppercase', label: '大写', sample: 'A–Z' },
	{ name: 'lowercase', label: '小写', sample: 'a–z' },
	{ name: 'digits', label: '数字', sample: '0–9' },
	{ name: 'symbols', label: '符号', sample: '!#%&' }
]

const separators = [
	{ value: '-' as const, label: '短横线' },
	{ value: '_' as const, label: '下划线' },
	{ value: '.' as const, label: '句点' },
	{ value: ' ' as const, label: '空格' },
	{ value: '' as const, label: '无' }
]

const springTransition = { type: 'spring', stiffness: 420, damping: 28 } as const
const emptyResult: PassphraseResult = { password: '', hint: '', segments: [] }

type SwitchProps = {
	checked: boolean
	label: string
	disabled?: boolean
	onChange: (checked: boolean) => void
}

function Switch({ checked, label, disabled = false, onChange }: SwitchProps) {
	const shouldReduceMotion = useReducedMotion()

	return (
		<div className={`flex items-center justify-between gap-4 ${disabled ? 'opacity-45' : ''}`}>
			<span className='text-primary font-medium'>{label}</span>
			<motion.button
				type='button'
				role='switch'
				aria-checked={checked}
				aria-label={label}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				whileHover={shouldReduceMotion || disabled ? undefined : { scale: 1.05 }}
				whileTap={shouldReduceMotion || disabled ? undefined : { scale: 0.92 }}
				transition={springTransition}
				className={`relative h-7 w-12 shrink-0 rounded-full border transition ${checked ? 'border-brand/60 bg-brand' : 'border-border bg-background/50'}`}>
				<motion.span
					initial={false}
					animate={{ x: checked ? 20 : 0 }}
					transition={shouldReduceMotion ? { duration: 0 } : springTransition}
					className='absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm'
				/>
			</motion.button>
		</div>
	)
}

function rangeProgress(value: number, min: number, max: number) {
	return `${Math.round(((value - min) / (max - min)) * 100)}%`
}

function messageFromError(error: unknown) {
	return error instanceof Error ? error.message : '生成失败，请调整设置后重试'
}

export function PasswordGeneratorTool() {
	const shouldReduceMotion = useReducedMotion()
	const [mode, setMode] = useState<PasswordMode>('random')
	const [randomOptions, setRandomOptions] = useState(DEFAULT_RANDOM_OPTIONS)
	const [passphraseOptions, setPassphraseOptions] = useState(DEFAULT_PASSPHRASE_OPTIONS)
	const [pinOptions, setPinOptions] = useState(DEFAULT_PIN_OPTIONS)
	const [wordlists, setWordlists] = useState<Partial<Record<PassphraseLanguage, readonly PassphraseWord[]>>>({})
	const [wordlistStatus, setWordlistStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
	const [wordlistRetry, setWordlistRetry] = useState(0)
	const [result, setResult] = useState(emptyResult)
	const [refreshRevision, setRefreshRevision] = useState(0)
	const [generatorError, setGeneratorError] = useState('')
	const [advancedOpen, setAdvancedOpen] = useState(false)

	const activeWordlist = wordlists[passphraseOptions.language]

	useEffect(() => {
		if (mode !== 'passphrase') return

		let active = true
		setWordlistStatus('loading')
		setGeneratorError('')
		loadPassphraseWordlist(passphraseOptions.language)
			.then(wordlist => {
				if (!active) return
				setWordlists(current => ({ ...current, [passphraseOptions.language]: wordlist }))
				setWordlistStatus('ready')
			})
			.catch(error => {
				if (!active) return
				setWordlistStatus('error')
				setGeneratorError(messageFromError(error))
			})

		return () => {
			active = false
		}
	}, [mode, passphraseOptions.language, wordlistRetry])

	const regenerate = useCallback(() => {
		try {
			let next = emptyResult
			if (mode === 'random') next = { ...emptyResult, password: generateRandomPassword(randomOptions) }
			if (mode === 'pin') next = { ...emptyResult, password: generatePin(pinOptions) }
			if (mode === 'passphrase') {
				if (!activeWordlist) return
				next = generatePassphrase(activeWordlist, passphraseOptions)
			}
			setResult(next)
			setGeneratorError('')
		} catch (error) {
			setResult(emptyResult)
			setGeneratorError(messageFromError(error))
		}
	}, [activeWordlist, mode, passphraseOptions, pinOptions, randomOptions])

	const refreshResult = () => {
		regenerate()
		setRefreshRevision(revision => revision + 1)
	}

	useEffect(() => {
		if (mode === 'passphrase' && wordlistStatus !== 'ready') {
			setResult(emptyResult)
			return
		}
		regenerate()
	}, [mode, regenerate, wordlistStatus])

	let entropy = estimatePinEntropy(pinOptions)
	let range = { label: 'PIN 位数', value: pinOptions.length, min: 4, max: 32 }
	if (mode === 'random') {
		entropy = estimateRandomPasswordEntropy(randomOptions)
		range = { label: '密码长度', value: randomOptions.length, min: 8, max: 64 }
	} else if (mode === 'passphrase') {
		entropy = wordlistStatus === 'ready' ? estimatePassphraseEntropy(passphraseOptions) : 0
		range = { label: '口令词数', value: passphraseOptions.wordCount, min: 3, max: 10 }
	}
	const strength = getPasswordStrength(entropy)

	const setRangeValue = (value: number) => {
		if (mode === 'random') setRandomOptions(current => ({ ...current, length: value }))
		if (mode === 'passphrase') setPassphraseOptions(current => ({ ...current, wordCount: value }))
		if (mode === 'pin') setPinOptions(current => ({ ...current, length: value }))
	}

	const changeMode = (nextMode: PasswordMode) => {
		setMode(nextMode)
		setAdvancedOpen(false)
	}

	const toggleCharacterGroup = (name: CharacterGroupName) => {
		const enabledCount = Object.values(randomOptions.groups).filter(Boolean).length
		if (randomOptions.groups[name] && enabledCount === 1) {
			toast.info('至少保留一种字符类型')
			return
		}
		setRandomOptions(current => ({ ...current, groups: { ...current.groups, [name]: !current.groups[name] } }))
	}

	const copyResult = async () => {
		if (!result.password) return
		try {
			await navigator.clipboard.writeText(result.password)
			toast.success('密码已复制')
		} catch {
			toast.error('复制失败，请手动选中复制')
		}
	}

	const passphraseUnavailable = mode === 'passphrase' && wordlistStatus !== 'ready'
	const buttonHover = shouldReduceMotion ? undefined : { scale: 1.035 }
	const buttonTap = shouldReduceMotion ? undefined : { scale: 0.95 }
	const contentTransition = shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' as const }

	return (
		<LayoutGroup id='password-generator'>
			<motion.div
				initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ delay: INIT_DELAY }}
				className='mx-auto flex max-w-5xl flex-col gap-6'>
				<header>
					<h1 className='text-primary text-2xl font-semibold tracking-normal'>随机密码生成器</h1>
					<p className='text-secondary mt-3 text-sm'>在你的设备上生成，不上传服务器</p>
				</header>

				<section className='border-border bg-background/25 overflow-hidden rounded-2xl border'>
					<div className='border-border flex border-b p-2 max-sm:grid max-sm:grid-cols-3'>
						{modeOptions.map(option => (
							<motion.button
								key={option.mode}
								type='button'
								onClick={() => changeMode(option.mode)}
								whileHover={buttonHover}
								whileTap={buttonTap}
								className={`relative min-w-32 rounded-xl border border-transparent px-5 py-3 font-semibold transition-colors max-sm:min-w-0 max-sm:px-2 ${mode === option.mode ? 'text-brand' : 'text-secondary hover:text-primary'}`}>
								{mode === option.mode && (
									<motion.span
										layoutId='mode-active'
										transition={shouldReduceMotion ? { duration: 0 } : springTransition}
										className='border-brand/55 bg-brand/10 absolute inset-0 rounded-xl border'
									/>
								)}
								<span className='relative z-10'>{option.label}</span>
							</motion.button>
						))}
					</div>

					<div className='p-5 max-sm:p-4'>
						<div className='border-border bg-background/35 flex min-h-24 items-center gap-4 rounded-xl border p-4 max-sm:flex-col max-sm:items-stretch'>
							<div className='min-w-0 flex-1'>
								<AnimatePresence mode='wait' initial={false}>
									{wordlistStatus === 'loading' && mode === 'passphrase' ? (
										<motion.div
											key='loading'
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0 }}
											transition={contentTransition}
											className='text-secondary flex items-center gap-2'>
											<LoaderCircle size={17} className='animate-spin' />
											正在加载口令词表…
										</motion.div>
									) : wordlistStatus === 'error' && mode === 'passphrase' ? (
										<motion.div
											key='error'
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0 }}
											transition={contentTransition}
											className='flex flex-wrap items-center gap-3'>
											<span className='text-secondary'>{generatorError || '词表加载失败'}</span>
											<motion.button
												type='button'
												onClick={() => setWordlistRetry(value => value + 1)}
												whileHover={buttonHover}
												whileTap={buttonTap}
												className='text-brand font-semibold'>
												重试
											</motion.button>
										</motion.div>
									) : (
										<motion.div
											key='result'
											initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 7 }}
											animate={{ opacity: 1, y: 0 }}
											exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -5 }}
											transition={contentTransition}
											aria-live='polite'>
											<p className='text-primary font-mono text-xl leading-relaxed font-semibold tracking-wide break-all max-sm:text-lg'>
												{mode === 'passphrase' && passphraseOptions.separator === '' && result.segments.length ? (
													<span className='inline-flex flex-wrap gap-x-2 gap-y-1'>
														{result.segments.map((segment, index) => (
															<span key={index}>{segment}</span>
														))}
													</span>
												) : (
													result.password || '请调整设置'
												)}
											</p>
											{result.hint && (
												<p className='text-secondary/65 mt-2 text-sm leading-relaxed tracking-wide break-words'>
													<span className='mr-2 text-xs font-medium tracking-normal'>记忆提示</span>
													{result.hint}
												</p>
											)}
										</motion.div>
									)}
								</AnimatePresence>
							</div>
							<div className='flex shrink-0 gap-2 max-sm:w-full'>
								<motion.button
									type='button'
									onClick={refreshResult}
									disabled={passphraseUnavailable}
									aria-label='重新生成'
									title='重新生成'
									whileHover={passphraseUnavailable ? undefined : buttonHover}
									whileTap={passphraseUnavailable ? undefined : buttonTap}
									className='border-border bg-background/50 text-primary hover:border-brand/45 flex size-12 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-40'>
									<motion.span
										key={refreshRevision}
										initial={shouldReduceMotion ? false : { rotate: -90 }}
										animate={{ rotate: 0 }}
										transition={springTransition}>
										<RefreshCw size={18} />
									</motion.span>
								</motion.button>
								<motion.button
									type='button'
									onClick={() => void copyResult()}
									disabled={!result.password}
									whileHover={!result.password ? undefined : buttonHover}
									whileTap={!result.password ? undefined : buttonTap}
									className='bg-brand text-background flex h-12 items-center justify-center gap-2 rounded-xl px-5 font-semibold shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 max-sm:flex-1'>
									<Copy size={16} />
									复制密码
								</motion.button>
							</div>
						</div>

						{generatorError && !(mode === 'passphrase' && wordlistStatus === 'error') && <p className='text-secondary mt-3 text-sm'>{generatorError}</p>}

						<div className='mt-5 flex items-center gap-4 max-sm:flex-wrap'>
							<span className='text-primary shrink-0 font-medium'>密码强度</span>
							<div className='flex min-w-40 flex-1 gap-1.5'>
								{[0, 1, 2, 3].map(index => (
									<motion.span
										key={index}
										animate={{ opacity: index < strength.segments ? 1 : 0.45, scaleX: index < strength.segments ? 1 : 0.94 }}
										transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, delay: index * 0.025 }}
										className={`h-2 flex-1 origin-left rounded-full ${index < strength.segments ? 'bg-brand' : 'bg-background/60'}`}
									/>
								))}
							</div>
							<span className='text-brand font-semibold'>{strength.label}</span>
							<span className='text-secondary tabular-nums'>约 {Math.round(strength.bits)} bits</span>
						</div>
					</div>
				</section>

				<section className='border-border bg-background/20 space-y-6 rounded-2xl border p-5 max-sm:p-4'>
					<div>
						<div className='flex items-center justify-between gap-4'>
							<label htmlFor='password-generator-range' className='text-primary font-semibold'>
								{range.label}
							</label>
							<span className='text-primary text-lg font-semibold tabular-nums'>{range.value}</span>
						</div>
						<div className='mt-5 flex items-center gap-5'>
							<input
								id='password-generator-range'
								type='range'
								min={range.min}
								max={range.max}
								value={range.value}
								onChange={event => setRangeValue(Number(event.currentTarget.value))}
								className='range-track'
								style={{ '--range-progress': rangeProgress(range.value, range.min, range.max) } as CSSProperties}
							/>
						</div>
						<div className='text-secondary mt-3 flex justify-between text-xs tabular-nums'>
							<span>{range.min}</span>
							<span>{range.max}</span>
						</div>
					</div>

					<AnimatePresence mode='wait' initial={false}>
						{mode === 'random' && (
							<motion.div
								key='random-options'
								initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0 }}
								transition={contentTransition}>
								<h2 className='text-primary text-sm font-semibold'>字符类型</h2>
								<div className='mt-3 grid grid-cols-4 gap-3 max-sm:grid-cols-2'>
									{characterGroupOptions.map(option => {
										const checked = randomOptions.groups[option.name]
										return (
											<motion.button
												type='button'
												key={option.name}
												aria-pressed={checked}
												onClick={() => toggleCharacterGroup(option.name)}
												whileHover={shouldReduceMotion ? undefined : { y: -2, scale: 1.015 }}
												whileTap={buttonTap}
												transition={springTransition}
												className={`relative flex min-h-20 items-center gap-3 rounded-xl border p-3 text-left transition ${checked ? 'border-brand/45 bg-brand/10' : 'border-border bg-background/30'}`}>
												<span
													className={`flex size-10 items-center justify-center rounded-lg border font-mono text-lg ${checked ? 'border-brand/45 text-brand' : 'border-border text-secondary'}`}>
													{option.sample.charAt(0)}
												</span>
												<span>
													<strong className='text-primary block'>{option.label}</strong>
													<small className='text-secondary mt-1 block'>{option.sample}</small>
												</span>
												<AnimatePresence initial={false}>
													{checked && (
														<motion.span
															initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.5 }}
															animate={{ opacity: 1, scale: 1 }}
															exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.5 }}
															transition={shouldReduceMotion ? { duration: 0 } : springTransition}
															className='text-brand absolute top-2 right-2'>
															<Check size={14} />
														</motion.span>
													)}
												</AnimatePresence>
											</motion.button>
										)
									})}
								</div>
							</motion.div>
						)}

						{mode === 'passphrase' && (
							<motion.div
								key='passphrase-options'
								initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0 }}
								transition={contentTransition}
								className='grid gap-5 md:grid-cols-2'>
								<div>
									<h2 className='text-primary text-sm font-semibold'>词表语言</h2>
									<div className='border-border bg-background/30 mt-3 grid grid-cols-2 rounded-xl border p-1'>
										{(
											[
												['english', 'English'],
												['chinese', '中文拼音']
											] as const
										).map(([language, label]) => (
											<motion.button
												type='button'
												key={language}
												onClick={() => setPassphraseOptions(current => ({ ...current, language }))}
												whileHover={buttonHover}
												whileTap={buttonTap}
												className={`relative rounded-lg px-3 py-2.5 font-semibold transition-colors ${passphraseOptions.language === language ? 'text-brand' : 'text-secondary hover:text-primary'}`}>
												{passphraseOptions.language === language && (
													<motion.span
														layoutId='language-active'
														transition={shouldReduceMotion ? { duration: 0 } : springTransition}
														className='bg-brand/15 absolute inset-0 rounded-lg'
													/>
												)}
												<span className='relative z-10'>{label}</span>
											</motion.button>
										))}
									</div>
								</div>
								<div>
									<h2 className='text-primary text-sm font-semibold'>分隔符</h2>
									<div className='mt-3 grid grid-cols-5 gap-2'>
										{separators.map(separator => (
											<motion.button
												type='button'
												key={separator.label}
												title={separator.label}
												onClick={() => setPassphraseOptions(current => ({ ...current, separator: separator.value }))}
												whileHover={buttonHover}
												whileTap={buttonTap}
												transition={springTransition}
												className={`rounded-xl border px-3 py-2.5 font-mono font-semibold transition ${passphraseOptions.separator === separator.value ? 'border-brand/45 bg-brand/10 text-brand' : 'border-border bg-background/30 text-secondary'}`}>
												{separator.value === ' ' ? '空格' : separator.value || '无'}
											</motion.button>
										))}
									</div>
								</div>
							</motion.div>
						)}
					</AnimatePresence>

					<div className='border-border bg-background/25 grid gap-4 rounded-xl border p-4 md:grid-cols-2'>
						{mode === 'random' && (
							<>
								<Switch
									checked={randomOptions.excludeSimilar}
									label='排除相似字符'
									onChange={checked => setRandomOptions(current => ({ ...current, excludeSimilar: checked }))}
								/>
								<Switch
									checked={randomOptions.avoidConsecutiveRepeat}
									label='避免连续重复'
									onChange={checked => setRandomOptions(current => ({ ...current, avoidConsecutiveRepeat: checked }))}
								/>
							</>
						)}
						{mode === 'pin' && (
							<Switch
								checked={pinOptions.avoidConsecutiveRepeat}
								label='避免连续重复数字'
								onChange={checked => setPinOptions(current => ({ ...current, avoidConsecutiveRepeat: checked }))}
							/>
						)}
						{mode === 'passphrase' && (
							<p className='text-secondary md:col-span-2'>
								{passphraseOptions.language === 'chinese' ? (
									<>
										中文拼音词表来自{' '}
										<a href='https://github.com/cfbao/chinese-diceware' target='_blank' rel='noreferrer' className='text-brand underline underline-offset-4'>
											chinese-diceware
										</a>
										（CC BY 4.0），首次使用时从 jsDelivr 加载并校验完整性。
									</>
								) : (
									'词表只在首次使用口令模式时从 jsDelivr 加载，并在本地校验完整性。'
								)}
							</p>
						)}
					</div>

					{mode !== 'pin' && (
						<div className='border-border bg-background/20 overflow-hidden rounded-xl border'>
							<motion.button
								type='button'
								onClick={() => setAdvancedOpen(open => !open)}
								aria-expanded={advancedOpen}
								whileHover={shouldReduceMotion ? undefined : { y: -1 }}
								whileTap={buttonTap}
								className='text-primary flex w-full items-center justify-between gap-4 px-4 py-3.5 font-semibold'>
								<span>高级设置</span>
								<motion.span
									animate={{ rotate: advancedOpen ? 180 : 0 }}
									transition={shouldReduceMotion ? { duration: 0 } : springTransition}
									className='text-secondary'>
									<ChevronDown size={17} />
								</motion.span>
							</motion.button>
							<AnimatePresence initial={false}>
								{advancedOpen && (
									<motion.div
										initial={shouldReduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
										animate={{ height: 'auto', opacity: 1 }}
										exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
										transition={contentTransition}
										className='overflow-hidden'>
										<div className='border-border border-t p-4'>
											{mode === 'random' ? (
												<label className='block'>
													<span className='text-primary font-medium'>自定义排除字符</span>
													<input
														type='text'
														value={randomOptions.excludedCharacters}
														onChange={event => setRandomOptions(current => ({ ...current, excludedCharacters: event.currentTarget.value }))}
														placeholder='例如：{}[]'
														className='border-border bg-background/35 text-primary placeholder:text-secondary/55 mt-3 h-11 w-full rounded-xl border px-4 font-mono'
													/>
												</label>
											) : (
												<div className='grid gap-4 md:grid-cols-2'>
													<Switch
														checked={passphraseOptions.capitalize}
														label='英文词首字母大写'
														disabled={passphraseOptions.language !== 'english'}
														onChange={checked => setPassphraseOptions(current => ({ ...current, capitalize: checked }))}
													/>
													<Switch
														checked={passphraseOptions.appendDigit}
														label='末尾添加随机数字'
														onChange={checked => setPassphraseOptions(current => ({ ...current, appendDigit: checked }))}
													/>
												</div>
											)}
										</div>
									</motion.div>
								)}
							</AnimatePresence>
						</div>
					)}
				</section>

				<footer className='text-secondary flex items-center gap-2 text-xs'>
					<ShieldCheck size={15} className='text-brand' />
					<span>使用浏览器 Web Crypto 安全随机生成，不保存任何结果</span>
				</footer>
			</motion.div>
		</LayoutGroup>
	)
}
