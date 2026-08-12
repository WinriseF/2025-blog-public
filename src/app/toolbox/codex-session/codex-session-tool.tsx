'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { INIT_DELAY } from '@/consts'
import { isAuditCommand } from '@/lib/codex-session/command-semantics'
import { CommandsView } from './commands-view'
import { DetailPanel, type DetailSelection } from './detail-panel'
import { FilesView } from './files-view'
import { SessionImport, SessionOverview } from './session-surface'
import { TokenView } from './token-view'
import { useSessionParser } from './use-session-parser'

type TabId = 'commands' | 'files' | 'token'

export function CodexSessionTool() {
	const shouldReduceMotion = useReducedMotion()
	const { state, parse, cancel, clear } = useSessionParser()
	const [tab, setTab] = useState<TabId>('commands')
	const [selection, setSelection] = useState<DetailSelection | null>(null)

	const importFile = (file: File) => {
		setSelection(null)
		setTab('commands')
		parse(file)
	}

	if (state.status !== 'success') {
		return <SessionImport
			onFile={importFile}
			progress={state.status === 'parsing' ? { file: state.file, bytesRead: state.bytesRead, records: state.records } : undefined}
			error={state.status === 'error' ? state.message : undefined}
			onCancel={cancel}
		/>
	}

	const { result } = state
	const warnings = result.diagnostics.filter(item => item.severity !== 'info').length
	const commandCount = result.processes.reduce((total, process) => total + (process.analysis?.commands.filter(isAuditCommand).length ?? 0), 0)
	const tabs: Array<{ id: TabId; label: string; count: number }> = [
		{ id: 'commands', label: '命令', count: commandCount },
		{ id: 'files', label: '文件', count: result.fileAudit.changes.length + result.fileAudit.reads.length },
		{ id: 'token', label: 'Token', count: result.tokenUsage.samples.length }
	]

	return (
		<motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: INIT_DELAY }} className='max-sm:px-4'>
			<SessionOverview result={result} onClear={() => { setSelection(null); clear() }} onFile={importFile} />

			{warnings > 0 && <div className='mt-4 flex items-start gap-2 border-l-2 border-amber-400 bg-amber-400/5 px-3 py-2 text-xs text-amber-700'>
				<AlertTriangle size={15} className='mt-0.5 shrink-0' />
				<span>解析时发现 {warnings} 个需要注意的问题；无法确认的内容没有计入关键命令或文件修改。</span>
			</div>}

			<nav className='mt-6 flex gap-1 overflow-x-auto border-b border-border' aria-label='Session 审计视图'>
				{tabs.map(item => <button key={item.id} type='button' onClick={() => { setTab(item.id); setSelection(null) }} className={`relative shrink-0 px-4 py-3 text-xs font-medium transition ${tab === item.id ? 'text-brand' : 'text-secondary hover:text-primary'}`}>
					{item.label}<span className='ml-1.5 text-[10px] opacity-70'>{item.count.toLocaleString('zh-CN')}</span>
					{tab === item.id && <span className='bg-brand absolute inset-x-2 bottom-0 h-0.5 rounded-full' />}
				</button>)}
			</nav>

			<div className={selection ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.62fr)] lg:items-start lg:gap-5' : undefined}>
				<section className='mt-5 min-w-0'>
					{tab === 'commands' && <CommandsView processes={result.processes} onSelect={setSelection} />}
					{tab === 'files' && <FilesView audit={result.fileAudit} onSelect={setSelection} />}
					{tab === 'token' && <TokenView usage={result.tokenUsage} onSelect={setSelection} />}
				</section>

				{selection && <DetailPanel selection={selection} onClose={() => setSelection(null)} />}
			</div>
		</motion.div>
	)
}
