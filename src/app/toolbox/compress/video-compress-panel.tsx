'use client'

import { useMemo, useState, type DragEvent } from 'react'
import { AlertTriangle, CheckCircle2, FileVideo, HardDriveDownload, LoaderCircle, Pause, Play, RotateCcw, ShieldCheck, Square, Trash2 } from 'lucide-react'
import { SelectMenu, type SelectMenuOption } from '@/components/select-menu'
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock'
import { estimateVideoOutputBytes, resolveVideoCompressionConfig, VIDEO_PRESETS, type CustomVideoPreset } from '@/lib/video-compress/presets'
import type { VideoCompressionPhase, VideoPresetId, VideoWorkerMode } from '@/lib/video-compress/types'
import { useVideoCompress } from './use-video-compress'

const GIB = 1024 ** 3
const ACTIVE_WAKE_PHASES = new Set<VideoCompressionPhase>(['preparing', 'running', 'pausing', 'finalizing'])
const HEIGHT_OPTIONS: readonly SelectMenuOption<string>[] = [
	{ value: '720', label: '720p' },
	{ value: '1080', label: '1080p' },
	{ value: '1440', label: '1440p' },
	{ value: '2160', label: '4K' }
]
const FRAME_RATE_OPTIONS: readonly SelectMenuOption<string>[] = [
	{ value: '24', label: '24 fps' },
	{ value: '30', label: '30 fps' },
	{ value: '60', label: '60 fps' }
]
const WORKER_MODE_OPTIONS: readonly SelectMenuOption<VideoWorkerMode>[] = [
	{ value: 'single', label: '稳定单路' },
	{ value: 'dual', label: '双路并行（推荐）' }
]

const PHASE_LABELS: Record<VideoCompressionPhase, string> = {
	idle: '等待选择视频',
	inspecting: '正在读取视频信息…',
	ready: '可以开始压缩',
	preparing: '正在准备编码器…',
	running: '正在压缩',
	pausing: '正在暂停…',
	paused: '已暂停',
	finalizing: '正在合并音视频并生成索引…',
	canceling: '正在取消…',
	done: '压缩完成',
	canceled: '任务已取消',
	error: '处理失败'
}

function formatBytes(bytes: number | null) {
	if (bytes === null) return '无法估算'
	if (bytes < 1024) return `${bytes.toFixed(0)} B`
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < GIB) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
	return `${(bytes / GIB).toFixed(2)} GB`
}

function formatDuration(seconds: number | null) {
	if (seconds === null || !Number.isFinite(seconds)) return '未知'
	const whole = Math.max(0, Math.round(seconds))
	const hours = Math.floor(whole / 3600)
	const minutes = Math.floor((whole % 3600) / 60)
	const remaining = whole % 60
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
		: `${minutes}:${String(remaining).padStart(2, '0')}`
}

function formatCodec(codec: string | null) {
	if (!codec) return '无音频'
	return codec === 'avc' ? 'H.264' : codec.toUpperCase()
}

