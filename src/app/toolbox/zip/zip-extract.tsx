import { ArrowLeft, ArchiveRestore, FileArchive, FolderOutput, KeyRound, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { downloadBlob } from '@/lib/download-blob'
import { openZip, writeZipEntry, extractToDirectory } from '@/lib/zip-extract'
import { ZIP_DOWNLOAD_LIMIT, analyzeZipSelection, selectedZipEntries, toggleZipSubtree, type ZipNode } from '@/lib/zip-packer'
import { readZipBlob } from '@/lib/zip-runtime'
import { ZipAction, type ZipFeedback } from './zip-action'
import { ZipPreview } from './zip-preview'
import { ZipFileTree } from './zip-file-tree'
import { ZipInput, type ZipPickers } from './zip-input'

type Archive = Awaited<ReturnType<typeof openZip>>
type ExtractProps = {
	canPickDirectory: boolean
	busy: boolean
	setBusy: (value: boolean) => void
	nested?: { archive: Archive; parentName: string; back: () => void }
}

export function ZipExtract({ canPickDirectory, busy, setBusy, nested }: ExtractProps) {
	const [root, setArchive] = useState<Archive | null>(null)
	const archive = nested?.archive ?? root
	const [child, setChild] = useState<Archive | null>(null)
	const [selected, setSelected] = useState(new Set<string>())
	const [password, setPassword] = useState('')
	const [feedback, setFeedback] = useState<ZipFeedback | null>(null)
	const [activeAction, setActiveAction] = useState<'open' | 'save' | 'all' | 'selected'>('open')
	const [preview, setPreview] = useState<{ paths: string[]; index: number } | null>(null)
	const previewTrigger = useRef<HTMLElement | null>(null)
	const task = useRef<AbortController | null>(null)
	useEffect(() => () => task.current?.abort(), [])
	useEffect(() => () => { void root?.close() }, [root])
	useEffect(() => () => { void child?.close() }, [child])

	const byId = useMemo(() => new Map(archive?.nodes.map(node => [node.id, node])), [archive])
	const { states, stats } = useMemo(() => analyzeZipSelection(archive?.nodes ?? [], selected), [archive, selected])
	const encrypted = useMemo(() => archive && [...archive.files.values()].some(file => file.encrypted), [archive])

	async function run(source: typeof activeAction, action: (signal: AbortSignal) => Promise<string>, status: string) {
		if (task.current) return
		const controller = new AbortController()
		task.current = controller
		setActiveAction(source)
		setBusy(true)
		setFeedback({ state: 'working', title: status })
		try {
			const title = await action(controller.signal)
			setFeedback(title ? { state: 'done', title } : null)
		} catch (error) {
			if (controller.signal.aborted) setFeedback({ state: 'canceled', title: '已取消' })
			else if (error instanceof DOMException && error.name === 'AbortError') setFeedback(null)
			else if (error instanceof Error && /password/i.test(error.message)) setFeedback({ state: 'error', title: '请输入正确的解压密码。' })
			else setFeedback({ state: 'error', title: error instanceof Error ? error.message : '解压失败' })
		} finally {
			task.current = null
			setBusy(false)
		}
	}

	async function readArchive(file: File, signal: AbortSignal) {
		const next = await openZip(file, signal)
		if (signal.aborted) {
			await next.close()
			signal.throwIfAborted()
		}
		return next
	}

	function open(files: File[]) {
		void run('open', async signal => {
			setArchive(await readArchive(files[0], signal))
			setSelected(new Set())
			setPassword('')
			return ''
		}, '正在读取 ZIP 目录…')
	}

	function openNested(node: ZipNode) {
		if (!archive) return
		void run('open', async signal => {
			if (node.size > ZIP_DOWNLOAD_LIMIT) throw new Error('内层 ZIP 超过 64 MiB，请先保存，再单独打开。')
			const blob = await readZipBlob(archive.files.get(node.id)!, signal, ZIP_DOWNLOAD_LIMIT, password)
			signal.throwIfAborted()
			setChild(await readArchive(new File([blob], node.name), signal))
			return ''
		}, `正在打开 ${node.name}`)
	}

	function save(node: ZipNode) {
		if (!archive) return
		const entry = archive.files.get(node.id)!
		void run('save', async signal => {
			const progress = (current: number, total: number) => setFeedback({ state: 'working', title: '正在提取文件', detail: node.name, percent: total ? current / total * 100 : 0 })
			const picker = (window as ZipPickers).showSaveFilePicker
			if (picker) {
				const handle = await picker.call(window, { suggestedName: node.name })
				await writeZipEntry(entry, handle, signal, password, progress)
			} else {
				if (node.size > ZIP_DOWNLOAD_LIMIT) throw new Error('单文件超过普通下载的 64 MiB 上限，请使用支持直接写盘的浏览器。')
				const blob = await readZipBlob(entry, signal, ZIP_DOWNLOAD_LIMIT, password, progress)
				signal.throwIfAborted()
				downloadBlob(blob, node.name)
			}
			return `已提取 ${node.name}`
		}, '正在提取文件')
	}

	function extract(all: boolean) {
		if (!archive) return
		void run(all ? 'all' : 'selected', async signal => {
			const target = await (window as ZipPickers).showDirectoryPicker!({ id: 'zip-extract', mode: 'readwrite' })
			const ids = all ? new Set(byId.keys()) : selectedZipEntries(archive.nodes, states)
			const total = all ? archive.files.size : stats.files
			const saved = await extractToDirectory(archive, ids, target, signal, password, (path, completed, fraction) => {
				setFeedback({ state: 'working', title: '正在解压', detail: `${completed} / ${total} 个文件 · ${path}`, percent: total ? (completed + fraction) / total * 100 : undefined })
			})
			return saved ? `已保存 ${saved} 个文件` : '解压完成'
		}, '选择解压位置')
	}

	function closePreview() {
		setPreview(null)
		requestAnimationFrame(() => previewTrigger.current?.focus({ preventScroll: true }))
	}

	const cancel = busy && <button type='button' onClick={() => task.current?.abort()} className='w-full rounded-xl border border-border px-4 py-2 text-secondary hover:text-primary'>取消</button>
	const message = feedback && <p role='status' className='break-words text-xs text-secondary'>{feedback.title}{feedback.state === 'working' && feedback.percent !== undefined && ` · ${Math.min(99, Math.floor(feedback.percent))}%`}</p>
	return !archive ? (
		<div className='space-y-3'>
			<fieldset disabled={busy}><ZipInput unpack onFiles={open} /></fieldset>
			{message}{cancel}
		</div>
	) : (
					<>
					<div className={child ? 'hidden' : 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]'}>
						<fieldset inert={!!preview} disabled={busy} className='min-w-0'>
						<ZipFileTree
							scan={archive}
							states={states}
							onSave={save}
							onOpenArchive={openNested}
							onPreview={(paths, index) => {
								previewTrigger.current = document.activeElement as HTMLElement
								setPreview({ paths, index })
							}}
							onToggle={canPickDirectory ? (id, checked) => setSelected(current => toggleZipSubtree(byId, current, id, checked)) : undefined}
						/>
						</fieldset>
						<aside inert={!!preview} className='min-w-0 rounded-2xl border border-border bg-background/20 p-5'>
							<div className='flex items-center gap-3'>
								<span className='flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand'><FileArchive size={22} /></span>
								<div className='min-w-0'>
									<h2 className='truncate font-semibold text-primary' title={archive.name}>{archive.name}</h2>
									<p className='mt-1 text-xs text-secondary'>{archive.files.size} 个文件{canPickDirectory && ` · 已选 ${stats.files} 个`}</p>
								</div>
							</div>
							{encrypted && <label className='mt-5 block'>
								<span className='mb-2 flex items-center gap-2 text-xs font-medium text-secondary'><KeyRound size={14} />解压密码</span>
								<input type='password' disabled={busy} value={password} onChange={event => setPassword(event.target.value)} className='h-11 w-full rounded-xl border border-border bg-background/35 px-3 text-primary focus:border-brand' />
							</label>}
							<div className='mt-5 grid gap-2 border-t border-border pt-4'>
								{(activeAction === 'save' || activeAction === 'open') && message}
								{canPickDirectory && <>
									<p className='text-xs text-secondary'>目标目录中的同名文件会被覆盖。</p>
									<ZipAction label='全部解压' icon={ArchiveRestore} feedback={activeAction === 'all' ? feedback : null} disabled={busy || !archive.nodes.length} onClick={() => extract(true)} />
									<ZipAction label='解压所选' secondary icon={FolderOutput} feedback={activeAction === 'selected' ? feedback : null} disabled={busy || !selected.size} onClick={() => extract(false)} />
								</>}
								{busy ? cancel : nested ? <button type='button' onClick={nested.back} title={nested.parentName}
									className='flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-secondary hover:text-primary'><ArrowLeft size={15} />返回上一级</button> : <button type='button' onClick={() => { setArchive(null); setPassword(''); setFeedback(null) }}
									className='flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-secondary transition hover:text-primary'><RotateCcw size={15} />换一个文件</button>}
							</div>
						</aside>
						{preview && <ZipPreview key={preview.paths[preview.index]} path={preview.paths[preview.index]} entry={archive.files.get(preview.paths[preview.index])!}
							password={password} gallery={{ index: preview.index, length: preview.paths.length, onChange: index => setPreview({ ...preview, index }) }} onClose={closePreview} />}
					</div>
					{child && <ZipExtract canPickDirectory={canPickDirectory} busy={busy} setBusy={setBusy}
						nested={{ archive: child, parentName: archive.name, back: () => setChild(null) }} />}
				</>
	)
}
