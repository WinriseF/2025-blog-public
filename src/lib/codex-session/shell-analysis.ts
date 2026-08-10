import { Language, Parser, type Node as SyntaxNode } from 'web-tree-sitter'
import { commandCategory, commandSubcommand, commandSummary, normalizeCommandName, tokenizeCommand, type CommandToken } from './command-semantics'
import type { ParsedCommand, ProcessRun, ShellAnalysis, ShellDialect } from './types'

type ParserDialect = Exclude<ShellDialect, 'generic'>
type NodeContext = Pick<ParsedCommand, 'inLoop' | 'conditional' | 'inPipeline'>
type Counter = { value: number }

const GRAMMAR_FILES: Record<ParserDialect, string> = {
	powershell: 'tree-sitter-pwsh.wasm',
	bash: 'tree-sitter-bash.wasm',
	cmd: 'tree-sitter-batch.wasm'
}

const LOOP_NODES = new Set(['for_statement', 'foreach_statement', 'while_statement', 'do_statement', 'until_statement', 'for_stmt'])
const CONDITIONAL_NODES = new Set(['if_statement', 'switch_statement', 'case_statement', 'conditional_expression', 'if_stmt', 'else_clause', 'cond_exec', 'try_statement'])
const languages = new Map<string, Promise<Language>>()
let runtime: Promise<void> | undefined

function assetLocation(name: string, baseUrl: string) {
	const url = new URL(name, baseUrl)
	if (url.protocol !== 'file:') return url.href
	return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, '$1')
}

function ensureRuntime(baseUrl: string) {
	runtime ??= Parser.init({ locateFile: () => assetLocation('web-tree-sitter.wasm', baseUrl) })
	return runtime
}

async function loadLanguage(dialect: ParserDialect, baseUrl: string) {
	await ensureRuntime(baseUrl)
	const key = `${baseUrl}:${dialect}`
	let pending = languages.get(key)
	if (!pending) {
		pending = Language.load(assetLocation(GRAMMAR_FILES[dialect], baseUrl))
		languages.set(key, pending)
	}
	return pending
}

function explicitDialect(value: string | undefined): ParserDialect | undefined {
	const normalized = value?.toLowerCase()
	if (!normalized) return
	if (/powershell|pwsh/.test(normalized)) return 'powershell'
	if (/cmd|batch/.test(normalized)) return 'cmd'
	if (/bash|zsh|sh/.test(normalized)) return 'bash'
}

function maskQuoted(source: string) {
	let masked = ''
	let quote = ''
	let escaped = false
	for (const char of source) {
		if (escaped) {
			masked += ' '
			escaped = false
			continue
		}
		if (quote) {
			if (char === quote) quote = ''
			else if (char === '\\' || char === '`' || char === '^') escaped = true
			masked += ' '
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			masked += ' '
			continue
		}
		masked += char
	}
	return masked
}

