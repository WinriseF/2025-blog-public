import type { CommandCategory, EventStatus, ParsedCommand, ProcessRun, ShellDialect } from '@/lib/codex-session/types'

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
