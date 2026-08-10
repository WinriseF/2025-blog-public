import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyzeShellProcesses } from '../../src/lib/codex-session/shell-analysis'
import type { ProcessRun } from '../../src/lib/codex-session/types'

const wasmBase = pathToFileURL(`${resolve('public/wasm/codex-session')}${sep}`).href

function process(command: string, shellHint?: string): ProcessRun {
	return { id: `process-${command}`, sequence: 1, command, shellHint, status: 'completed', continuationCallIds: [], sourceRefs: [] }
}

describe('analyzeShellProcesses', () => {
	it('解析 PowerShell 循环、Docker 包装器和内层 Bash', async () => {
		const item = process('$files=@("a","b"); foreach($file in $files){ git diff -- "$file" }; docker compose exec app sh -lc "git status"', 'powershell')
		await analyzeShellProcesses([item], wasmBase)

		expect(item.analysis?.commands.map(command => [command.category, command.subcommand])).toEqual([
			['git', 'diff'],
			['docker', 'compose exec'],
			['git', 'status']
		])
		expect(item.analysis?.commands[0]).toMatchObject({ inLoop: true, confidence: 'confirmed' })
		expect(item.analysis?.commands[2]).toMatchObject({ depth: 1, confidence: 'confirmed' })
	})

	it('对语法包未覆盖的合法参数使用已确认回退', async () => {
		const item = process('git diff -- src/a.ts src/b.ts src/c.ts', 'powershell')
		await analyzeShellProcesses([item], wasmBase)
		expect(item.analysis?.commands).toEqual([expect.objectContaining({ category: 'git', subcommand: 'diff', confidence: 'confirmed' })])
	})

	it('未闭合字符串只保留引号前可证明的命令', async () => {
		const item = process('rg -n "unterminated; git status', 'powershell')
		await analyzeShellProcesses([item], wasmBase)
		expect(item.analysis?.structuralIssue).toBe('字符串引号未闭合')
		expect(item.analysis?.commands.map(command => command.normalizedName)).toEqual(['rg'])
		expect(item.analysis?.commands[0].confidence).toBe('partial')
	})

	it('保守回退不会把普通参数误认成 Git 命令', async () => {
		const item = process('echo git status; rg -n "unterminated', 'powershell')
		await analyzeShellProcesses([item], wasmBase)
		expect(item.analysis?.commands.map(command => command.normalizedName)).toEqual(['rg'])
	})

	it('直接 argv 中的 Shell 元字符仍属于同一个参数', async () => {
		const item = process('git commit -m "fix; docker ps"')
		item.argv = ['git', 'commit', '-m', 'fix; docker ps']
		item.executionMode = 'argv'
		await analyzeShellProcesses([item], wasmBase)
		expect(item.analysis?.commands.map(command => [command.category, command.subcommand])).toEqual([['git', 'commit']])
	})

	it('按显式提示解析 Bash 和 CMD', async () => {
		const bash = process('git status && docker ps', 'bash')
		const cmd = process('git status & docker ps', 'cmd')
		await analyzeShellProcesses([bash, cmd], wasmBase)
		expect(bash.analysis?.commands.map(command => command.category)).toEqual(['git', 'docker'])
		expect(cmd.analysis?.commands.map(command => command.category)).toEqual(['git', 'docker'])
	})
})
