'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { INIT_DELAY } from '@/consts'
import { isAuditCommand } from '@/lib/codex-session/command-semantics'
import { summarizePerformance } from '@/lib/codex-session/performance'
import type { SessionParseResult } from '@/lib/codex-session/types'
import { CommandsView } from './commands-view'
import { ActivityView } from './activity-view'
import { CompressionView } from './compression-view'
import { DetailPanel, type DetailSelection } from './detail-panel'
import { FilesView } from './files-view'
import { SessionOverview } from './session-surface'
import { TokenView } from './token-view'

type TabId = 'activity' | 'commands' | 'files' | 'token' | 'compress'

type SessionDetailProps = {
	result: SessionParseResult
	file: File
	onExit: () => void
	onFile: (file: File) => void
	backToTimeline?: boolean
}

export function SessionDetail({ result, file, onExit, onFile, backToTimeline }: SessionDetailProps) {
	const shouldReduceMotion = useReducedMotion()
	const [tab, setTab] = useState<TabId>('activity')
	const [compressionOpened, setCompressionOpened] = useState(false)
	const [selection, setSelection] = useState<DetailSelection | null>(null)
	const warnings = result.diagnostics.filter(item => item.severity !== 'info').length
	const commandCount = result.processes.reduce((total, process) => total + (process.analysis?.commands.filter(isAuditCommand).length ?? 0), 0)
	const tabs: Array<{ id: TabId; label: string; count?: number }> = [
		{ id: 'activity', label: '活动', count: result.activity.metrics.requestCount },
		{ id: 'commands', label: '命令', count: commandCount },
		{ id: 'files', label: '文件', count: result.fileAudit.changes.length + result.fileAudit.reads.length },
		{ id: 'token', label: 'Token', count: result.tokenUsage.samples.length },
		{ id: 'compress', label: '压缩' }
	]

	return (
		<motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: INIT_DELAY }} className='max-sm:px-4'>
			<SessionOverview result={result} onClear={onExit} onFile={onFile} backToTimeline={backToTimeline} />

			{warnings > 0 && <div className='mt-4 flex items-start gap-2 border-l-2 border-amber-400 bg-amber-400/5 px-3 py-2 text-xs text-amber-700'>
				<AlertTriangle size={15} className='mt-0.5 shrink-0' />
				<span>解析时发现 {warnings} 个需要注意的问题；无法确认的内容没有计入关键命令或文件修改。</span>
			</div>}

			<nav className='mt-6 flex gap-1 overflow-x-auto border-b border-border' aria-label='Session 审计视图'>
				{tabs.map(item => <button key={item.id} type='button' onClick={() => { setTab(item.id); setSelection(null); if (item.id === 'compress') setCompressionOpened(true) }} className={`relative shrink-0 px-4 py-3 text-xs font-medium transition ${tab === item.id ? 'text-brand' : 'text-secondary hover:text-primary'}`}>
					{item.label}{item.count !== undefined && <span className='ml-1.5 text-[10px] opacity-70'>{item.count.toLocaleString('zh-CN')}</span>}
					{tab === item.id && <span className='bg-brand absolute inset-x-2 bottom-0 h-0.5 rounded-full' />}
				</button>)}
			</nav>

			<div className={selection ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.62fr)] lg:items-start lg:gap-5' : undefined}>
				<section className='mt-5 min-w-0'>
					{tab === 'activity' && <ActivityView activity={result.activity} onSelect={setSelection} />}
					{tab === 'commands' && <CommandsView processes={result.processes} onSelect={setSelection} />}
					{tab === 'files' && <FilesView audit={result.fileAudit} onSelect={setSelection} />}
					{tab === 'token' && <TokenView usage={result.tokenUsage} performance={summarizePerformance(result.performance.turns)} onSelect={setSelection} />}
					{compressionOpened && <div className={tab === 'compress' ? undefined : 'hidden'}><CompressionView file={file} /></div>}
				</section>

				{selection && <DetailPanel selection={selection} onClose={() => setSelection(null)} />}
			</div>
		</motion.div>
	)
}
