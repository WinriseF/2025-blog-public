'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, SlidersHorizontal, AlertTriangle, ChevronDown, FileArchive, HardDriveDownload, LoaderCircle, RotateCcw } from 'lucide-react'
import {
	analyzeZipSelection,
	initialZipSelection,
	loadZipDirectory,
	preloadZipRuntime,
	scanZipDirectory,
	scanZipFiles,
	selectedZipEntries,
	suggestedZipName,
	toggleZipSubtree,
	writeZipArchive,
	ZIP_DOWNLOAD_LIMIT,
	type ZipCompressionOptions,
	type ZipOutputFileHandle,
	type ZipScanResult,
	type ZipSelectionState,
	type ZipSkippedEntry,
	type ZipWriteProgress
} from '@/lib/zip-packer'
import { SelectMenu } from '@/components/select-menu'
import { downloadBlob } from '@/lib/download-blob'
import { ZipInput, type ZipPickers } from './zip-input'
import { ZipExtract } from './zip-extract'
import { ZipAction, type ZipFeedback } from './zip-action'
import { ZipFileTree } from './zip-file-tree'

type Phase = 'idle' | 'scanning' | 'ready' | 'preparing' | 'running' | 'done' | 'canceled' | 'error'
type ZipPreset = 'smart' | 'maximum' | 'store' | 'custom'
type ZipPresetOption = ZipCompressionOptions & { value: Exclude<ZipPreset, 'custom'>; label: string }

const PRESETS: ZipPresetOption[] = [
	{ value: 'smart', label: '智能打包', level: 6, skipAlreadyCompressed: true },
	{ value: 'maximum', label: '最大压缩', level: 9, skipAlreadyCompressed: true },
	{ value: 'store', label: '仅打包（不压缩）', level: 0, skipAlreadyCompressed: true }
]

const EMPTY_PROGRESS: ZipWriteProgress = { currentFile: '', processedFiles: 0, skippedFiles: 0, totalFiles: 0, processedBytes: 0, skippedBytes: 0, totalBytes: 0, elapsedMs: 0 }