function dialectScores(source: string) {
	const syntax = maskQuoted(source)
	return {
		powershell:
			(/\b(?:Get|Set|New|Remove|Write|Select|Where|ForEach|Sort|Measure|Format|Test|Join|Resolve|Start|Stop|Invoke)-[A-Za-z]/.test(syntax) ? 5 : 0) +
			(/\$[A-Za-z_][\w:]*\s*=|\[pscustomobject\]|@\(|-ErrorAction\b|\|\s*%\s*\{/.test(syntax) ? 3 : 0) +
			(/`[nr]|\$null\b|\$_\b/.test(syntax) ? 2 : 0),
		bash:
			(/^#!.*\b(?:ba|z|k)?sh\b/m.test(syntax) ? 6 : 0) +
			(/\b(?:then|fi|done|do|elif|export|source)\b|\[\[|\$\{|\$\(/.test(syntax) ? 3 : 0) +
			(/(?:^|[;\s])(?:set -[a-z]*[eux]|[A-Za-z_][A-Za-z0-9_]*=)|\/dev\/null/.test(syntax) ? 2 : 0),
		cmd:
			(/%[^%\r\n]+%|![^!\r\n]+!|%%[A-Za-z]/.test(syntax) ? 4 : 0) +
			(/\b(?:setlocal|endlocal|goto|call|errorlevel)\b|\bfor\s+\/[fdlr]\b/i.test(syntax) ? 4 : 0) +
			(/^\s*@?echo\s+off\b/im.test(syntax) ? 3 : 0)
	}
}

function strongestDialect(source: string) {
	const scores = dialectScores(source)
	const entries = Object.entries(scores) as Array<[ParserDialect, number]>
	const [dialect, score] = entries.sort((left, right) => right[1] - left[1])[0]
	return score > 0 ? { dialect, score } : undefined
}

function sessionDialect(processes: ProcessRun[]): ParserDialect {
	const totals = { powershell: 0, bash: 0, cmd: 0 }
	for (const process of processes) {
		const hint = explicitDialect(process.shellHint)
		if (hint) totals[hint] += 20
		const scores = dialectScores(process.command)
		for (const dialect of Object.keys(totals) as ParserDialect[]) totals[dialect] += scores[dialect]
	}
	return (Object.entries(totals) as Array<[ParserDialect, number]>).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'bash'
}

function processDialect(process: ProcessRun, preferred: ParserDialect): { label: ShellDialect; parser: ParserDialect } {
	const hinted = explicitDialect(process.shellHint)
	if (hinted) return { label: hinted, parser: hinted }
	const detected = strongestDialect(process.command)
	if (detected && detected.score >= 3) return { label: detected.dialect, parser: detected.dialect }
	return { label: 'generic', parser: preferred }
}

function countErrors(node: SyntaxNode): number {
	let count = node.isError || node.isMissing ? 1 : 0
	for (const child of node.children) count += countErrors(child)
	return count
}

function commandTypes(dialect: ParserDialect) {
	return dialect === 'cmd' ? ['cmd'] : ['command']
}

function nodeContext(node: SyntaxNode, dialect: ParserDialect, inherited?: NodeContext): NodeContext {
	let inLoop = inherited?.inLoop ?? false
	let conditional = inherited?.conditional ?? false
	let inPipeline = inherited?.inPipeline ?? false
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (LOOP_NODES.has(parent.type)) inLoop = true
		if (CONDITIONAL_NODES.has(parent.type)) conditional = true
		if ((parent.type === 'pipeline' || parent.type === 'pipe_stmt') && parent.descendantsOfType(commandTypes(dialect)).length > 1) inPipeline = true
	}
	return { inLoop, conditional, inPipeline }
}

function nameNode(node: SyntaxNode, dialect: ParserDialect) {
	if (dialect === 'powershell') return node.childForFieldName('command_name')
	if (dialect === 'bash') return node.childForFieldName('name')
	return node.namedChildren.find(child => child.type === 'command_name') ?? null
}

function commandIndex(tokens: CommandToken[], normalizedName: string) {
	const index = tokens.findIndex(token => normalizeCommandName(token.value) === normalizedName)
	return index >= 0 ? index : 0
}

function parsedCommand(node: SyntaxNode, dialect: ParserDialect, processId: string, depth: number, parentId: string | undefined, counter: Counter, partial: boolean, inherited?: NodeContext): ParsedCommand | undefined {
	const raw = node.text.trim()
	const tokens = tokenizeCommand(raw, dialect)
	const rawName = nameNode(node, dialect)?.text ?? tokens[0]?.value
	if (!rawName) return
	const normalizedName = normalizeCommandName(rawName)
	const index = commandIndex(tokens, normalizedName)
	const dynamic = tokens[index]?.dynamic || /\$|%[^%]+%|![^!]+!/.test(rawName)
	const subcommand = dynamic ? undefined : commandSubcommand(normalizedName, tokens, index)
	const context = nodeContext(node, dialect, inherited)
	return {
		id: `${processId}:command:${counter.value++}`,
		name: rawName.replace(/^['"]|['"]$/g, ''),
		normalizedName,
		subcommand,
		category: commandCategory(normalizedName),
		summary: dynamic ? '运行动态命令' : commandSummary(normalizedName, subcommand),
		raw,
		start: node.startIndex,
		end: node.endIndex,
		depth,
		parentId,
		confidence: partial || dynamic ? 'partial' : 'confirmed',
		...context
	}
}

type CommandFragment = { source: string; start: number; inPipeline: boolean }

function commandFragments(source: string, dialect: ParserDialect) {
	const fragments: CommandFragment[] = []
	let start = 0
	let quote = ''
	let escaped = false
	let nextPipeline = false
	const push = (end: number, pipeline = false) => {
		const raw = source.slice(start, end)
		const leading = raw.search(/\S/)
		if (leading >= 0) fragments.push({ source: raw.trim(), start: start + leading, inPipeline: nextPipeline || pipeline })
		nextPipeline = pipeline
	}
	for (let index = 0; index < source.length; index++) {
		const char = source[index]
		if (escaped) {
			escaped = false
			continue
		}
		if (quote) {
			if (char === quote) quote = ''
			else if ((dialect === 'powershell' && char === '`') || (dialect === 'bash' && char === '\\') || (dialect === 'cmd' && char === '^')) escaped = true
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (char === '#' && dialect !== 'cmd') {
			push(index)
			const newline = source.indexOf('\n', index)
			if (newline < 0) return fragments
			start = newline + 1
			index = newline
			continue
		}
		const pair = source.slice(index, index + 2)
		const pipeline = char === '|' && pair !== '||'
		const separator = char === ';' || char === '\n' || char === '\r' || char === '{' || char === '}' || pipeline || pair === '&&' || pair === '||' || (char === '&' && dialect !== 'powershell')
		if (!separator) continue
		push(index, pipeline)
		if (pair === '&&' || pair === '||') index++
		start = index + 1
	}
	push(source.length)
	return fragments
}

function structuralIssue(source: string, dialect: ParserDialect) {
	const stack: string[] = []
	let quote = ''
	let escaped = false
	let previous = ''
	const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
	for (let index = 0; index < source.length; index++) {
		const char = source[index]
		if (escaped) {
			escaped = false
			continue
		}
		if (quote) {
			if (char === quote) quote = ''
			else if ((dialect === 'powershell' && char === '`') || (dialect === 'bash' && char === '\\') || (dialect === 'cmd' && char === '^')) escaped = true
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (char === '#' && dialect !== 'cmd') {
			const newline = source.indexOf('\n', index)
			if (newline < 0) break
			index = newline
			continue
		}
		if ('([{'.includes(char)) stack.push(char)
		else if (pairs[char] && stack.pop() !== pairs[char]) return '括号或脚本块不完整'
		if (source.slice(index, index + 2) === '||') {
			previous = '|'
			index++
			continue
		}
		if (char === '|' && source[index + 1] !== '|' && (!previous || ';|{}'.includes(previous))) return '管道缺少输入命令'
		if (!/\s/.test(char)) previous = char
	}
	if (quote) return '字符串引号未闭合'
	if (stack.length) return '括号或脚本块未闭合'
}

function fallbackKnownCommands(source: string, dialect: ParserDialect, processId: string, depth: number, parentId: string | undefined, counter: Counter, confidence: ParsedCommand['confidence'], inherited?: NodeContext) {
	const commands: ParsedCommand[] = []
	for (const fragment of commandFragments(source, dialect)) {
		const tokens = tokenizeCommand(fragment.source, dialect)
		const candidate = (index: number, value = tokens[index]?.value, offset = 0) => {
			const token = tokens[index]
			if (!token || !value) return
			const category = commandCategory(normalizeCommandName(value))
			return category === 'other' ? undefined : { token, index, value, offset, category, dynamic: offset ? /\$|%[^%]+%|![^!]+!/.test(value) : token.dynamic }
		}
		let recognized = candidate(0)
		const assignment = dialect === 'powershell' ? tokens[0]?.value.match(/^\$[A-Za-z_][\w:]*=(.+)$/)?.[1] : undefined
		if (!recognized && assignment) recognized = candidate(0, assignment, tokens[0].raw.lastIndexOf('=') + 1)
		if (!recognized && dialect === 'powershell' && /^\$[A-Za-z_][\w:]*$/.test(tokens[0]?.value ?? '') && tokens[1]?.value === '=') recognized = candidate(2)
		if (!recognized && dialect === 'bash') {
			let index = 0
			while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]?.value ?? '')) index++
			if (index) recognized = candidate(index)
		}
		if (!recognized && ['&', '.'].includes(tokens[0]?.value ?? '')) recognized = candidate(1)
		if (!recognized && ['command', 'exec', 'nohup', 'time'].includes(normalizeCommandName(tokens[0]?.value ?? ''))) {
			let index = 1
			while (tokens[index]?.value.startsWith('-')) index++
			recognized = candidate(index)
		}
		if (!recognized && normalizeCommandName(tokens[0]?.value ?? '') === 'env') {
			let index = 1
			while (tokens[index] && (tokens[index].value.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index].value))) index++
			recognized = candidate(index)
		}
		if (!recognized) continue
		const { token, value } = recognized
		const normalizedName = normalizeCommandName(value)
		const rawOffset = fragment.source.indexOf(token.raw) + recognized.offset
		const raw = fragment.source.slice(Math.max(rawOffset, 0)).trim()
		const commandTokens = tokenizeCommand(raw, dialect)
		const subcommand = recognized.dynamic ? undefined : commandSubcommand(normalizedName, commandTokens, 0)
		commands.push({
			id: `${processId}:command:${counter.value++}`,
			name: value,
			normalizedName,
			subcommand,
			category: commandCategory(normalizedName),
			summary: recognized.dynamic ? '运行动态命令' : commandSummary(normalizedName, subcommand),
			raw,
			start: fragment.start + Math.max(rawOffset, 0),
			end: fragment.start + fragment.source.length,
			depth,
			parentId,
			confidence,
			inLoop: inherited?.inLoop ?? false,
			conditional: inherited?.conditional ?? false,
			inPipeline: inherited?.inPipeline || fragment.inPipeline
		})
	}
	return commands
}

