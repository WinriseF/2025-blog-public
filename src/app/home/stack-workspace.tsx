'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowLeft, ArrowUpRight, Bold, Check, ChevronRight, Code2, Download, FileText, Hash, Italic, KeyRound, List, LockKeyhole, PanelLeftClose, PenLine, Plus, RefreshCw, Search, Star, Trash2, Undo2 } from 'lucide-react'
import { useTimeTheme } from '@/components/time-theme-provider'
import { getAssetUrl } from '@/lib/asset-url'
import { WorkspaceSession } from '@/lib/stack/workspace'
import { NotePreview } from './note-preview'
import { NoteList } from './note-list'
import { StackSettings } from './stack-settings'
import { StackMark } from './stack-mark'
import { downloadText } from './vault-gate'
import themeStyles from './stack-login.module.css'
import styles from './stack-workspace.module.css'

type Props = { owner: string; email: string; dataKey: Uint8Array; epoch: string; onLock: () => void; onSignOut: () => void }
type View = 'all' | 'favorites' | 'trash'
const names: Record<View, string> = { all: '全部笔记', favorites: '我的收藏', trash: '回收站' }
const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })

export default function StackWorkspace(props: Props) {
	const [session, setSession] = useState<WorkspaceSession | null>(null)
	useEffect(() => {
		const next = new WorkspaceSession(props.owner, props.dataKey, props.epoch)
		setSession(next)
		return () => next.dispose()
	}, [props.owner, props.dataKey, props.epoch])
	return session ? <Workspace key={props.owner} {...props} session={session}/> : null
}

