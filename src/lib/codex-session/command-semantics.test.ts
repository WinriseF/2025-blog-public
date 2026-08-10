import { describe, expect, it } from 'vitest'
import { commandSignature, commandSubcommand, commandSummary, isAuditCommand, normalizeCommandName, tokenizeCommand } from './command-semantics'

describe('command semantics', () => {
	it('保留引号参数并提取 Git 子命令', () => {
		const tokens = tokenizeCommand('git diff -- "src/file with space.ts"', 'powershell')
		expect(tokens.map(token => token.value)).toEqual(['git', 'diff', '--', 'src/file with space.ts'])
		expect(commandSubcommand('git', tokens, 0)).toBe('diff')
		expect(commandSummary('git', 'diff')).toBe('查看代码差异')
	})

	it('归一化可执行文件路径和扩展名', () => {
		expect(normalizeCommandName('"C:\\Program Files\\Git\\bin\\git.exe"')).toBe('git')
	})

	it('只把用户关心的实际执行命令纳入审计', () => {
		for (const [normalizedName, category] of [['git', 'git'], ['docker', 'docker'], ['pnpm', 'package'], ['cargo', 'build'], ['node', 'runtime']] as const)
			expect(isAuditCommand({ normalizedName, category })).toBe(true)
		for (const [normalizedName, category] of [['rg', 'search'], ['get-content', 'file'], ['ls', 'file'], ['write-output', 'system']] as const)
			expect(isAuditCommand({ normalizedName, category })).toBe(false)
	})

	it('生成用于频次统计的稳定命令签名', () => {
		expect(commandSignature({ normalizedName: 'pnpm', subcommand: 'run build' })).toBe('pnpm run build')
	})
})