function shellFlag(name: string, tokens: CommandToken[], start: number) {
	if (name === 'cmd') return tokens.findIndex((token, index) => index > start && /^\/(?:c|k)$/i.test(token.value))
	if (name === 'powershell' || name === 'pwsh') return tokens.findIndex((token, index) => index > start && /^-(?:c|command|encodedcommand|enc)$/i.test(token.value))
	return tokens.findIndex((token, index) => index > start && /^-[a-z]*c[a-z]*$/i.test(token.value))
}

function decodePowerShell(value: string) {
	try {
		const binary = atob(value)
		let decoded = ''
		for (let index = 0; index + 1 < binary.length; index += 2) decoded += String.fromCharCode(binary.charCodeAt(index) | (binary.charCodeAt(index + 1) << 8))
		return decoded
	} catch {
		return undefined
	}
}

function nestedShell(tokens: CommandToken[], commandName: string, commandIndexValue: number, subcommand?: string) {
	let shellIndex = commandIndexValue
	let shellName = commandName
	if (commandName === 'docker' && /^(?:compose )?(?:exec|run)$/.test(subcommand ?? '')) {
		shellIndex = tokens.findIndex((token, index) => index > commandIndexValue && ['bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd'].includes(normalizeCommandName(token.value)))
		if (shellIndex < 0) return
		shellName = normalizeCommandName(tokens[shellIndex].value)
	}
	if (commandName === 'wsl') {
		shellIndex = tokens.findIndex((token, index) => index > commandIndexValue && ['bash', 'sh', 'zsh'].includes(normalizeCommandName(token.value)))
		if (shellIndex < 0) return
		shellName = normalizeCommandName(tokens[shellIndex].value)
	}
	if (!['bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd'].includes(shellName)) return
	const flagIndex = shellFlag(shellName, tokens, shellIndex)
	if (flagIndex < 0 || !tokens[flagIndex + 1] || tokens[flagIndex + 1].dynamic) return
	const encoded = /^-(?:encodedcommand|enc)$/i.test(tokens[flagIndex].value)
	const source = encoded ? decodePowerShell(tokens[flagIndex + 1].value) : tokens.slice(flagIndex + 1).map(token => token.value).join(' ')
	if (!source?.trim()) return
	const dialect: ParserDialect = shellName === 'cmd' ? 'cmd' : shellName === 'pwsh' || shellName === 'powershell' ? 'powershell' : 'bash'
	return { source, dialect }
}

