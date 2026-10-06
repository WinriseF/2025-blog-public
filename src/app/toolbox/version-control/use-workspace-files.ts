'use client'

import { useEffect, useRef, useState } from 'react'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { TextSnapshot } from '@/lib/version-control/browser-directory'
import type { RepositoryTreeEntry } from '@/lib/version-control/types'
import type { WorkspaceChoice } from './workspace-choice'

type Tab = { entry: RepositoryTreeEntry; preview: boolean }
type Document = { key: string; path: string; snapshot: TextSnapshot; text: string }

export function useWorkspaceFiles() {
	const directory = useVersionControlStore(state => state.browserDirectory)
	const repository = useVersionControlStore(state => state.repository)
	const revision = useVersionControlStore(state => state.fileRevision)
	const key = useVersionControlStore(state => state.workspaceKey)
	const isBare = useVersionControlStore(state => state.overview?.isBare)
	const canEdit = Boolean(directory || (repository?.source === 'local-agent' && !isBare))
	const [tabs, setTabs] = useState<Tab[]>([])
	const [active, setActive] = useState<RepositoryTreeEntry | null>(null)
	const [editable, setEditable] = useState(false)
	const [document, setDocument] = useState<Document | null>(null)
	const [reading, setReading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [choice, setChoice] = useState<WorkspaceChoice | null>(null)
	const choiceRef = useRef<WorkspaceChoice | null>(null)
	const busy = useRef(false)
	const saveBusy = useRef(false)
	const documentRef = useRef(document)
	documentRef.current = document
	const dirty = Boolean(document && document.text !== document.snapshot.content)

	useEffect(() => {
		setTabs([]); setActive(null); setDocument(null); setEditable(false); setError(null)
	}, [key])

	useEffect(() => {
		let cancelled = false
		const current = documentRef.current
		if (current?.key === directory?.key && current?.path === active?.path && current && current.text !== current.snapshot.content) return
		setDocument(null)
		setError(null)
		setReading(false)
		if (!editable || !directory || !active || active.kind !== 'file' || isImage(active.path)) return
		setReading(true)
		void directory.readText(active.path).then(snapshot => {
			if (!cancelled) setDocument({ key: directory.key, path: active.path, snapshot, text: snapshot.content })
		}).catch(error => { if (!cancelled) setError(message(error)) }).finally(() => { if (!cancelled) setReading(false) })
		return () => { cancelled = true }
	}, [directory, active?.path, revision, editable])

	useEffect(() => {
		if (!dirty) return
		const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
		window.addEventListener('beforeunload', beforeUnload)
		return () => window.removeEventListener('beforeunload', beforeUnload)
	}, [dirty])
	useEffect(() => () => { choiceRef.current?.resolve('cancel') }, [])

	function ask(title: string, description: string, options: WorkspaceChoice['options']) {
		return new Promise<string>(resolve => {
			const next = { title, description, options, resolve }
			choiceRef.current = next
			setChoice(next)
		})
	}
	function choose(value: string) {
		choiceRef.current?.resolve(value)
		choiceRef.current = null
		setChoice(null)
	}

	async function save() {
		const current = documentRef.current
		if (!directory || !current || saveBusy.current) return false
		if (current.text === current.snapshot.content) return true
		saveBusy.current = true
		setSaving(true); setError(null)
		try {
			let snapshot = await directory.saveText(current.path, current.text, current.snapshot)
			if (!snapshot) {
				const action = await ask('文件已被其他程序修改', current.path, [{ value: 'reload', label: '重新加载' }, { value: 'overwrite', label: '覆盖保存' }])
				if (action === 'cancel') return false
				const latest = await directory.readText(current.path)
				if (action === 'reload') {
					setDocument({ ...current, snapshot: latest, text: latest.content })
					return true
				}
				snapshot = await directory.saveText(current.path, current.text, latest)
				if (!snapshot) throw new Error('文件再次被修改，请重新保存。')
			}
			setDocument({ ...current, snapshot })
			return true
		} catch (error) { setError(message(error)); return false }
		finally { saveBusy.current = false; setSaving(false) }
	}

	async function guard(action: () => void | Promise<void>) {
		if (busy.current || saveBusy.current) return false
		busy.current = true
		try {
			const current = documentRef.current
			if (current && current.text !== current.snapshot.content) {
				const answer = await ask('保存修改？', `${current.path} 有未保存的修改。`, [{ value: 'save', label: '保存' }, { value: 'discard', label: '放弃' }])
				if (answer === 'cancel' || (answer === 'save' && !await save())) return false
				if (answer === 'discard') setDocument({ ...current, text: current.snapshot.content })
			}
			await action()
			return true
		} catch (error) { setError(message(error)); return false }
		finally { busy.current = false }
	}

	function pin(path: string) { setTabs(tabs => tabs.map(tab => tab.entry.path === path ? { ...tab, preview: false } : tab)) }
	function open(entry: RepositoryTreeEntry, permanent = false) {
		if (active?.path === entry.path) { if (permanent) pin(entry.path); return Promise.resolve(true) }
		return guard(() => {
			setTabs(tabs => {
				const existing = tabs.find(tab => tab.entry.path === entry.path)
				if (existing) return tabs.map(tab => tab === existing && permanent ? { ...tab, preview: false } : tab)
				return [...tabs.filter(tab => !tab.preview), { entry, preview: !permanent }]
			})
			setActive(entry)
		})
	}
	function close(path: string) {
		const remove = () => {
			const remaining = tabs.filter(tab => tab.entry.path !== path)
			setTabs(remaining)
			if (active?.path === path) setActive(remaining.at(-1)?.entry || null)
		}
		if (active?.path === path) void guard(remove)
		else remove()
	}
	function edit(text: string) {
		if (!document || saving) return
		pin(document.path)
		setDocument({ ...document, text })
	}
	function toggleEditable() {
		if (!canEdit) return
		if (editable) { void guard(() => setEditable(false)); return }
		// Directory selection and permission requests originate from this click.
		const workspace = useVersionControlStore.getState().workspaceKey
		const authorize = directory
			? directory.enableWriting().then(() => true)
			: useVersionControlStore.getState().authorizeLocalEditing()
		void authorize.then(granted => {
			if (granted && useVersionControlStore.getState().workspaceKey === workspace) setEditable(true)
		}).catch(error => {
			if (!(error instanceof DOMException && error.name === 'AbortError')) setError(message(error))
		})
	}

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && directory) {
				event.preventDefault()
				if (editable && !choiceRef.current && !busy.current) void save()
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})

	return { tabs, active, canEdit, editable, document, dirty, reading, saving, error, clearError: () => setError(null), choice, choose, guard, open, close, pin, edit, save, toggleEditable }
}

export const isImage = (path: string) => /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path)
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