function Workspace({ owner, email, dataKey, epoch, onLock, onSignOut, session }: Props & { session: WorkspaceSession }) {
	const { theme } = useTimeTheme()
	const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
	const [view, setView] = useState<View>('all')
	const [query, setQuery] = useState('')
	const [tag, setTag] = useState('')
	const [selected, setSelected] = useState<string | null>(null)
	const [settings, setSettings] = useState(false)
	const [focus, setFocus] = useState(false)
	const [preview, setPreview] = useState(false)
	const search = useRef<HTMLInputElement>(null)
	const editor = useRef<HTMLTextAreaElement>(null)
	const mounted = useRef(true)
	const note = state.notes.find(item => item.id === selected)
	const deferredNotes = useDeferredValue(state.notes)
	const needle = useDeferredValue(query.trim().toLocaleLowerCase())
	const activeNotes = useMemo(() => deferredNotes.filter(item => !item.content.trashed), [deferredNotes])
	const tags = useMemo(() => [...new Set(activeNotes.flatMap(item => item.content.tags).filter(Boolean))].sort(), [activeNotes])
	const list = useMemo(() => deferredNotes.filter(({ content }) => (view === 'trash' ? content.trashed : !content.trashed) && (view !== 'favorites' || content.favorite) && (!tag || content.tags.includes(tag)) && (!needle || content.title.toLocaleLowerCase().includes(needle) || content.tags.some(value => value.toLocaleLowerCase().includes(needle)) || content.body.toLocaleLowerCase().includes(needle))).sort((a, b) => b.updated.localeCompare(a.updated)), [deferredNotes, view, tag, needle])
	const dirty = state.unsaved
	const conflicts = useMemo(() => deferredNotes.filter(item => item.conflict), [deferredNotes])
	const select = useCallback((id: string) => { setSelected(id); setPreview(false) }, [])

	useEffect(() => {
		mounted.current = true
		void session.load()
		const refresh = () => { if (!document.hidden && !session.getSnapshot().busy && !session.getSnapshot().error) void session.sync() }
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (session.getSnapshot().unsaved) { event.preventDefault(); event.returnValue = '' }
		}
		window.addEventListener('focus', refresh)
		window.addEventListener('online', refresh)
		window.addEventListener('beforeunload', beforeUnload)
		const timer = window.setInterval(refresh, 30_000)
		return () => { mounted.current = false; window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('beforeunload', beforeUnload); window.clearInterval(timer) }
	}, [session])
	useEffect(() => {
		if (state.busy || state.error || state.resetRequired || !state.loaded || !state.notes.some(item => item.dirty && !item.conflict)) return
		const timer = window.setTimeout(() => void session.flush(), 900)
		return () => window.clearTimeout(timer)
	}, [session, state])
	useEffect(() => {
		const shortcuts = (event: KeyboardEvent) => {
			if (event.isComposing || !(event.ctrlKey || event.metaKey)) return
			if (event.key.toLowerCase() === 's') { event.preventDefault(); void session.flush() }
			if (event.key.toLowerCase() === 'k') { event.preventDefault(); setFocus(false); setSelected(null); requestAnimationFrame(() => search.current?.focus()) }
		}
		window.addEventListener('keydown', shortcuts)
		return () => window.removeEventListener('keydown', shortcuts)
	}, [session])

	function switchView(next: View) { setView(next); setTag(''); setSelected(null); setFocus(false) }
	function create() { setView('all'); setTag(''); setQuery(''); setPreview(false); setSelected(session.create()) }
	async function leave(action: () => void) {
		if (!session.getSnapshot().unsaved) { action(); return }
		await session.flush()
		if (!mounted.current) return
		if (session.getSnapshot().unsaved && !window.confirm('仍有内容或操作未确认保存。请先导出草稿；继续离开将丢弃本地未保存内容，是否继续？')) return
		action()
	}
	function insert(before: string, after = '') {
		if (!note || !editor.current) return
		const input = editor.current
		const start = input.selectionStart, end = input.selectionEnd
		session.edit(note.id, { body: note.content.body.slice(0, start) + before + note.content.body.slice(start, end) + after + note.content.body.slice(end) })
		requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + before.length, end + before.length) })
	}
	function iconButton(label: string, child: ReactNode, action: () => void, pressed?: boolean) {
		return <button type='button' title={label} aria-label={label} aria-pressed={pressed} onClick={action}>{child}</button>
	}

	return <section className={`${themeStyles.page} ${styles.page}`} data-theme={theme.name} lang='zh-CN'>
		<div className={styles.ambient} style={{ backgroundImage: `url("${getAssetUrl(`/images/project/mo-stack/login-backgrounds/${theme.name}.png`)}")` }} aria-hidden='true'/>
		<div className={styles.shell} data-focus={focus} data-editing={!!note}>
			<aside className={styles.sidebar} aria-label='墨栈导航'>
				<a href='/' className={styles.brand} onClick={event => { if (dirty) { event.preventDefault(); void leave(() => { window.location.href = '/' }) } }}><span><StackMark size={32}/></span><div>墨栈<small>INKSTACK</small></div><ArrowUpRight size={14}/></a>
				<div className={styles.spaceName}><span className={styles.avatar}>{(email[0] || 'M').toUpperCase()}</span><span className={styles.accountEmail}>{email}</span></div>
				<button className={styles.newNote} onClick={create} disabled={!state.loaded || state.resetRequired}><Plus size={17}/><span>新建笔记</span><PenLine size={14}/></button>
				<nav className={styles.navigation}>
					<button aria-current={view === 'all' && !tag ? 'page' : undefined} onClick={() => switchView('all')}><FileText size={17}/><span>全部笔记</span><small>{activeNotes.length}</small></button>
					<button aria-current={view === 'favorites' ? 'page' : undefined} onClick={() => switchView('favorites')}><Star size={17}/><span>我的收藏</span><small>{activeNotes.filter(item => item.content.favorite).length}</small></button>
					<button aria-current={view === 'trash' ? 'page' : undefined} onClick={() => switchView('trash')}><Trash2 size={17}/><span>回收站</span><small>{state.notes.length - activeNotes.length}</small></button>
				</nav>
				{tags.length > 0 && <div className={styles.tagSection}><p className={styles.sectionLabel}>标签 <span>{tags.length}</span></p>{tags.map(value => <button key={value} aria-pressed={tag === value} onClick={() => { setTag(value); setView('all'); setSelected(null) }}><Hash size={14}/><span>{value}</span></button>)}</div>}
				<div className={styles.sideBottom}>
					<button onClick={() => setSettings(true)}><KeyRound size={16}/><span>访问与安全</span><ChevronRight size={14}/></button>
					<button onClick={() => void leave(onLock)}><LockKeyhole size={16}/><span>锁定空间</span></button>
					<button className={styles.signOut} onClick={() => void leave(onSignOut)}>退出账户</button>
				</div>
			</aside>

			<section className={styles.listPane} aria-label='笔记列表'>
				<header className={styles.listHeader}><h1>{tag ? `# ${tag}` : names[view]}<small>{list.length}</small></h1>{iconButton('同步笔记', <RefreshCw size={17}/>, () => void session.sync())}</header>
				<label className={styles.search}><Search size={16}/><input ref={search} aria-label='搜索笔记' placeholder='搜索标题、正文、标签' value={query} onChange={event => setQuery(event.target.value)}/><kbd>⌘ K</kbd></label>
				<p className={styles.listMeta}>{query ? '搜索结果' : '按最近编辑排序'}</p>
				<div className={styles.mobileViews}><button aria-pressed={view === 'all'} onClick={() => switchView('all')}>全部</button><button aria-pressed={view === 'favorites'} onClick={() => switchView('favorites')}>收藏</button><button aria-pressed={view === 'trash'} onClick={() => switchView('trash')}>回收站</button><button onClick={() => setSettings(true)} aria-label='访问与安全'><KeyRound size={16}/></button><button onClick={() => void leave(onLock)} aria-label='锁定空间'><LockKeyhole size={16}/></button></div>
				<NoteList items={state.loaded ? list : []} selected={selected} onSelect={select} filter={view + ':' + tag + ':' + needle} empty={!state.loaded ? <div className={styles.listEmpty}>{state.error ? '同步中断，请重试' : '正在加载笔记…'}</div> : !list.length ? <div className={styles.listEmpty}><FileText size={25}/><p>{query || tag ? '未找到笔记' : view === 'trash' ? '回收站为空' : view === 'favorites' ? '暂无收藏' : '暂无笔记'}</p></div> : undefined}/>
				<footer className={styles.listFooter}><button onClick={create} disabled={!state.loaded || state.resetRequired} title='新建笔记' aria-label='新建笔记'><Plus size={18}/>新建笔记</button></footer>
			</section>

			<main className={styles.editorPane}>
				<header className={styles.editorHeader}>
					<div className={styles.breadcrumb}>{iconButton('返回笔记列表', <ArrowLeft size={17}/>, () => { setSelected(null); setFocus(false) })}<span>{names[view]}</span>{note && <><ChevronRight size={12}/><span>{note.content.title.trim() || '未命名笔记'}</span></>}</div>
					<div className={styles.editorActions}>{note && <>{iconButton(note.content.favorite ? '取消收藏' : '收藏笔记', <Star size={16}/>, () => session.edit(note.id, { favorite: !note.content.favorite }), note.content.favorite)}{iconButton('导出 Markdown', <Download size={16}/>, () => downloadText(`${note.content.title.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名笔记'}.md`, `# ${note.content.title}\n\n${note.content.body}`))}{iconButton('专注模式', <PanelLeftClose size={17}/>, () => setFocus(!focus), focus)}</>}{iconButton('锁定空间', <LockKeyhole size={16}/>, () => void leave(onLock))}</div>
				</header>
				{state.error && <div className={styles.alert} role='alert'><span>{state.error}</span><button onClick={() => downloadText('inkstack-local-notes.json', JSON.stringify({ owner, notes: state.notes.map(({ id, content }) => ({ id, content })) }, null, 2))}>导出本地文字</button><button disabled={state.busy} onClick={() => state.resetRequired ? void leave(onLock) : void session.sync()}>{state.resetRequired ? '重新解锁' : '重试'}</button></div>}
				{conflicts.length > 0 && !note?.conflict && <div className={styles.alert}><span>{conflicts.length} 篇笔记存在版本冲突，本地内容已保留。</span><button onClick={() => setSelected(conflicts[0].id)}>查看</button></div>}
				{note ? <>
					{note.conflict && <div className={styles.conflict} role='alert'><strong>{note.conflict.deleted ? '这篇笔记已在其他设备永久删除' : '这篇笔记有另一份更新'}</strong><p>本地内容已保留。你可以另存为新笔记，或放弃本地改动并读取云端版本。</p><div><button onClick={() => void session.resolve(note.id, true)}>{note.content.attachments.length ? '另存正文（不含附件）' : '保留本地副本'}</button><button onClick={() => { if (window.confirm('放弃本地未保存改动，使用云端版本？')) void session.resolve(note.id, false) }}>使用云端版本</button></div></div>}
					{note.content.trashed && <div className={styles.trashBanner}><span>此笔记在回收站中，仍占用存储空间。</span><button onClick={() => session.edit(note.id, { trashed: false })}><Undo2 size={14}/>恢复</button><button onClick={() => { if (window.confirm('永久删除这篇笔记？此操作无法撤销。')) void session.remove(note.id) }}>永久删除</button></div>}
					<div className={styles.editorScroll}>
						<article className={styles.document}>
							<input className={styles.titleInput} aria-label='笔记标题' placeholder='未命名笔记' value={note.content.title} maxLength={200} readOnly={note.content.trashed} onChange={event => session.edit(note.id, { title: event.target.value })}/>
							<time className={styles.documentMeta}>编辑于 {date(note.updated)}</time>
							<label className={styles.tagsInput}><Hash size={14}/><input aria-label='标签，以逗号分隔' placeholder='添加标签，以逗号分隔' value={note.content.tags.join(',')} maxLength={240} readOnly={note.content.trashed} onChange={event => session.edit(note.id, { tags: event.target.value.split(/[,，]/) })} onBlur={() => { const clean = [...new Set(note.content.tags.map(value => value.trim()).filter(Boolean))]; if (JSON.stringify(clean) !== JSON.stringify(note.content.tags)) session.edit(note.id, { tags: clean }) }}/></label>
							<div className={styles.toolbar}><div>{!preview && !note.content.trashed && <>{iconButton('加粗', <Bold size={15}/>, () => insert('**', '**'))}{iconButton('斜体', <Italic size={15}/>, () => insert('*', '*'))}{iconButton('列表', <List size={17}/>, () => insert('\n- '))}{iconButton('代码块', <Code2 size={17}/>, () => insert('\n```\n', '\n```\n'))}</>}</div><div className={styles.viewToggle}><button aria-pressed={!preview} onClick={() => setPreview(false)}>编辑</button><button aria-pressed={preview} onClick={() => setPreview(true)}>预览</button></div></div>
							{preview ? <NotePreview body={note.content.body}/> : <textarea ref={editor} className={styles.bodyInput} aria-label='笔记正文' placeholder='输入正文…' value={note.content.body} readOnly={note.content.trashed} spellCheck={false} onChange={event => session.edit(note.id, { body: event.target.value })}/>}
						</article>
					</div>
					<footer className={styles.editorFooter}><span>{note.content.body.length.toLocaleString()} 字符<span className={styles.footerDivider}>/</span>Markdown</span><button onClick={() => void session.flush()} disabled={state.busy}><Check size={13}/>{note.conflict ? '等待处理冲突' : state.busy ? '正在同步…' : note.dirty ? '保存到墨栈' : '已加密保存'}</button>{!note.content.trashed && <button onClick={() => session.edit(note.id, { trashed: true })} title='移到回收站' aria-label='移到回收站'><Trash2 size={15}/></button>}</footer>
				</> : <Welcome loaded={state.loaded && !state.resetRequired} onCreate={create}/>}
			</main>
		</div>
		{settings && <StackSettings owner={owner} dataKey={dataKey} epoch={epoch} onClose={() => setSettings(false)}/>}
	</section>
}

function Welcome({ loaded, onCreate }: { loaded: boolean; onCreate: () => void }) {
	return <div className={styles.welcome}><div className={styles.welcomeArt} aria-hidden='true'><span/><span/><div><StackMark size={56}/></div></div><button className={styles.primaryButton} disabled={!loaded} onClick={onCreate}><Plus size={17}/>新建笔记</button></div>
}