async function extractScript(options: {
	source: string
	dialect: ParserDialect
	displayDialect: ShellDialect
	baseUrl: string
	processId: string
	depth: number
	parentId?: string
	counter: Counter
	parsers: Map<ParserDialect, Parser>
	inherited?: NodeContext
}): Promise<{ commands: ParsedCommand[]; errorCount: number; notes: string[]; structuralIssue?: string }> {
	let parser = options.parsers.get(options.dialect)
	if (!parser) {
		const language = await loadLanguage(options.dialect, options.baseUrl)
		parser = new Parser()
		parser.setLanguage(language)
		options.parsers.set(options.dialect, parser)
	}
	const tree = parser.parse(options.source)
	if (!tree) return { commands: [], errorCount: 1, notes: ['Shell 语法树生成失败'] }
	try {
		const root = tree.rootNode
		let errorCount = countErrors(root)
		const partial = root.hasError || errorCount > 0
		const issue = partial ? structuralIssue(options.source, options.dialect) : undefined
		const label = options.displayDialect === 'generic' ? options.dialect : options.displayDialect
		const notes = partial ? [issue ? `${label} 脚本结构异常：${issue}` : `${label} 语法包未覆盖部分写法，已用安全分词补充已知命令`] : []
		const commands: ParsedCommand[] = partial ? fallbackKnownCommands(options.source, options.dialect, options.processId, options.depth, options.parentId, options.counter, issue ? 'partial' : 'confirmed', options.inherited) : []
		if (partial) return { commands, errorCount: Math.max(errorCount, 1), notes, structuralIssue: issue }
		let nestedStructuralIssue: string | undefined
		for (const node of root.descendantsOfType(commandTypes(options.dialect)).sort((left, right) => left.startIndex - right.startIndex)) {
			const command = parsedCommand(node, options.dialect, options.processId, options.depth, options.parentId, options.counter, partial, options.inherited)
			if (!command) continue
			commands.push(command)
			if (partial || options.depth >= 3) continue
			const tokens = tokenizeCommand(command.raw, options.dialect)
			const nested = nestedShell(tokens, command.normalizedName, commandIndex(tokens, command.normalizedName), command.subcommand)
			if (!nested) continue
			const children = await extractScript({
				...options,
				source: nested.source,
				dialect: nested.dialect,
				displayDialect: nested.dialect,
				depth: options.depth + 1,
				parentId: command.id,
				inherited: { inLoop: command.inLoop, conditional: command.conditional, inPipeline: command.inPipeline }
			})
			commands.push(...children.commands)
			notes.push(...children.notes)
			errorCount += children.errorCount
			nestedStructuralIssue ??= children.structuralIssue
		}
		return { commands, errorCount, notes, structuralIssue: nestedStructuralIssue }
	} finally {
		tree.delete()
	}
}

