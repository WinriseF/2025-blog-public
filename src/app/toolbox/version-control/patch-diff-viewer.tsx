'use client'

import { useMemo } from 'react'

type DiffLine = {
	kind: 'context' | 'add' | 'delete' | 'meta'
	text: string
	oldLine?: number
	newLine?: number
}

type DiffBlock = { omittedOld: number; omittedNew: number } | { lines: DiffLine[] }

export function PatchDiffViewer({ patch, sideBySide }: { patch: string | null; sideBySide: boolean }) {
	const blocks = useMemo(() => parsePatch(patch || ''), [patch])
	if (patch === null) return <Loading />
	if (!blocks.length) {
		return <div className='text-secondary flex h-full items-center justify-center text-xs'>仅包含属性变更，或没有可显示的文本 Patch。</div>
	}
	return (
		<div className='bg-background h-full overflow-auto font-mono text-[12px] leading-5'>
			<table className='w-full min-w-max border-collapse'>
				<tbody>{sideBySide ? <SplitRows blocks={blocks} /> : <UnifiedRows blocks={blocks} />}</tbody>
			</table>
		</div>
	)
}

function UnifiedRows({ blocks }: { blocks: DiffBlock[] }) {
	return blocks.map((block, index) => {
		if ('omittedOld' in block) return <Omitted key={`o-${index}`} count={Math.max(block.omittedOld, block.omittedNew)} columns={4} />
		return block.lines.map((line, lineIndex) => (
			<tr key={`${index}-${lineIndex}`} className={rowTone(line.kind)}>
				<LineNumber value={line.oldLine} />
				<LineNumber value={line.newLine} />
				<td className='text-secondary w-6 select-none px-1 text-center'>{prefix(line.kind)}</td>
				<Code text={line.text} />
			</tr>
		))
	})
}

function SplitRows({ blocks }: { blocks: DiffBlock[] }) {
	return blocks.map((block, index) => {
		if ('omittedOld' in block) return <Omitted key={`o-${index}`} count={Math.max(block.omittedOld, block.omittedNew)} columns={2} />
		return pairLines(block.lines).map((row, lineIndex) => (
			<tr key={`${index}-${lineIndex}`}>
				<Side line={row.left} />
				<Side line={row.right} right />
			</tr>
		))
	})
}

function Side({ line, right = false }: { line?: DiffLine; right?: boolean }) {
	return (
		<>
			<td className={`${rowTone(line?.kind)} ${right ? 'border-border border-l' : ''} min-w-[50vw] p-0 align-top`}>
				<div className='grid grid-cols-[3.5rem_1.5rem_minmax(20rem,1fr)]'>
					<span className='border-border/50 text-secondary select-none border-r px-2 text-right tabular-nums'>{(right ? line?.newLine : line?.oldLine) ?? ''}</span>
					<span className='text-secondary select-none text-center'>{line ? prefix(line.kind) : ''}</span>
					<span className='whitespace-pre px-2 [tab-size:4]'>{line?.text || ' '}</span>
				</div>
			</td>
		</>
	)
}

function LineNumber({ value }: { value?: number }) {
	return <td className='border-border/50 text-secondary w-14 select-none border-r px-2 text-right tabular-nums'>{value ?? ''}</td>
}

function Code({ text }: { text: string }) {
	return <td className='whitespace-pre px-2 align-top [tab-size:4]'>{text || ' '}</td>
}

function Omitted({ count, columns }: { count: number; columns: number }) {
	return (
		<tr className='bg-article text-secondary border-border border-y'>
			<td colSpan={columns} className='h-9 px-8'>
				{count} 行未修改
			</td>
		</tr>
	)
}

function parsePatch(patch: string): DiffBlock[] {
	const lines = patch.replaceAll('\r\n', '\n').split('\n')
	const blocks: DiffBlock[] = []
	let previousOld = 1
	let previousNew = 1
	let index = 0
	while (index < lines.length) {
		const match = lines[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
		if (!match) {
			index++
			continue
		}
		let oldLine = Number(match[1])
		let newLine = Number(match[3])
		const omittedOld = Math.max(0, oldLine - previousOld)
		const omittedNew = Math.max(0, newLine - previousNew)
		if (omittedOld || omittedNew) blocks.push({ omittedOld, omittedNew })
		const hunk: DiffLine[] = []
		index++
		while (index < lines.length && !lines[index].startsWith('@@ ') && !lines[index].startsWith('Property changes on:')) {
			const raw = lines[index]
			if (raw.startsWith('+')) hunk.push({ kind: 'add', text: raw.slice(1), newLine: newLine++ })
			else if (raw.startsWith('-')) hunk.push({ kind: 'delete', text: raw.slice(1), oldLine: oldLine++ })
			else if (raw.startsWith(' ')) hunk.push({ kind: 'context', text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ })
			else if (raw.startsWith('\\')) hunk.push({ kind: 'meta', text: raw })
			else break
			index++
		}
		blocks.push({ lines: hunk })
		previousOld = oldLine
		previousNew = newLine
	}
	return blocks
}

function pairLines(lines: DiffLine[]) {
	const rows: Array<{ left?: DiffLine; right?: DiffLine }> = []
	let index = 0
	while (index < lines.length) {
		const line = lines[index]
		if (line.kind === 'context' || line.kind === 'meta') {
			rows.push({ left: line, right: line })
			index++
			continue
		}
		const changed: DiffLine[] = []
		while (index < lines.length && lines[index].kind !== 'context' && lines[index].kind !== 'meta') changed.push(lines[index++])
		const deleted = changed.filter(item => item.kind === 'delete')
		const added = changed.filter(item => item.kind === 'add')
		for (let offset = 0; offset < Math.max(deleted.length, added.length); offset++) rows.push({ left: deleted[offset], right: added[offset] })
	}
	return rows
}

function prefix(kind?: DiffLine['kind']) {
	return kind === 'add' ? '+' : kind === 'delete' ? '−' : kind === 'meta' ? '\\' : ' '
}

function rowTone(kind?: DiffLine['kind']) {
	if (kind === 'add') return 'bg-emerald-500/15 text-primary'
	if (kind === 'delete') return 'bg-red-500/15 text-primary'
	if (kind === 'meta') return 'text-secondary italic'
	return 'text-primary'
}

function Loading() {
	return <div className='bg-article text-secondary flex h-full items-center justify-center text-xs'>正在读取缓存 Patch…</div>
}
