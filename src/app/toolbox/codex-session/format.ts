import type { FileChangeOperation } from '@/lib/codex-session/types'

export const fileOperationLabels: Record<FileChangeOperation, string> = {
	create: '新增',
	modify: '修改',
	move: '移动',
	delete: '删除'
}

export function formatBytes(value: number) {
	if (value < 1024) return `${value} B`
	if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
	if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
	return `${(value / 1024 ** 3).toFixed(1)} GiB`
}

export function formatNumber(value: number | undefined) {
	return value === undefined ? '不可用' : new Intl.NumberFormat('zh-CN').format(value)
}

export function formatLineChanges(additions: number, deletions: number) {
	return [additions > 0 ? `+${formatNumber(additions)}` : '', deletions > 0 ? `-${formatNumber(deletions)}` : ''].filter(Boolean).join(' / ') || '无可统计行数'
}

export function formatDate(value: string | undefined) {
	if (!value) return '未知时间'
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
}

export function compactText(value: string | undefined, length = 220) {
	if (!value) return ''
	const normalized = value.trim()
	return normalized.length > length ? `${normalized.slice(0, length)}…` : normalized
}
