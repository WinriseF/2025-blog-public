'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, FileArchive, FilePlus2, FolderInput, HardDriveDownload, LoaderCircle, RotateCcw, ShieldCheck, Square } from 'lucide-react'
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
	type ZipCompressionOptions,
	type ZipScanResult,
	type ZipSelectionState,
	type ZipWriteProgress
} from '@/lib/zip-packer'
import { ZipFileTree } from './zip-file-tree'

type Phase = 'idle' | 'scanning' | 'ready' | 'preparing' | 'running' | 'done' | 'canceled' | 'error'
type MobileView = 'files' | 'plan'
type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
type SaveFilePicker = (options?: { suggestedName?: string; types?: Array<{ description?: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle>
type ZipPreset = 'smart' | 'maximum' | 'store' | 'custom'
type ZipPresetOption = ZipCompressionOptions & { id: Exclude<ZipPreset, 'custom'>; label: string; description: string }

const PRESETS: ZipPresetOption[] = [
	{ id: 'smart', label: '智能打包', description: '等级 6，跳过图片、视频和压缩包。', level: 6, skipAlreadyCompressed: true },
	{ id: 'maximum', label: '最大压缩', description: '等级 9，仍跳过已压缩文件。', level: 9, skipAlreadyCompressed: true },
	{ id: 'store', label: '仅打包（不压缩）', description: '等级 0，不压缩任何文件。', level: 0, skipAlreadyCompressed: true }
]

const EMPTY_PROGRESS: ZipWriteProgress = { currentFile: '', processedFiles: 0, totalFiles: 0, processedBytes: 0, totalBytes: 0, elapsedMs: 0 }

export function ZipTool() {
	const [phase, setPhase] = useState<Phase>('idle')
	const [scan, setScan] = useState<ZipScanResult | null>(null)
	const [selected, setSelected] = useState<Set<string>>(() => new Set())
	const [preset, setPreset] = useState<ZipPreset>('smart')
	const [compression, setCompression] = useState<ZipCompressionOptions>(() => ({ level: PRESETS[0].level, skipAlreadyCompressed: PRESETS[0].skipAlreadyCompressed }))
	const [includeRoot, setIncludeRoot] = useState(true)
	const [archiveName, setArchiveName] = useState('archive.zip')
	const [mobileView, setMobileView] = useState<MobileView>('files')
	const [scanProgress, setScanProgress] = useState({ files: 0, bytes: 0 })
	const [writeProgress, setWriteProgress] = useState<ZipWriteProgress>(EMPTY_PROGRESS)
	const [result, setResult] = useState<{ name: string; outputBytes: number; elapsedMs: number } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [supported, setSupported] = useState(true)
	const [loadingDirectoryIds, setLoadingDirectoryIds] = useState<Set<string>>(() => new Set())
	const activeController = useRef<AbortController | null>(null)
	const lazyLoadController = useRef<AbortController | null>(null)
	const lazyLoadQueue = useRef<Promise<void>>(Promise.resolve())
	const lazyLoadTasks = useRef(new Map<string, Promise<void>>())
	const scanRef = useRef<ZipScanResult | null>(null)
	const selectedRef = useRef<Set<string>>(new Set())
	const scanVersion = useRef(0)

	useEffect(() => {
		setSupported(window.isSecureContext && 'showDirectoryPicker' in window && 'showSaveFilePicker' in window)
	}, [])

	useEffect(() => {
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (phase !== 'running' && phase !== 'scanning' && phase !== 'preparing') return
			event.preventDefault()
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', handleBeforeUnload)
		return () => window.removeEventListener('beforeunload', handleBeforeUnload)
	}, [phase])

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
			let nextSelected = selectedRef.current
			if (analysis.states.get(id) === 'checked') {
				nextSelected = new Set(selectedRef.current)
				for (const item of nextScan.nodes) if (!knownIds.has(item.id)) nextSelected.add(item.id)
			}
			replaceScan(nextScan)
			if (nextSelected !== selectedRef.current) replaceSelected(nextSelected)
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
		const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
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

	const chooseFiles = (files: FileList | null) => {
		if (!files?.length) return
		installScan(scanZipFiles([...files]), false)
	}

	const startWriting = async () => {
		const currentScan = scanRef.current
		const currentStats = currentScan ? analyzeZipSelection(currentScan.nodes, selectedRef.current).stats : undefined
		if (!currentScan || !currentStats?.files || loadingDirectoryIds.size || lazyLoadTasks.current.size) return
		const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
		if (!picker) return
		const finalName = suggestedZipName(archiveName.replace(/\.zip$/i, ''))

		let outputHandle: FileSystemFileHandle
		try {
			outputHandle = await picker.call(window, {
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
			setResult({ name: outputHandle.name, ...output })
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
	const progressPercent = writeProgress.totalBytes ? Math.min(100, writeProgress.processedBytes / writeProgress.totalBytes * 100) : 0
	const speed = writeProgress.elapsedMs > 0 ? writeProgress.processedBytes / (writeProgress.elapsedMs / 1000) : 0
	const remaining = speed > 0 ? (writeProgress.totalBytes - writeProgress.processedBytes) / speed : null
	const choosePreset = (option: ZipPresetOption) => {
		setPreset(option.id)
		setCompression({ level: option.level, skipAlreadyCompressed: option.skipAlreadyCompressed })
	}
	const updateCompression = (update: Partial<ZipCompressionOptions>) => {
		setPreset('custom')
		setCompression(current => ({ ...current, ...update }))
	}

	return (
		<div className='mx-auto max-w-6xl text-sm max-sm:px-4'>
			<header className='mb-8'>
				<div className='flex flex-wrap items-center gap-3'>
					<div className='bg-brand/10 text-brand flex size-11 items-center justify-center rounded-xl'><FileArchive size={22} /></div>
					<div>
						<h1 className='text-2xl font-semibold tracking-normal text-primary'>ZIP 打包器</h1>
						<p className='text-secondary mt-1 text-sm'>筛选目录内容，在浏览器本地流式生成 ZIP</p>
					</div>
					<span className='ml-auto rounded-full border border-border bg-background/30 px-3 py-1 text-xs text-secondary'>Chrome / Edge</span>
				</div>
			</header>

			{!supported && (
				<div className='mb-6 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 p-4 text-amber-700 dark:text-amber-300'>
					<AlertTriangle size={19} className='mt-0.5 shrink-0' />
					<div><p className='font-semibold'>当前浏览器不能直接保存大型 ZIP</p><p className='mt-1 text-sm opacity-85'>请在 HTTPS 环境中使用最新版桌面 Chrome 或 Edge。</p></div>
				</div>
			)}

			{phase === 'idle' && (
				<section className='rounded-2xl border border-dashed border-brand/30 bg-background/20 p-6 sm:p-10'>
					<div className='mx-auto max-w-2xl text-center'>
						<h2 className='text-lg font-semibold text-primary'>选择要打包的内容</h2>
						<p className='text-secondary mt-2'>文件只在当前浏览器中读取，不会上传服务器。</p>
						<div className='mt-7 grid gap-4 sm:grid-cols-2'>
							<button type='button' disabled={!supported} onClick={() => void chooseDirectory()} className='group rounded-2xl border border-border bg-background/30 p-6 text-left transition hover:border-brand/45 hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50'>
								<FolderInput size={25} className='text-brand' />
								<p className='mt-4 font-semibold text-primary'>选择文件夹</p>
								<p className='text-secondary mt-2 text-xs leading-5'>递归读取完整目录，支持树形筛选与建议排除。</p>
							</button>
							<label className={`group rounded-2xl border border-border bg-background/30 p-6 text-left transition ${supported ? 'cursor-pointer hover:border-brand/45 hover:bg-brand/5' : 'cursor-not-allowed opacity-50'}`}>
								<input type='file' multiple disabled={!supported} className='hidden' onClick={event => (event.currentTarget.value = '')} onChange={event => chooseFiles(event.target.files)} />
								<FilePlus2 size={25} className='text-brand' />
								<p className='mt-4 font-semibold text-primary'>选择多个文件</p>
								<p className='text-secondary mt-2 text-xs leading-5'>直接把多个本地文件打包成一个 ZIP。</p>
							</label>
						</div>
					</div>
				</section>
			)}

			{(phase === 'scanning' || phase === 'preparing') && (
				<section className='flex min-h-80 flex-col items-center justify-center rounded-2xl border border-border bg-background/20 p-8 text-center'>
					<LoaderCircle size={34} className='text-brand animate-spin' />
					<h2 className='mt-5 font-semibold text-primary'>{phase === 'preparing' ? '正在读取已选目录' : '正在分析目录'}</h2>
					<p className='text-secondary mt-2'>{phase === 'preparing' ? '正在补齐按需读取的内容…' : `${scanProgress.files.toLocaleString('zh-CN')} 个文件 · ${formatBytes(scanProgress.bytes)}`}</p>
					<button type='button' onClick={cancel} className='mt-6 rounded-xl border border-border px-4 py-2.5 text-secondary transition hover:text-primary'>{phase === 'preparing' ? '取消准备' : '取消读取'}</button>
				</section>
			)}

			{phase === 'ready' && scan && (
				<div className='grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]'>
					<div className={mobileView === 'files' ? '' : 'max-lg:hidden'}>
						<ZipFileTree
							key={scanVersion.current}
							scan={scan}
							selected={selected}
							states={selectionStates}
							loadingDirectoryIds={loadingDirectoryIds}
							onToggle={toggleSelection}
							onSelectAll={selectAll}
							onRestoreSuggestions={restoreSuggestions}
							onLoadDirectory={loadDirectory}
							onContinue={() => setMobileView('plan')}
						/>
					</div>

					<aside className={`space-y-4 ${mobileView === 'plan' ? '' : 'max-lg:hidden'}`}>
						<button type='button' onClick={() => setMobileView('files')} className='flex items-center gap-2 text-secondary lg:hidden'><ArrowLeft size={16} />返回文件筛选</button>
						<section className='rounded-2xl border border-border bg-background/20 p-5'>
							<h2 className='font-semibold text-primary'>ZIP 方案</h2>
							<div className='mt-4 space-y-2'>
								{PRESETS.map(option => (
									<button key={option.id} type='button' onClick={() => choosePreset(option)} className={`w-full rounded-xl border p-3 text-left transition ${preset === option.id ? 'border-brand bg-brand/8' : 'border-border bg-background/25 hover:border-brand/35'}`}>
										<p className='font-semibold text-primary'>{option.label}{option.id === 'smart' && <span className='text-brand ml-2 text-[10px]'>推荐</span>}</p>
										<p className='text-secondary mt-1 text-xs leading-5'>{option.description}</p>
									</button>
								))}
							</div>
							{preset === 'custom' && <div className='mt-3 rounded-xl border border-brand/35 bg-brand/5 px-3 py-2 text-xs'><p className='font-medium text-primary'>当前：自定义方案</p><p className='mt-1 text-secondary'>等级 {compression.level} · {compressionLevelLabel(compression.level)}{compression.level > 0 && ` · ${compression.skipAlreadyCompressed ? '跳过已压缩文件' : '全部尝试压缩'}`}</p></div>}
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

						<section className='rounded-2xl border border-border bg-background/20 p-5'>
							<label className='block text-xs font-medium text-secondary'>输出文件名</label>
							<input value={archiveName} onChange={event => setArchiveName(event.target.value)} className='mt-2 h-11 w-full rounded-xl border border-border bg-background/35 px-3 text-primary outline-none focus:border-brand/55' />
							{scan.rootId && (
								<label className='mt-4 flex cursor-pointer items-center gap-2 text-sm text-primary'>
									<input type='checkbox' checked={includeRoot} onChange={event => setIncludeRoot(event.target.checked)} className='size-4 accent-[var(--color-brand)]' />
									保留最外层目录
								</label>
							)}
						</section>

						<section className='rounded-2xl border border-border bg-background/20 p-5'>
							<div className='grid grid-cols-2 gap-3'>
								<Stat label='已选文件' value={stats.files.toLocaleString('zh-CN')} />
								<Stat label='输入大小' value={formatBytes(stats.bytes)} />
								<Stat label={scan.unloadedDirectories ? '已扫描排除' : '已排除'} value={formatBytes(Math.max(0, scan.totalBytes - stats.bytes))} />
								<Stat label='格式' value={stats.bytes >= 4 * 1024 ** 3 || stats.files > 65535 ? 'ZIP64' : 'ZIP'} />
							</div>
							{scan.unloadedDirectories > 0 && <p className='text-secondary mt-3 text-xs leading-5'>另有 {scan.unloadedDirectories.toLocaleString('zh-CN')} 个建议排除目录会在展开或勾选时读取。</p>}
							<button type='button' disabled={!stats.files || !supported || loadingDirectoryIds.size > 0} onClick={() => void startWriting()} className='bg-brand mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-border disabled:text-secondary'>
								<HardDriveDownload size={17} />选择位置并开始
							</button>
							<button type='button' onClick={reset} className='mt-3 w-full rounded-xl border border-border px-4 py-3 text-secondary transition hover:text-primary'>重新选择来源</button>
						</section>
					</aside>
				</div>
			)}

			{phase === 'running' && (
				<section className='rounded-2xl border border-border bg-background/20 p-6 sm:p-8'>
					<div className='flex items-start justify-between gap-4'>
						<div><p className='font-semibold text-primary'>正在生成 ZIP</p><p className='text-secondary mt-2 break-all text-xs'>{writeProgress.currentFile || '正在准备文件…'}</p></div>
						<span className='text-xl font-semibold text-primary'>{Math.round(progressPercent)}%</span>
					</div>
					<div className='mt-6 h-2.5 overflow-hidden rounded-full bg-border/60'><div className='bg-brand h-full rounded-full transition-[width] duration-200' style={{ width: `${progressPercent}%` }} /></div>
					<div className='text-secondary mt-5 grid gap-3 text-xs sm:grid-cols-4'>
						<span>{writeProgress.processedFiles} / {writeProgress.totalFiles} 个文件</span>
						<span>{formatBytes(writeProgress.processedBytes)} / {formatBytes(writeProgress.totalBytes)}</span>
						<span>{speed ? `${formatBytes(speed)}/s` : '正在计算速度'}</span>
						<span>剩余 {remaining === null ? '计算中' : formatDuration(remaining)}</span>
					</div>
					<button type='button' onClick={cancel} className='mt-7 flex items-center gap-2 rounded-xl border border-border px-5 py-3 font-medium text-primary'><Square size={15} />取消打包</button>
				</section>
			)}

			{phase === 'done' && result && (
				<ResultPanel icon={<CheckCircle2 size={34} className='text-emerald-500' />} title='ZIP 已保存' description={`${result.name} · ${formatBytes(result.outputBytes)} · ${formatDuration(result.elapsedMs / 1000)}`} onReset={reset} />
			)}

			{phase === 'canceled' && <ResultPanel icon={<Square size={30} className='text-secondary' />} title='任务已取消' description='未完成的输出已放弃，可以重新选择内容。' onReset={reset} />}

			{phase === 'error' && (
				<ResultPanel icon={<AlertTriangle size={34} className='text-rose-500' />} title='处理失败' description={error || '发生未知错误'} onReset={reset} />
			)}

			<div className='mt-7 flex items-start gap-3 border-t border-border pt-5 text-xs leading-5 text-secondary'>
				<ShieldCheck size={17} className='text-brand mt-0.5 shrink-0' />
				<p>压缩内核会在目录分析后从 CDN 预热；文件仅在当前设备中读取和打包，不上传服务器。处理期间请保持页面打开，关闭页面会终止任务。</p>
			</div>
		</div>
	)
}

function Stat({ label, value }: { label: string; value: string }) {
	return <div className='rounded-xl border border-border bg-background/25 p-3'><p className='text-[10px] text-secondary'>{label}</p><p className='mt-1 truncate font-semibold text-primary'>{value}</p></div>
}

function ResultPanel({ icon, title, description, onReset }: { icon: React.ReactNode; title: string; description: string; onReset: () => void }) {
	return (
		<section className='flex min-h-80 flex-col items-center justify-center rounded-2xl border border-border bg-background/20 p-8 text-center'>
			{icon}<h2 className='mt-5 text-lg font-semibold text-primary'>{title}</h2><p className='text-secondary mt-2 max-w-lg break-words'>{description}</p>
			<button type='button' onClick={onReset} className='mt-7 flex items-center gap-2 rounded-xl border border-border px-5 py-3 font-medium text-primary'><RotateCcw size={16} />打包其他内容</button>
		</section>
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