function directTokens(process: ProcessRun): CommandToken[] {
	if (process.argv?.length) return process.argv.map(value => ({ value, raw: value, quoted: /\s/.test(value), dynamic: false }))
	return tokenizeCommand(process.command, 'bash').map(token => ({ ...token, dynamic: false }))
}

async function analyzeDirectProcess(process: ProcessRun, baseUrl: string, parsers: Map<ParserDialect, Parser>): Promise<ShellAnalysis> {
	const tokens = directTokens(process)
	const rawName = tokens[0]?.value
	if (!rawName) return { dialect: 'generic', status: 'opaque', commands: [], errorCount: 1, notes: ['直接执行参数为空'] }
	const normalizedName = normalizeCommandName(rawName)
	const subcommand = commandSubcommand(normalizedName, tokens, 0)
	const root: ParsedCommand = {
		id: `${process.id}:command:0`,
		name: rawName,
		normalizedName,
		subcommand,
		category: commandCategory(normalizedName),
		summary: commandSummary(normalizedName, subcommand),
		raw: process.command,
		start: 0,
		end: process.command.length,
		depth: 0,
		confidence: 'confirmed',
		inLoop: false,
		conditional: false,
		inPipeline: false
	}
	const nested = nestedShell(tokens, normalizedName, 0, subcommand)
	if (!nested) return { dialect: 'generic', status: 'complete', commands: [root], errorCount: 0, notes: [] }
	try {
		const children = await extractScript({
			source: nested.source,
			dialect: nested.dialect,
			displayDialect: nested.dialect,
			baseUrl,
			processId: process.id,
			depth: 1,
			parentId: root.id,
			counter: { value: 1 },
			parsers,
			inherited: { inLoop: false, conditional: false, inPipeline: false }
		})
		return {
			dialect: 'generic',
			status: children.errorCount ? 'partial' : 'complete',
			commands: [root, ...children.commands],
			errorCount: children.errorCount,
			structuralIssue: children.structuralIssue,
			notes: [...new Set(children.notes)]
		}
	} catch (error) {
		return {
			dialect: 'generic',
			status: 'partial',
			commands: [root],
			errorCount: 1,
			notes: [`嵌套 Shell AST 解析不可用：${error instanceof Error ? error.message : '未知错误'}`]
		}
	}
}

