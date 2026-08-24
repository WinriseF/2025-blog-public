import type { CommandCategory, EventStatus, FileChangeOperation, ParsedCommand, ProcessRun, ShellDialect, ToolActivityCategory } from '@/lib/codex-session/types'

export const categoryLabels: Record<CommandCategory, string> = {
	git: 'Git',
	docker: 'Docker',
	package: '包管理',
	build: '构建',
	runtime: '运行时',
	search: '搜索',
	file: '文件',
	network: '网络',
	system: '系统',
	other: '其他'
}

export const toolCategoryLabels: Record<ToolActivityCategory, string> = {
	shell: 'Shell',
	file: '文件',
	web: '联网',
	mcp: 'MCP',
	planning: '计划',
	interaction: '用户交互',
	collaboration: '协作',
	other: '其他'
}

export const dialectLabels: Record<ShellDialect, string> = {
	powershell: 'PowerShell',
	bash: 'Bash',
	cmd: 'CMD',
	generic: '通用 Shell'
}

export const statusLabels: Record<EventStatus, string> = {
	pending: '等待结果',
	running: '运行中',
	completed: '已完成',
	failed: '失败',
	interrupted: '已中断',
	unknown: '结果未知'
}

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

export function formatCompactNumber(value: number | undefined) {
	if (value === undefined) return '不可用'
	const absolute = Math.abs(value)
	const unit = absolute >= 999_500 ? { divisor: 1_000_000, suffix: 'M' } : absolute >= 1000 ? { divisor: 1000, suffix: 'K' } : undefined
	if (!unit) return formatNumber(value)
	const scaled = value / unit.divisor
	const digits = Math.abs(scaled) < 10 ? 2 : Math.abs(scaled) < 100 ? 1 : 0
	return `${Number(scaled.toFixed(digits))}${unit.suffix}`
}

export function formatPercent(value: number | undefined, digits = 1) {
	return value === undefined ? '不可用' : `${(value * 100).toFixed(digits)}%`
}

export function formatDurationMs(value: number | undefined) {
	if (value === undefined) return '不可用'
	if (value < 1000) return `${Math.round(value)} ms`
	if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`
	if (value < 3_600_000) return `${(value / 60_000).toFixed(1)} 分`
	return `${(value / 3_600_000).toFixed(1)} 小时`
}

export function executionLabel(process: ProcessRun) {
	return process.executionMode === 'argv' ? '直接执行' : dialectLabels[process.analysis?.dialect ?? 'generic']
}

export function batchStatusLabel(status: EventStatus) {
	const label = statusLabels[status]
	return label.startsWith('批次') ? label : `批次${label}`
}

export function commandIdentity(command: ParsedCommand) {
	return command.subcommand ? `${command.name} ${command.subcommand}` : command.name
}

export function commandContexts(command: ParsedCommand) {
	return [command.inLoop && '循环内', command.conditional && '条件内', command.inPipeline && '管道内', command.depth > 0 && '嵌套 Shell'].filter((value): value is string => Boolean(value))
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
