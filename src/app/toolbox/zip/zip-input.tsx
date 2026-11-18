import { ArrowUpRight, FileArchive, Files, FolderOpen, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ZipOutputFileHandle } from '@/lib/zip-packer'

export type ZipPickers = {
	showDirectoryPicker?: (options: { id: string; mode: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
	showSaveFilePicker?: (options: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<ZipOutputFileHandle>
}

export function ZipInput({ unpack, onFiles, onDirectory }: { unpack?: boolean; onFiles: (files: File[]) => void; onDirectory?: () => void }) {
	const input = useRef<HTMLInputElement>(null)
	const [error, setError] = useState('')
	const [dragging, setDragging] = useState(false)
	const choices = unpack
		? [{ label: '选择 ZIP 文件', hint: '浏览目录，提取所需文件', Icon: FileArchive, open: () => input.current?.click() }]
		: [
				...(onDirectory ? [{ label: '选择文件夹', hint: '保留目录结构，自由筛选内容', Icon: FolderOpen, open: onDirectory }] : []),
				{ label: '选择文件', hint: '将一个或多个文件打包为 ZIP', Icon: Files, open: () => input.current?.click() }
			]
	return (
		<section
			className={'rounded-2xl border border-dashed px-5 py-7 transition-colors sm:px-8 sm:py-10 ' + (dragging ? 'border-brand bg-brand/10' : 'border-brand/35 bg-linear-to-b from-brand/5 to-background/20')}
			onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) setDragging(true) }}
			onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
			onDragOver={event => event.preventDefault()}
			onDrop={event => {
				event.preventDefault()
				setDragging(false)
				if ([...event.dataTransfer.items].some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
					setError(onDirectory ? '请用「选择文件夹」打开目录。' : '请拖入文件。')
					return
				}
				const files = [...event.dataTransfer.files]
				if (unpack && files.length > 1) {
					setError('每次打开一个 ZIP 文件。')
					return
				}
				if (files.length) onFiles(files)
			}}>
			<div className='mx-auto max-w-2xl'>
				<div className='mb-6 text-center'>
					<h2 className='text-xl font-semibold text-primary'>{unpack ? '打开压缩包' : '选择要打包的内容'}</h2>
					<p className='mt-2 inline-flex items-center gap-2 text-sm text-secondary'><Upload size={15} />{unpack ? '将 ZIP 文件拖到这里' : '支持将多个文件拖到这里'}</p>
				</div>
				<input
					ref={input}
					hidden
					type='file'
					multiple={!unpack}
					accept={unpack ? '.zip,application/zip' : undefined}
					onChange={event => {
						const files = Array.from(event.target.files || [])
						event.target.value = ''
						if (files.length) onFiles(files)
					}}
				/>
				<div className={'grid gap-3 sm:gap-4 ' + (choices.length > 1 ? 'sm:grid-cols-2' : 'mx-auto max-w-md')}>
					{choices.map(({ label, hint, Icon, open }) => (
						<button type='button' key={label} aria-label={label} onClick={open}
							className='group relative flex items-center gap-4 rounded-2xl border border-border bg-article/80 p-4 text-left shadow-sm transition hover:border-brand/55 hover:bg-article focus-visible:outline-2 focus-visible:outline-brand sm:flex-wrap sm:p-6'>
							<span className='flex size-11 shrink-0 items-center justify-center rounded-xl border border-brand/15 bg-brand/10 text-brand'><Icon size={23} /></span>
							<span className='min-w-0 flex-1 sm:basis-full'>
								<span className='block font-semibold text-primary'>{label}</span>
								<span className='mt-1 block text-xs leading-5 text-secondary'>{hint}</span>
							</span>
							<ArrowUpRight size={17} className='shrink-0 text-secondary transition group-hover:text-brand sm:absolute sm:top-6 sm:right-6' />
						</button>
					))}
				</div>
			</div>
			{error && (
				<p role='alert' className='text-secondary mt-3'>
					{error}
				</p>
			)}
		</section>
	)
}