function fallbackAnalysis(process: ProcessRun, dialect: ShellDialect, message: string): ShellAnalysis {
	const parserDialect: ParserDialect = dialect === 'generic' ? 'bash' : dialect
	const tokens = tokenizeCommand(process.command, parserDialect)
	const complex = /[\r\n;|&{}()]/.test(process.command)
	const rawName = tokens[0]?.value
	if (!rawName || complex) return { dialect, status: 'opaque', commands: [], errorCount: 1, notes: [message] }
	const normalizedName = normalizeCommandName(rawName)
	const subcommand = commandSubcommand(normalizedName, tokens, 0)
	return {
		dialect,
		status: 'partial',
		errorCount: 1,
		notes: [message],
		commands: [{
			id: `${process.id}:command:0`,
			name: rawName,
			normalizedName,
			subcommand,
			category: commandCategory(normalizedName),
			summary: commandSummary(normalizedName, subcommand),
			raw: process.command,
			start: 0,
			end: process.command.length,
			depth: 0,
			confidence: 'partial',
			inLoop: false,
			conditional: false,
			inPipeline: false
		}]
	}
}

export async function analyzeShellProcesses(processes: ProcessRun[], baseUrl: string, signal?: AbortSignal) {
	const preferred = sessionDialect(processes)
	const parsers = new Map<ParserDialect, Parser>()
	try {
		for (const process of processes) {
			if (signal?.aborted) throw new DOMException('Session 解析已取消', 'AbortError')
			if (process.executionMode === 'argv') {
				process.analysis = await analyzeDirectProcess(process, baseUrl, parsers)
				continue
			}
			const dialect = processDialect(process, preferred)
			try {
				const result = await extractScript({ source: process.command, dialect: dialect.parser, displayDialect: dialect.label, baseUrl, processId: process.id, depth: 0, counter: { value: 0 }, parsers })
				process.analysis = {
					dialect: dialect.label,
					status: result.errorCount ? 'partial' : 'complete',
					commands: result.commands,
					errorCount: result.errorCount,
					structuralIssue: result.structuralIssue,
					notes: [...new Set(result.notes)]
				}
			} catch (error) {
				if (signal?.aborted) throw error
				process.analysis = fallbackAnalysis(process, dialect.label, `Shell AST 解析不可用：${error instanceof Error ? error.message : '未知错误'}`)
			}
		}
	} finally {
		for (const parser of parsers.values()) parser.delete()
	}
}