export function VideoCompressPanel() {
	const controller = useVideoCompress()
	const [preset, setPreset] = useState<VideoPresetId>('balanced')
	const [custom, setCustom] = useState<CustomVideoPreset>({ maxHeight: 1080, frameRate: 30, videoBitrateMbps: 5 })
	const [workerMode, setWorkerMode] = useState<VideoWorkerMode>('dual')
	const [isDragging, setIsDragging] = useState(false)
	const wakeLock = useScreenWakeLock({
		active: ACTIVE_WAKE_PHASES.has(controller.phase),
		storageKey: 'video-screen-wake-lock-enabled'
	})

	const config = useMemo(
		() => controller.inspection ? resolveVideoCompressionConfig(controller.inspection, preset, custom) : null,
		[controller.inspection, custom, preset]
	)
	const estimatedBytes = controller.inspection && config ? estimateVideoOutputBytes(controller.inspection, config) : null
	const inspection = controller.inspection
	const estimatedLarger = Boolean(inspection && estimatedBytes && estimatedBytes >= inspection.size)
	const estimatedSaving = inspection && estimatedBytes
		? Math.max(0, Math.round((1 - estimatedBytes / inspection.size) * 100))
		: null
	const progressPercent = Math.min(100, Math.max(0, Math.round(controller.progress * 100)))
	const lanes = controller.lanes ?? []
	const remainingSeconds = controller.inspection?.duration && controller.speed > 0
		? Math.max(0, (controller.inspection.duration - controller.processedTime) / controller.speed)
		: null
	const canStart = Boolean(inspection && config && !inspection.hasHighDynamicRange && !estimatedLarger && !controller.unsupportedReason && !controller.isActive)

	const selectFirstFile = (files: FileList | null) => {
		const file = files?.[0]
		if (file) controller.selectFile(file)
	}

	const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		setIsDragging(false)
		selectFirstFile(event.dataTransfer.files)
	}

	return (
		<div className='mx-auto flex max-w-5xl flex-col gap-7'>
			{controller.unsupportedReason && (
				<div className='flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 p-4 text-amber-700 dark:text-amber-300'>
					<AlertTriangle size={19} className='mt-0.5 shrink-0' />
					<div>
						<p className='font-semibold'>当前环境暂不能处理大视频</p>
						<p className='mt-1 text-sm opacity-85'>{controller.unsupportedReason}</p>
					</div>
				</div>
			)}

			<label
				onDragOver={event => event.preventDefault()}
				onDragEnter={() => setIsDragging(true)}
				onDragLeave={() => setIsDragging(false)}
				onDrop={handleDrop}
				className={`group relative flex min-h-[220px] flex-col items-center justify-center gap-5 rounded-2xl border border-dashed p-7 text-center transition-colors ${controller.isActive ? 'cursor-not-allowed border-border bg-background/20 opacity-70' : 'cursor-pointer border-brand/25 bg-background/25 hover:border-brand/45 hover:bg-brand/5'} ${isDragging ? 'border-brand bg-brand/10' : ''}`}>
				<input
					type='file'
					accept='video/*,.mp4,.mov,.webm,.mkv'
					disabled={controller.isActive}
					className='hidden'
					onChange={event => {
						selectFirstFile(event.target.files)
						event.currentTarget.value = ''
					}}
				/>
				<div className='bg-brand/10 text-brand flex size-16 items-center justify-center rounded-full'>
					{controller.phase === 'inspecting' ? <LoaderCircle size={30} className='animate-spin' /> : <FileVideo size={30} />}
				</div>
				<div>
					<p className='text-base font-semibold text-primary'>{controller.file ? controller.file.name : '点击或拖拽视频到这里'}</p>
					<p className='text-secondary mt-2 text-sm'>{controller.file ? `${formatBytes(controller.file.size)} · ${PHASE_LABELS[controller.phase]}` : '支持 MP4、MOV、WebM、MKV；大文件不会读入内存'}</p>
				</div>
			</label>

			{inspection && (
				<>
					<section className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
						{[
							['视频', `${inspection.width} × ${inspection.height} · ${inspection.frameRate ? `${inspection.frameRate.toFixed(2)} fps` : '帧率未知'}`],
							['编码', `${formatCodec(inspection.videoCodec)} / ${formatCodec(inspection.audioCodec)}`],
							['时长', formatDuration(inspection.duration)],
							['文件', `${inspection.format} · ${formatBytes(inspection.size)}`]
						].map(([label, value]) => (
							<div key={label} className='rounded-xl border border-border bg-background/25 p-4'>
								<p className='text-secondary text-xs'>{label}</p>
								<p className='mt-2 break-words font-medium text-primary'>{value}</p>
							</div>
						))}
					</section>

					{(inspection.hasHighDynamicRange || inspection.extraTrackCount > 0 || inspection.size >= 8 * GIB) && (
						<div className='space-y-2 text-sm'>
							{inspection.hasHighDynamicRange && <p className='rounded-xl border border-rose-500/25 bg-rose-500/8 px-4 py-3 text-rose-700 dark:text-rose-300'>暂不支持 HDR 视频，避免压缩后颜色异常。</p>}
							{inspection.extraTrackCount > 0 && <p className='rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-amber-700 dark:text-amber-300'>检测到额外轨道；首版只保留主视频轨和主音频轨。</p>}
							{inspection.size >= 8 * GIB && <p className='rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-primary'>已进入大文件模式：按需读取并直接写入本地磁盘。</p>}
						</div>
					)}

					<section>
						<h2 className='text-sm font-semibold text-primary'>压缩方案</h2>
						<div className='mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4'>
							{VIDEO_PRESETS.map(option => (
								<button
									key={option.id}
									type='button'
									disabled={controller.isActive}
									onClick={() => setPreset(option.id)}
									className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${preset === option.id ? 'border-brand bg-brand/8 shadow-sm' : 'border-border bg-background/25 hover:border-brand/35'}`}>
									<p className='font-semibold text-primary'>{option.label}</p>
									<p className='text-secondary mt-2 text-xs leading-5'>{option.description}</p>
								</button>
							))}
						</div>
					</section>

					{preset === 'custom' && (
						<section className='grid gap-4 rounded-xl border border-border bg-background/20 p-4 sm:grid-cols-3'>
							<div className='text-sm text-primary'>
								<span className='font-medium'>最大高度</span>
								<SelectMenu value={String(custom.maxHeight)} options={HEIGHT_OPTIONS} disabled={controller.isActive} onChange={value => setCustom(current => ({ ...current, maxHeight: Number(value) }))} ariaLabel='选择最大视频高度' className='mt-2' />
							</div>
							<div className='text-sm text-primary'>
								<span className='font-medium'>最大帧率</span>
								<SelectMenu value={String(custom.frameRate)} options={FRAME_RATE_OPTIONS} disabled={controller.isActive} onChange={value => setCustom(current => ({ ...current, frameRate: Number(value) }))} ariaLabel='选择最大视频帧率' className='mt-2' />
							</div>
							<label className='text-sm text-primary'>
								<span className='font-medium'>视频码率（Mbps）</span>
								<input type='number' min={0.5} max={80} step={0.5} value={custom.videoBitrateMbps} disabled={controller.isActive} onChange={event => setCustom(value => ({ ...value, videoBitrateMbps: Math.max(0.5, Number(event.target.value) || 0.5) }))} className='mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 outline-none' />
							</label>
						</section>
					)}

					<section className='flex flex-col gap-3 rounded-xl border border-border bg-background/20 p-4 sm:flex-row sm:items-center sm:justify-between'>
						<div>
							<p className='text-sm font-medium text-primary'>处理性能</p>
							<p className='text-secondary mt-1 text-xs'>双路适合长视频；资源受限时可切换稳定单路。</p>
						</div>
						<SelectMenu value={workerMode} options={WORKER_MODE_OPTIONS} disabled={controller.isActive} onChange={setWorkerMode} ariaLabel='选择视频处理性能' className='w-full sm:w-52' />
					</section>

					{config && (
						<section className='grid gap-4 rounded-xl border border-border bg-background/25 p-5 md:grid-cols-[1fr_auto] md:items-center'>
							<div>
								<p className='font-semibold text-primary'>输出 H.264 / MP4</p>
								<p className='text-secondary mt-2 text-sm'>{config.width} × {config.height} · {config.frameRate.toFixed(2)} fps · {(config.videoBitrate / 1_000_000).toFixed(2)} Mbps</p>
							</div>
							<div className='md:text-right'>
								<p className='text-secondary text-xs'>预计输出</p>
								<p className='mt-1 text-lg font-semibold text-primary'>{formatBytes(estimatedBytes)}</p>
								{estimatedSaving !== null && !estimatedLarger && <p className='mt-1 text-xs text-emerald-600'>预计节省 {estimatedSaving}%</p>}
							</div>
							{estimatedLarger && <p className='text-sm text-rose-700 md:col-span-2 dark:text-rose-300'>当前设置预计会增大文件，已禁止开始。请降低自定义码率。</p>}
						</section>
					)}
				</>
			)}

			{(controller.isActive || controller.phase === 'done' || controller.phase === 'canceled') && (
				<section className='rounded-xl border border-border bg-background/25 p-5'>
					<div className='flex flex-wrap items-center justify-between gap-3'>
						<div className='flex items-center gap-2'>
							{controller.phase === 'done' ? <CheckCircle2 size={18} className='text-emerald-500' /> : controller.phase === 'canceled' ? <Square size={16} className='text-secondary' /> : <LoaderCircle size={18} className={controller.phase === 'paused' ? '' : 'animate-spin'} />}
							<p className='font-semibold text-primary'>{controller.phase === 'running' && controller.workerCount > 1 ? `${controller.workerCount} 路并行压缩` : PHASE_LABELS[controller.phase]}</p>
						</div>
						<span className='font-semibold text-primary'>{progressPercent}%</span>
					</div>
					<div className='mt-4 h-2 overflow-hidden rounded-full bg-border/60'>
						<div className='bg-brand h-full rounded-full transition-[width] duration-300' style={{ width: `${progressPercent}%` }} />
					</div>
					<div className='text-secondary mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4'>
						<span>已处理 {formatDuration(controller.processedTime)}</span>
						<span>已写入 {formatBytes(controller.outputBytes)}</span>
						<span>速度 {controller.speed > 0 ? `${controller.speed.toFixed(2)}×` : '计算中'}</span>
						<span>剩余 {remainingSeconds === null ? '计算中' : formatDuration(remainingSeconds)}</span>
					</div>
					{lanes.length > 1 && (
						<div className='mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
							{lanes.map(lane => (
								<div key={lane.lane} className='rounded-lg border border-border bg-background/30 px-3 py-2.5 text-xs'>
									<div className='flex items-center justify-between gap-2 font-medium text-primary'>
										<span>Worker {lane.lane}</span>
										<span>{lane.segmentIndex === null ? '等待任务' : `${Math.round(lane.progress * 100)}%`}</span>
									</div>
									{lane.segmentIndex !== null && <p className='text-secondary mt-1'>{formatDuration(lane.start)}～{formatDuration(lane.end)} · {lane.speed > 0 ? `${lane.speed.toFixed(2)}×` : '准备中'}</p>}
								</div>
							))}
						</div>
					)}
					{controller.outputName && <p className='text-secondary mt-3 truncate text-xs'>保存为：{controller.outputName}</p>}
				</section>
			)}

			{controller.error && (
				<div className='flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/8 p-4 text-rose-700 dark:text-rose-300'>
					<AlertTriangle size={19} className='mt-0.5 shrink-0' />
					<p>{controller.error}</p>
				</div>
			)}

			<div className='flex flex-wrap items-center gap-3'>
				{canStart && config && (
					<button type='button' onClick={() => void controller.start(config, workerMode)} className='bg-brand text-background flex items-center gap-2 rounded-xl px-5 py-3 font-semibold shadow-sm transition hover:opacity-90'>
						<HardDriveDownload size={17} />
						选择保存位置并开始
					</button>
				)}
				{controller.phase === 'running' && <button type='button' onClick={controller.pause} className='flex items-center gap-2 rounded-xl border border-border bg-background/35 px-5 py-3 font-semibold text-primary'><Pause size={16} />暂停</button>}
				{controller.phase === 'paused' && <button type='button' onClick={controller.resume} className='bg-brand text-background flex items-center gap-2 rounded-xl px-5 py-3 font-semibold'><Play size={16} />继续</button>}
				{controller.isActive && controller.phase !== 'finalizing' && <button type='button' onClick={controller.cancel} disabled={controller.phase === 'canceling'} className='flex items-center gap-2 rounded-xl border border-border bg-background/35 px-5 py-3 font-semibold text-primary disabled:opacity-50'><Square size={15} />取消</button>}
				{controller.file && !controller.isActive && <button type='button' onClick={controller.reset} className='text-secondary hover:text-primary flex items-center gap-2 rounded-xl border border-border bg-background/25 px-4 py-3 font-medium transition'>{controller.phase === 'done' ? <RotateCcw size={16} /> : <Trash2 size={16} />}{controller.phase === 'done' ? '压缩另一个视频' : '移除视频'}</button>}

				{wakeLock.ready && wakeLock.supported && (
					<label className='ml-auto flex cursor-pointer items-center gap-2 text-sm text-secondary max-sm:ml-0 max-sm:w-full'>
						<input type='checkbox' checked={wakeLock.enabled} onChange={event => wakeLock.setEnabled(event.target.checked)} className='size-4 accent-[var(--color-brand)]' />
						处理时保持屏幕常亮{wakeLock.active ? '（已启用）' : ''}
					</label>
				)}
			</div>

			<div className='text-secondary flex items-start gap-3 border-t border-border pt-5 text-xs leading-5'>
				<ShieldCheck size={17} className='text-brand mt-0.5 shrink-0' />
				<p>视频只在当前设备的浏览器中读取和压缩，不上传服务器。处理期间请保持页面打开；系统休眠或关闭页面会终止任务。</p>
			</div>
		</div>
	)
}