export function ZipTool() {
	const [phase, setPhase] = useState<Phase>('idle')
	const [scan, setScan] = useState<ZipScanResult | null>(null)
	const [selected, setSelected] = useState<Set<string>>(() => new Set())
	const [preset, setPreset] = useState<ZipPreset>('smart')
	const [compression, setCompression] = useState<ZipCompressionOptions>(() => ({ level: PRESETS[0].level, skipAlreadyCompressed: PRESETS[0].skipAlreadyCompressed }))
	const [includeRoot, setIncludeRoot] = useState(true)
	const [archiveName, setArchiveName] = useState('archive.zip')
	const [mobileView, setMobileView] = useState<'files' | 'settings'>('files')
	const [mode, setMode] = useState<'pack' | 'extract'>('pack')
	const [scanProgress, setScanProgress] = useState({ files: 0, bytes: 0 })
	const [writeProgress, setWriteProgress] = useState<ZipWriteProgress>(EMPTY_PROGRESS)
	const [result, setResult] = useState<{ name: string; outputBytes: number; elapsedMs: number; skippedEntries: ZipSkippedEntry[] } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [canPickDirectory, setCanPickDirectory] = useState(false)
	const [extractBusy, setExtractBusy] = useState(false)
	const [canSave, setCanSave] = useState(false)
	const [loadingDirectoryIds, setLoadingDirectoryIds] = useState<Set<string>>(() => new Set())
	const activeController = useRef<AbortController | null>(null)
	const lazyLoadController = useRef<AbortController | null>(null)
	const lazyLoadQueue = useRef<Promise<void>>(Promise.resolve())
	const lazyLoadTasks = useRef(new Map<string, Promise<void>>())
	const scanRef = useRef<ZipScanResult | null>(null)
	const selectedRef = useRef<Set<string>>(new Set())
	const scanVersion = useRef(0)

	useEffect(() => {
		setCanPickDirectory(typeof (window as ZipPickers).showDirectoryPicker === 'function')
		setCanSave(typeof (window as ZipPickers).showSaveFilePicker === 'function')
	}, [])

	useEffect(() => {
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (phase !== 'running' && phase !== 'scanning' && phase !== 'preparing' && !extractBusy) return
			event.preventDefault()
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', handleBeforeUnload)
		return () => window.removeEventListener('beforeunload', handleBeforeUnload)
	}, [phase, extractBusy])

	useEffect(() => () => {
		activeController.current?.abort()
		lazyLoadController.current?.abort()
	}, [])

	const nodesById = useMemo(() => new Map(scan?.nodes.map(node => [node.id, node]) || []), [scan])
	const selection = useMemo(() => scan ? analyzeZipSelection(scan.nodes, selected) : undefined, [scan, selected])
	const selectionStates = selection?.states || new Map<string, ZipSelectionState>()
	const stats = selection?.stats || { files: 0, bytes: 0 }

	const replaceScan = (nextScan: ZipScanResult | null) => {
		scanRef.current = nextScan
		setScan(nextScan)
	}
	const replaceSelected = (nextSelected: Set<string>) => {
		selectedRef.current = nextSelected
		setSelected(nextSelected)
	}
	const cancelLazyLoads = () => {
		lazyLoadController.current?.abort(new DOMException('用户取消任务', 'AbortError'))
		lazyLoadController.current = null
		lazyLoadTasks.current.clear()
		lazyLoadQueue.current = Promise.resolve()
		setLoadingDirectoryIds(new Set())
	}
	const handleLazyLoadError = (cause: unknown) => {
		if (isAbort(cause)) return
		setError(errorMessage(cause, '无法读取目录'))
		setPhase('error')
	}
	const enqueueDirectoryLoad = (id: string) => {
		const existing = lazyLoadTasks.current.get(id)
		if (existing) return existing
		const version = scanVersion.current
		const controller = lazyLoadController.current || new AbortController()
		lazyLoadController.current = controller
		setLoadingDirectoryIds(current => new Set(current).add(id))
		const task = lazyLoadQueue.current.then(async () => {
			if (controller.signal.aborted || scanVersion.current !== version) return
			const currentScan = scanRef.current
			const node = currentScan?.nodes.find(item => item.id === id)
			if (!currentScan || !node || node.kind !== 'directory' || node.loaded) return
			const knownIds = new Set(currentScan.nodes.map(item => item.id))
			const nextScan = await loadZipDirectory(currentScan, id, controller.signal)
			if (controller.signal.aborted || scanVersion.current !== version) return
			const analysis = analyzeZipSelection(currentScan.nodes, selectedRef.current)
			const nextIds = new Set(nextScan.nodes.map(item => item.id))
			const nextSelected = new Set([...selectedRef.current].filter(item => nextIds.has(item)))
			if (analysis.states.get(id) === 'checked') {
				for (const item of nextScan.nodes) if (!knownIds.has(item.id)) nextSelected.add(item.id)
			}
			replaceScan(nextScan)
			replaceSelected(nextSelected)
		})
		lazyLoadTasks.current.set(id, task)
		lazyLoadQueue.current = task.catch(() => undefined)
		task.then(
			() => finishDirectoryLoad(id, task, version),
			() => finishDirectoryLoad(id, task, version)
		)
		return task
	}
	function finishDirectoryLoad(id: string, task: Promise<void>, version: number) {
		if (lazyLoadTasks.current.get(id) === task) lazyLoadTasks.current.delete(id)
		if (scanVersion.current !== version) return
		setLoadingDirectoryIds(current => {
			if (!current.has(id)) return current
			const next = new Set(current)
			next.delete(id)
			return next
		})
		if (!lazyLoadTasks.current.size && lazyLoadController.current !== activeController.current) lazyLoadController.current = null
	}
	const hydrateSelectedDirectories = async () => {
		while (true) {
			const currentScan = scanRef.current
			if (!currentScan) return
			const analysis = analyzeZipSelection(currentScan.nodes, selectedRef.current)
			const nextDirectory = currentScan.nodes.find(node => node.kind === 'directory' && !node.loaded && analysis.states.get(node.id) === 'checked')
			if (!nextDirectory) return
			await enqueueDirectoryLoad(nextDirectory.id)
		}
	}
	const toggleSelection = (id: string, checked: boolean) => {
		const nextSelected = toggleZipSubtree(nodesById, selectedRef.current, id, checked)
		replaceSelected(nextSelected)
		if (checked && nodesById.get(id)?.kind === 'directory') void hydrateSelectedDirectories().catch(handleLazyLoadError)
	}
	const selectAll = () => {
		const currentScan = scanRef.current
		if (!currentScan) return
		replaceSelected(new Set(currentScan.nodes.map(node => node.id)))
		void hydrateSelectedDirectories().catch(handleLazyLoadError)
	}
	const restoreSuggestions = () => {
		const currentScan = scanRef.current
		if (currentScan) replaceSelected(initialZipSelection(currentScan.nodes))
	}
	const loadDirectory = (id: string) => void enqueueDirectoryLoad(id).catch(handleLazyLoadError)

	const installScan = (nextScan: ZipScanResult, keepRoot: boolean) => {
		cancelLazyLoads()
		scanVersion.current += 1
		replaceScan(nextScan)
		replaceSelected(initialZipSelection(nextScan.nodes))
		setArchiveName(suggestedZipName(nextScan.rootName))
		setIncludeRoot(keepRoot)
		setMobileView('files')
		setError(null)
		setResult(null)
		setPhase('ready')
		preloadZipRuntime()
	}

	const chooseDirectory = async () => {
		const picker = (window as ZipPickers).showDirectoryPicker
		if (!picker) return
		let controller: AbortController | undefined
		try {
			const directory = await picker.call(window, { id: 'zip-source', mode: 'read' })
			const scanController = new AbortController()
			controller = scanController
			activeController.current = scanController
			setScanProgress({ files: 0, bytes: 0 })
			setError(null)
			setPhase('scanning')
			const nextScan = await scanZipDirectory(directory, scanController.signal, (files, bytes) => setScanProgress({ files, bytes }))
			installScan(nextScan, true)
		} catch (cause) {
			if (isAbort(cause)) {
				setPhase('idle')
				return
			}
			setError(errorMessage(cause, '无法读取所选目录'))
			setPhase('error')
		} finally {
			if (activeController.current === controller) activeController.current = null
		}
	}

	const chooseFiles = (files: File[]) => {
		if (!files?.length) return
		installScan(scanZipFiles(files), false)
	}

	const startWriting = async () => {
		const currentScan = scanRef.current
		const currentStats = currentScan ? analyzeZipSelection(currentScan.nodes, selectedRef.current).stats : undefined
		if (!currentScan || !currentStats?.files || loadingDirectoryIds.size || lazyLoadTasks.current.size) return
		const picker = (window as ZipPickers).showSaveFilePicker
		if (!picker && currentStats.bytes > ZIP_DOWNLOAD_LIMIT) return
		const finalName = suggestedZipName(archiveName.replace(/\.zip$/i, ''))

		let outputHandle: ZipOutputFileHandle | undefined
		try {
			outputHandle = await picker?.call(window, {
				suggestedName: finalName,
				types: [{ description: 'ZIP 压缩文件', accept: { 'application/zip': ['.zip'] } }]
			})
		} catch (cause) {
			if (isAbort(cause)) return
			setError(errorMessage(cause, '无法选择保存位置'))
			setPhase('error')
			return
		}

		const controller = new AbortController()
		activeController.current = controller
		lazyLoadController.current = controller
		setScanProgress({ files: 0, bytes: 0 })
		setError(null)
		setMobileView('settings')
		setPhase('preparing')
		try {
			await hydrateSelectedDirectories()
			const preparedScan = scanRef.current
			if (!preparedScan) throw new Error('来源目录已被重置')
			const preparedSelection = analyzeZipSelection(preparedScan.nodes, selectedRef.current)
			const selectedEntryIds = selectedZipEntries(preparedScan.nodes, preparedSelection.states)
			if (!preparedSelection.stats.files) throw new Error('请至少选择一个文件')
			setWriteProgress({ ...EMPTY_PROGRESS, totalFiles: preparedSelection.stats.files, totalBytes: preparedSelection.stats.bytes })
			setPhase('running')
			const output = await writeZipArchive({ scan: preparedScan, selectedIds: selectedEntryIds, compression, includeRoot, outputHandle, signal: controller.signal, onProgress: setWriteProgress })
			if (output.blob) downloadBlob(output.blob, finalName)
			setResult({ name: outputHandle?.name ?? finalName, outputBytes: output.outputBytes, elapsedMs: output.elapsedMs, skippedEntries: [...preparedScan.skippedEntries, ...output.skippedEntries] })
			setPhase('done')
		} catch (cause) {
			if (isAbort(cause)) {
				setPhase('canceled')
				return
			}
			setError(errorMessage(cause, 'ZIP 打包失败'))
			setPhase('error')
		} finally {
			if (lazyLoadController.current === controller) lazyLoadController.current = null
			if (activeController.current === controller) activeController.current = null
		}
	}

	const reset = () => {
		activeController.current?.abort(new DOMException('用户取消任务', 'AbortError'))
		activeController.current = null
		cancelLazyLoads()
		scanVersion.current += 1
		setPhase('idle')
		replaceScan(null)
		replaceSelected(new Set())
		setWriteProgress(EMPTY_PROGRESS)
		setScanProgress({ files: 0, bytes: 0 })
		setResult(null)
		setError(null)
	}

	const cancel = () => activeController.current?.abort(new DOMException('用户取消任务', 'AbortError'))
	const handledBytes = writeProgress.processedBytes + writeProgress.skippedBytes
	const handledFiles = writeProgress.processedFiles + writeProgress.skippedFiles
	const progressPercent = writeProgress.totalBytes ? handledBytes / writeProgress.totalBytes * 100 : handledFiles / Math.max(1, writeProgress.totalFiles) * 100
	const speed = writeProgress.elapsedMs > 0 ? writeProgress.processedBytes / (writeProgress.elapsedMs / 1000) : 0
	const remaining = speed > 0 ? Math.max(0, writeProgress.totalBytes - handledBytes) / speed : null
	const packing = phase === 'running' || phase === 'preparing'
	const locked = packing || phase === 'done'
	let packFeedback: ZipFeedback | undefined
	if (phase === 'preparing') packFeedback = { state: 'working', title: '正在准备' }
	if (phase === 'running') packFeedback = { state: 'working', title: '正在打包', percent: progressPercent, detail: `${handledFiles} / ${writeProgress.totalFiles} 个文件 · ${writeProgress.currentFile}` }
	if (phase === 'done' && result) packFeedback = { state: 'done', title: canSave ? 'ZIP 已保存' : 'ZIP 已生成', detail: `${result.name} · ${formatBytes(result.outputBytes)} · ${formatDuration(result.elapsedMs / 1000)}` }
	if (phase === 'canceled') packFeedback = { state: 'canceled', title: '打包已取消' }
	if (phase === 'error') packFeedback = { state: 'error', title: error || '打包失败' }
	const choosePreset = (value: ZipPreset) => {
		const option = PRESETS.find(item => item.value === value)
		if (!option) return
		setPreset(value)
		setCompression({ level: option.level, skipAlreadyCompressed: option.skipAlreadyCompressed })
	}
	const updateCompression = (update: Partial<ZipCompressionOptions>) => {
		setPreset('custom')
		setCompression(current => ({ ...current, ...update }))
	}

	return (
		<div className='mx-auto max-w-6xl text-sm max-sm:px-4'>
			<header className='mb-7 flex flex-wrap items-center justify-between gap-4'>
				<div className='flex items-center gap-3'>
					<span className='flex size-12 shrink-0 items-center justify-center rounded-2xl border border-brand/20 bg-brand/10 text-brand'><FileArchive size={25} /></span>
					<div>
						<h1 className='text-2xl font-semibold tracking-normal text-primary'>压缩包工具</h1>
						<p className='mt-1 text-sm text-secondary'>在本机创建和解压 ZIP 文件</p>
					</div>
				</div>
				<div role='group' aria-label='压缩包操作' className='inline-flex items-center gap-1 rounded-xl border border-border bg-background/35 p-1 max-sm:w-full'>
					{(['pack', 'extract'] as const).map(value => <button key={value} type='button' aria-pressed={mode === value}
						disabled={extractBusy || ['preparing', 'running', 'scanning'].includes(phase)}
						onClick={() => setMode(value)} className={'flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border px-5 font-semibold transition ' + (mode === value ? 'border-brand/30 bg-brand/10 text-brand shadow-sm' : 'border-transparent text-secondary hover:bg-article hover:text-primary')}>
						{value === 'pack' ? <Archive size={16} /> : <ArchiveRestore size={16} />}{value === 'pack' ? '打包' : '解压'}
					</button>)}
				</div>
			</header>

			{mode === 'extract' ? <ZipExtract canPickDirectory={canPickDirectory} busy={extractBusy} setBusy={setExtractBusy} /> : <>
			{phase === 'idle' && <ZipInput onFiles={chooseFiles} onDirectory={canPickDirectory ? chooseDirectory : undefined} />}

			{phase === 'scanning' && (
				<section className='flex min-h-80 flex-col items-center justify-center rounded-2xl border border-border bg-background/20 p-8 text-center'>
					<LoaderCircle size={34} className='text-brand animate-spin' />
					<h2 className='mt-5 font-semibold text-primary'>正在分析目录</h2>
					<p className='text-secondary mt-2'>{`${scanProgress.files.toLocaleString('zh-CN')} 个文件 · ${formatBytes(scanProgress.bytes)}`}</p>
					<button type='button' onClick={cancel} className='mt-6 rounded-xl border border-border px-4 py-2.5 text-secondary transition hover:text-primary'>取消读取</button>
				</section>
			)}

			{scan && (
				<div className='grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]'>
					<div inert={locked} className={mobileView === 'settings' ? 'min-w-0 max-lg:hidden' : 'min-w-0'}>
						<ZipFileTree
							key={scanVersion.current}
							scan={scan}
							title='选择打包内容'
							states={selectionStates}
							loadingDirectoryIds={loadingDirectoryIds}
							onToggle={toggleSelection}
							onSelectAll={selectAll}
							onRestoreSuggestions={restoreSuggestions}
							onLoadDirectory={loadDirectory}
						/>
						<div className='mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-article/65 px-4 py-3 lg:hidden'>
							<span className='text-secondary'>已选 {stats.files} 个文件</span>
							<button type='button' onClick={() => setMobileView('settings')} className='flex items-center gap-2 rounded-lg bg-brand px-4 py-2 font-semibold text-background'>打包设置 <ArrowRight size={15} /></button>
						</div>
					</div>

					<aside className={'space-y-4 ' + (mobileView === 'files' ? 'max-lg:hidden' : '')}>
						<button type='button' disabled={packing} onClick={() => setMobileView('files')} className='flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-secondary lg:hidden'><ArrowLeft size={15} />返回文件筛选</button>
						<section inert={locked} className='rounded-2xl border border-border bg-background/20 p-5'>
							<h2 className='mb-4 flex items-center gap-2 font-semibold text-primary'><SlidersHorizontal size={17} className='text-brand' />打包设置</h2>
							<SelectMenu<ZipPreset> ariaLabel='压缩方案' label='压缩方案' value={preset}
								options={preset === 'custom' ? [...PRESETS, { value: 'custom', label: '自定义' }] : PRESETS}
								onChange={choosePreset} />
							<details className='group mt-5 border-t border-border pt-4'>
								<summary className='flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-primary'><span>高级设置</span><ChevronDown size={16} className='text-secondary transition group-open:rotate-180' /></summary>
								<div className='mt-4 space-y-4'>
									<div>
										<div className='flex items-center justify-between gap-3'><label htmlFor='zip-compression-level' className='font-medium text-primary'>压缩等级</label><span className='rounded-full border border-border bg-background/35 px-2 py-0.5 text-xs text-secondary'>{compression.level} · {compressionLevelLabel(compression.level)}</span></div>
										<input id='zip-compression-level' type='range' min='0' max='9' step='1' value={compression.level} onChange={event => updateCompression({ level: Number(event.target.value) })} className='mt-4 w-full accent-[var(--color-brand)]' />
										<div className='mt-1 flex justify-between text-[10px] text-secondary'><span>0 · 仅打包</span><span>6 · 平衡</span><span>9 · 最大</span></div>
										<p className='mt-2 text-xs leading-5 text-secondary'>{compressionLevelDescription(compression.level)}</p>
									</div>
									<label className={`flex gap-3 rounded-xl border p-3 ${compression.level === 0 ? 'cursor-not-allowed border-border/70 bg-background/15 opacity-65' : 'cursor-pointer border-border bg-background/25'}`}>
										<input type='checkbox' checked={compression.skipAlreadyCompressed} disabled={compression.level === 0} onChange={event => updateCompression({ skipAlreadyCompressed: event.target.checked })} className='mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]' />
										<span><span className='font-medium text-primary'>跳过已压缩文件</span><span className='mt-1 block text-xs leading-5 text-secondary'>{compression.level === 0 ? '仅打包时不会压缩任何文件。' : '图片、视频和已有压缩包直接存储，通常更快也更合理。'}</span></span>
									</label>
								</div>
							</details>
						</section>

						<section inert={locked} className='rounded-2xl border border-border bg-background/20 p-5'>
							<label htmlFor='zip-name' className='block text-xs font-medium text-secondary'>输出文件名</label>
							<input id='zip-name' value={archiveName} onChange={event => setArchiveName(event.target.value)} className='mt-2 h-11 w-full rounded-xl border border-border bg-background/35 px-3 text-primary outline-none focus:border-brand/55' />
							{scan.rootId && (
								<label className='mt-4 flex cursor-pointer items-center gap-2 text-sm text-primary'>
									<input type='checkbox' checked={includeRoot} onChange={event => setIncludeRoot(event.target.checked)} className='size-4 accent-[var(--color-brand)]' />
									保留最外层目录
								</label>
							)}
						</section>

						<section className='rounded-2xl border border-border bg-background/20 p-5'>
							<dl className='grid grid-cols-2 gap-3'>
								<div className='rounded-xl border border-border bg-background/30 p-3'><dt className='text-xs text-secondary'>已选文件</dt><dd className='mt-1 text-lg font-semibold tabular-nums text-primary'>{stats.files.toLocaleString('zh-CN')}</dd></div>
								<div className='rounded-xl border border-border bg-background/30 p-3'><dt className='text-xs text-secondary'>输入大小</dt><dd className='mt-1 text-lg font-semibold tabular-nums text-primary'>{formatBytes(stats.bytes)}</dd></div>
							</dl>
							{scan.unloadedDirectories > 0 && <p className='text-secondary mt-3 text-xs leading-5'>另有 {scan.unloadedDirectories.toLocaleString('zh-CN')} 个建议排除目录会在展开或勾选时读取。</p>}
							{scan.skippedEntries.length > 0 && <p className='mt-3 text-xs leading-5 text-amber-700 dark:text-amber-300'>扫描时已自动跳过 {scan.skippedEntries.length.toLocaleString('zh-CN')} 个无法读取的条目。</p>}
							{!canSave && stats.bytes > ZIP_DOWNLOAD_LIMIT && <p role='alert' className='mt-3 text-secondary'>普通下载最多支持 64 MiB，请减少所选文件或使用支持直接写盘的浏览器。</p>}
							<div className='mt-4'>
								<ZipAction label='生成 ZIP' icon={HardDriveDownload} feedback={packFeedback} disabled={locked || !stats.files || (!canSave && stats.bytes > ZIP_DOWNLOAD_LIMIT) || loadingDirectoryIds.size > 0} onClick={() => void startWriting()} />
							</div>
							{phase === 'running' && <p className='mt-1 text-xs text-secondary'>{formatBytes(handledBytes)} / {formatBytes(writeProgress.totalBytes)}{speed > 0 && ` · ${formatBytes(speed)}/s`}{remaining !== null && ` · 剩余 ${formatDuration(remaining)}`}{writeProgress.skippedFiles > 0 && ` · 跳过 ${writeProgress.skippedFiles} 个`}</p>}
							{phase === 'done' && result && result.skippedEntries.length > 0 && <details className='mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs'>
								<summary className='cursor-pointer'>已跳过 {result.skippedEntries.length} 个无法读取的条目</summary>
								<ul className='mt-2 max-h-40 overflow-auto break-all text-secondary'>{result.skippedEntries.map((entry, index) => <li key={index}>{entry.path} · {entry.reason}</li>)}</ul>
							</details>}
							<button type='button' onClick={packing ? cancel : reset} className='mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-secondary transition hover:text-primary'>{!packing && <RotateCcw size={15} />}{packing ? '取消打包' : '重新选择来源'}</button>
						</section>
					</aside>
				</div>
			)}

			{!scan && phase === 'error' && <section role='alert' className='rounded-xl border border-border p-5'>
				<p className='flex items-center gap-2'><AlertTriangle size={17} />{error}</p>
				<button type='button' onClick={reset} className='mt-3 rounded-lg border border-border px-3 py-2'>重新选择来源</button>
			</section>}

			</>}
		</div>
	)
}

