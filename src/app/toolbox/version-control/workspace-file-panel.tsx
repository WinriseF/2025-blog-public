'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft, FileCode2, Save, X } from 'lucide-react'
import { RepositoryFileViewer } from './repository-file-viewer'
import type { useWorkspaceFiles } from './use-workspace-files'
import dynamic from 'next/dynamic'
import { useTimeTheme } from '@/components/time-theme-provider'
import { createFileThemeStyle, diffThemes } from './diff-themes'

const WorkspaceTextEditor = dynamic(() => import('./workspace-text-editor').then(module => module.WorkspaceTextEditor), { ssr: false })

export function WorkspaceFilePanel({ files, onMobileBack }: { files: ReturnType<typeof useWorkspaceFiles>; onMobileBack: () => void }) {
	const { theme } = useTimeTheme()
	const { tabs, active, document, editable, reading, saving, dirty } = files
	const renderHeader = (actions: ReactNode) => (
		<header className={`flex h-10 shrink-0 items-center border-b [background-color:var(--diff-subtle)] [border-color:var(--diff-border)] ${tabs.length ? '' : 'lg:hidden'}`}>
			<button onClick={onMobileBack} aria-label='返回文件树' className='flex size-10 shrink-0 items-center justify-center [color:var(--diff-muted)] lg:hidden'><ArrowLeft size={16} /></button>
			<FileTabStrip activePath={active?.path} count={tabs.length}>
				{tabs.map(tab => <div key={tab.entry.path} className={`flex h-full shrink-0 items-center border-r border-t-2 [border-right-color:var(--diff-border)] ${active?.path === tab.entry.path ? '[background-color:var(--diff-background)] border-t-brand' : '[color:var(--diff-muted)] border-t-transparent'}`}>
					<button role='tab' aria-selected={active?.path === tab.entry.path} title={tab.entry.path} onClick={() => void files.open(tab.entry)} onDoubleClick={() => files.pin(tab.entry.path)} className={`flex h-full items-center gap-2 px-3 text-xs ${tab.preview ? 'italic' : ''}`}>
						<FileCode2 size={14} className='text-brand' /><span className='max-w-32 truncate sm:max-w-48'>{tab.entry.name}</span>
					</button>
					<button onClick={() => files.close(tab.entry.path)} aria-label={`关闭 ${tab.entry.name}`} className='hover:bg-brand/10 mr-1 rounded p-1.5'>
						{dirty && active?.path === tab.entry.path ? <span aria-label='未保存' className='mx-1 [background-color:var(--diff-foreground)] block size-1.5 rounded-full' /> : <X size={13} />}
					</button>
				</div>)}
			</FileTabStrip>
			{actions && <div className='flex shrink-0 items-center border-l px-1 [border-color:var(--diff-border)]'>{actions}</div>}
		</header>
	)
	return (
		<section style={active ? createFileThemeStyle(diffThemes[theme.name]) : undefined} className={`flex h-full min-w-0 flex-col ${active ? '[background-color:var(--file-background)] [color:var(--diff-foreground)]' : ''}`}>
			{editable && document && document.path === active?.path ? <>
				{renderHeader(<button disabled={!dirty || saving} onClick={() => void files.save()} title='保存（Ctrl+S）' aria-label='保存文件'
					className='text-brand flex h-9 items-center gap-1.5 rounded px-2 text-xs hover:[background-color:var(--diff-hover)] disabled:opacity-40'><Save size={14} /><span className='hidden sm:inline'>保存</span></button>)}
				<WorkspaceTextEditor key={document.path} path={document.path} value={document.text} onChange={files.edit} onSave={() => { void files.save() }} disabled={saving} />
				<footer className='flex h-6 shrink-0 items-center justify-end gap-3 border-t px-3 text-[10px] [border-color:var(--diff-border)] [color:var(--diff-muted)]'><span>工作区</span><span role='status'>{saving ? '正在保存…' : dirty ? '未保存' : '已保存'}</span></footer>
			</> : reading && editable ? <>{renderHeader(null)}<div className='text-secondary flex flex-1 items-center justify-center text-sm'>正在读取文件…</div></> : <div className='min-h-0 flex-1'><RepositoryFileViewer entry={active} renderHeader={renderHeader} /></div>}
			{files.error && <div role='alert' className='shrink-0 border-t border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-400'>{files.error}</div>}
		</section>
	)
}

function FileTabStrip({ activePath, count, children }: { activePath?: string; count: number; children: ReactNode }) {
	const stripRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const strip = stripRef.current
		if (!strip) return
		const wheel = (event: WheelEvent) => {
			// Preserve browser zoom and native horizontal trackpad gestures.
			if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return
			event.preventDefault()
			const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1
			strip.scrollLeft += event.deltaY * unit
		}
		strip.addEventListener('wheel', wheel, { passive: false })
		return () => strip.removeEventListener('wheel', wheel)
	}, [])

	useEffect(() => {
		const strip = stripRef.current
		if (!strip) return
		const revealActiveTab = () => {
			const tab = strip.querySelector('[role="tab"][aria-selected="true"]')?.parentElement
			if (!tab) return
			const viewport = strip.getBoundingClientRect()
			const bounds = tab.getBoundingClientRect()
			if (bounds.left < viewport.left) strip.scrollLeft += bounds.left - viewport.left
			else if (bounds.right > viewport.right) strip.scrollLeft += bounds.right - viewport.right
		}
		revealActiveTab()
		const observer = new ResizeObserver(revealActiveTab)
		observer.observe(strip)
		return () => observer.disconnect()
	}, [activePath, count])

	return <div ref={stripRef} className='flex h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' role='tablist' aria-label='打开的文件'>{children}</div>
}