function isAbort(cause: unknown) {
	return cause instanceof DOMException && cause.name === 'AbortError'
}

function errorMessage(cause: unknown, fallback: string) {
	if (cause instanceof DOMException && cause.name === 'NotAllowedError') return '没有获得文件访问权限'
	if (cause instanceof DOMException && cause.name === 'QuotaExceededError') return '本地磁盘或浏览器存储空间不足'
	return cause instanceof Error ? cause.message : fallback
}

function compressionLevelLabel(level: number) {
	if (level === 0) return '仅打包'
	if (level <= 2) return '速度优先'
	if (level <= 5) return '快速压缩'
	if (level <= 7) return '平衡'
	return '体积优先'
}

function compressionLevelDescription(level: number) {
	if (level === 0) return '不压缩内容，只把文件封装为 ZIP，速度最快。'
	if (level <= 2) return '轻度压缩，适合更在意处理速度的场景。'
	if (level <= 5) return '在处理速度和体积之间偏向速度。'
	if (level <= 7) return '处理速度与压缩效果相对均衡，适合作为默认值。'
	return '更积极地压缩可压缩内容，处理时间会明显增加。'
}

function formatBytes(bytes: number) {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
	if (bytes < 1024) return `${bytes.toFixed(0)} B`
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatDuration(seconds: number) {
	const whole = Math.max(0, Math.round(seconds))
	const hours = Math.floor(whole / 3600)
	const minutes = Math.floor((whole % 3600) / 60)
	const remaining = whole % 60
	return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}` : `${minutes}:${String(remaining).padStart(2, '0')}`
}
