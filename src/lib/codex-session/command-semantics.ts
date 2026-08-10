import type { CommandCategory, ShellDialect } from './types'

export type CommandToken = {
	value: string
	raw: string
	quoted: boolean
	dynamic: boolean
}

const PACKAGE_COMMANDS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'uv'])
const BUILD_COMMANDS = new Set(['cargo', 'go', 'dotnet', 'mvn', 'mvnw', 'gradle', 'gradlew', 'make', 'cmake', 'tsc', 'rustc'])
const RUNTIME_COMMANDS = new Set(['node', 'deno', 'python', 'python3', 'py', 'ruby', 'php', 'java'])
const SEARCH_COMMANDS = new Set(['rg', 'grep', 'findstr', 'select-string', 'find'])
const READ_COMMANDS = new Set(['get-content', 'gc', 'cat', 'head', 'tail', 'sed', 'type'])
const FILE_MUTATION_COMMANDS = new Set(['set-content', 'add-content', 'out-file', 'copy-item', 'move-item', 'remove-item', 'new-item', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'rmdir', 'del', 'erase', 'ren', 'rename'])
const FILE_COMMANDS = new Set([...READ_COMMANDS, ...FILE_MUTATION_COMMANDS, 'get-childitem', 'ls', 'dir'])
const NETWORK_COMMANDS = new Set(['curl', 'wget', 'invoke-webrequest', 'invoke-restmethod', 'ssh', 'scp', 'ping', 'netstat', 'get-nettcpconnection', 'get-netipaddress'])
const SYSTEM_COMMANDS = new Set(['pwsh', 'powershell', 'bash', 'sh', 'zsh', 'cmd', 'start-process', 'get-process', 'stop-process', 'taskkill', 'write-output', 'select-object', 'where-object', 'foreach-object', 'sort-object', 'measure-object', 'format-table', 'format-list', 'test-path', 'join-path'])
const INSPECTION_COMMANDS = new Set(['get-childitem', 'ls', 'dir', 'tree', 'pwd', 'get-location', 'test-path', 'where', 'which', 'stat', 'wc'])
const HELPER_COMMANDS = new Set(['write-output', 'echo', 'printf', 'select-object', 'where-object', 'foreach-object', 'sort-object', 'measure-object', 'format-table', 'format-list', 'join-path', 'split-path', 'convertfrom-json', 'convertto-json', 'cd', 'pushd', 'popd', 'set-location', 'sleep', 'start-sleep', 'true', 'false', 'source', '.', 'export', 'set', 'unset', 'alias', 'unalias', 'awk', 'cut', 'tr', 'sort', 'uniq', 'jq', 'tee'])
const SHELL_WRAPPERS = new Set(['pwsh', 'powershell', 'bash', 'sh', 'zsh', 'cmd', 'wsl', 'env', 'command', 'exec', 'nohup', 'time', 'xargs'])
const IMPORTANT_SYSTEM_COMMANDS = new Set(['start-process', 'stop-process', 'taskkill', 'kill', 'killall', 'systemctl', 'service', 'chmod', 'chown', 'winget', 'choco', 'scoop'])
const CONTROL_WORDS = new Set(['if', 'then', 'else', 'elseif', 'fi', 'for', 'foreach', 'while', 'do', 'done', 'case', 'esac', 'function', 'return'])

const GIT_SUMMARIES: Record<string, string> = {
	status: '查看工作区状态',
	diff: '查看代码差异',
	log: '查看提交历史',
	show: '查看提交或文件内容',
	branch: '查看或管理分支',
	'diff-tree': '查看提交文件变化',
	add: '暂存代码更改',
	commit: '创建 Git 提交',
	push: '推送到远程仓库',
	pull: '拉取远程更新',
	fetch: '获取远程更新',
	checkout: '切换分支或文件',
	switch: '切换 Git 分支',
	restore: '恢复工作区文件',
	reset: '重置 Git 状态',
	merge: '合并 Git 分支',
	rebase: '执行 Git 变基',
	clone: '克隆 Git 仓库',
	init: '初始化 Git 仓库',
	clean: '清理未跟踪文件',
	tag: '查看或管理标签'
}

const DOCKER_SUMMARIES: Record<string, string> = {
	ps: '查看容器状态',
	logs: '查看容器日志',
	images: '查看本地镜像',
	build: '构建 Docker 镜像',
	pull: '拉取 Docker 镜像',
	push: '推送 Docker 镜像',
	run: '创建并运行容器',
	exec: '在容器中执行命令',
	start: '启动容器',
	stop: '停止容器',
	restart: '重启容器',
	rm: '删除容器',
	rmi: '删除镜像',
	'compose ps': '查看 Compose 服务状态',
	'compose logs': '查看 Compose 服务日志',
	'compose build': '构建 Compose 服务',
	'compose up': '启动 Compose 服务',
	'compose down': '停止并移除 Compose 服务',
	'compose exec': '在 Compose 服务中执行命令',
	'compose run': '运行一次性 Compose 命令',
	'compose pull': '拉取 Compose 服务镜像',
	'compose restart': '重启 Compose 服务'
}

const COMMAND_SUMMARIES: Record<string, string> = {
	rg: '搜索文件内容',
	grep: '搜索文本内容',
	findstr: '搜索文本内容',
	'select-string': '搜索文本内容',
	'get-content': '读取文件内容',
	cat: '读取文件内容',
	'get-childitem': '查看目录内容',
	ls: '查看目录内容',
	dir: '查看目录内容',
	'write-output': '输出文本',
	'select-object': '筛选输出字段',
	'where-object': '筛选数据',
	'foreach-object': '逐项处理数据',
	'sort-object': '排序数据',
	'measure-object': '统计数据',
	'format-table': '格式化表格输出',
	'format-list': '格式化列表输出',
	'test-path': '检查路径是否存在',
	'copy-item': '复制文件或目录',
	'move-item': '移动文件或目录',
	'remove-item': '删除文件或目录',
	'new-item': '创建文件或目录',
	curl: '发送网络请求',
	wget: '下载网络资源',
	'invoke-webrequest': '发送网络请求',
	'invoke-restmethod': '调用网络接口',
	ssh: '连接远程主机',
	node: '运行 Node.js',
	deno: '运行 Deno',
	python: '运行 Python',
	python3: '运行 Python',
	py: '运行 Python',
	ruby: '运行 Ruby',
	php: '运行 PHP',
	java: '运行 Java'
}

function escapeCharacter(dialect: ShellDialect) {
	if (dialect === 'powershell') return '`'
	if (dialect === 'cmd') return '^'
	return '\\'
}

function isDynamicToken(raw: string, dialect: ShellDialect) {
	if ((dialect === 'bash' || dialect === 'powershell') && raw.startsWith("'") && raw.endsWith("'")) return false
	if (dialect === 'cmd') return /%[^%]+%|![^!]+!|%%[A-Za-z]/.test(raw)
	return /\$[{(A-Za-z_]|`[^`]+`/.test(raw)
}

export function tokenizeCommand(source: string, dialect: ShellDialect): CommandToken[] {
	const tokens: CommandToken[] = []
	const escape = escapeCharacter(dialect)
	let start = -1
	let value = ''
	let quote = ''
	let quoted = false

	const push = (end: number) => {
		if (start < 0) return
		const raw = source.slice(start, end)
		tokens.push({ value, raw, quoted, dynamic: isDynamicToken(raw, dialect) })
		start = -1
		value = ''
		quote = ''
		quoted = false
	}

	for (let index = 0; index < source.length; index++) {
		const char = source[index]
		if (start < 0) {
			if (/\s/.test(char)) continue
			start = index
		}
		if (quote) {
			if (char === quote) {
				if (dialect === 'powershell' && quote === "'" && source[index + 1] === "'") {
					value += "'"
					index++
				} else quote = ''
				continue
			}
			if (char === escape && source[index + 1] !== undefined && quote !== "'") {
				value += source[++index]
				continue
			}
			value += char
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			quoted = true
			continue
		}
		if (char === escape && source[index + 1] !== undefined) {
			value += source[++index]
			continue
		}
		if (/\s/.test(char)) {
			push(index)
			continue
		}
		value += char
	}
	push(source.length)
	return tokens
}

export function normalizeCommandName(value: string) {
	const clean = value.trim().replace(/^[@&]\s*/, '').replace(/^['"]|['"]$/g, '')
	return (clean.split(/[\\/]/).at(-1) ?? clean).toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, '')
}

export function commandCategory(name: string): CommandCategory {
	if (name === 'git') return 'git'
	if (name === 'docker' || name === 'docker-compose') return 'docker'
	if (PACKAGE_COMMANDS.has(name)) return 'package'
	if (BUILD_COMMANDS.has(name)) return 'build'
	if (RUNTIME_COMMANDS.has(name)) return 'runtime'
	if (SEARCH_COMMANDS.has(name)) return 'search'
	if (FILE_COMMANDS.has(name)) return 'file'
	if (NETWORK_COMMANDS.has(name)) return 'network'
	if (SYSTEM_COMMANDS.has(name)) return 'system'
	if (/^[a-z]+-[a-z][a-z0-9-]*$/.test(name)) return 'system'
	return 'other'
}

function firstArgument(tokens: CommandToken[], commandIndex: number) {
	return tokens.slice(commandIndex + 1).find(token => token.value !== '--' && !token.value.startsWith('-') && !token.value.startsWith('/'))?.value.toLowerCase()
}

function gitSubcommand(tokens: CommandToken[], commandIndex: number) {
	const args = tokens.slice(commandIndex + 1)
	for (let index = 0; index < args.length; index++) {
		const value = args[index].value.toLowerCase()
		if (['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--config-env'].includes(args[index].value)) {
			index++
			continue
		}
		if (value === '--' || value.startsWith('-')) continue
		return value
	}
}

function dockerSubcommand(tokens: CommandToken[], commandIndex: number) {
	const args = tokens.slice(commandIndex + 1).map(token => token.value.toLowerCase()).filter(Boolean)
	const valueOptions = new Set(['-c', '--config', '--context', '-h', '--host', '-l', '--log-level', '--tlscacert', '--tlscert', '--tlskey', '-f', '--file', '--project-directory', '-p', '--project-name', '--profile'])
	const nextPositional = (start: number) => {
		for (let index = start; index < args.length; index++) {
			const value = args[index]
			if (valueOptions.has(value)) {
				index++
				continue
			}
			if (value === '--' || value.startsWith('-')) continue
			return { value, index }
		}
	}
	const first = nextPositional(0)
	if (!first) return
	if (first.value !== 'compose') return first.value
	const action = nextPositional(first.index + 1)?.value
	return action ? `compose ${action}` : 'compose'
}

export function commandSubcommand(name: string, tokens: CommandToken[], commandIndex: number) {
	if (name === 'git') return gitSubcommand(tokens, commandIndex)
	if (name === 'docker' || name === 'docker-compose') return dockerSubcommand(tokens, commandIndex)
	if (PACKAGE_COMMANDS.has(name)) {
		const action = firstArgument(tokens, commandIndex)
		if (action === 'run') {
			const script = tokens.slice(commandIndex + 2).find(token => !token.value.startsWith('-'))?.value
			return script ? `run ${script}` : action
		}
		return action
	}
	if (BUILD_COMMANDS.has(name)) return firstArgument(tokens, commandIndex)
	return firstArgument(tokens, commandIndex)
}

export function commandSummary(name: string, subcommand?: string) {
	if (name === 'git') return GIT_SUMMARIES[subcommand ?? ''] ?? (subcommand ? `运行 Git ${subcommand}` : '运行 Git 命令')
	if (name === 'docker' || name === 'docker-compose') return DOCKER_SUMMARIES[subcommand ?? ''] ?? (subcommand ? `运行 Docker ${subcommand}` : '运行 Docker 命令')
	if (PACKAGE_COMMANDS.has(name)) {
		if (subcommand?.startsWith('run ')) return `运行项目脚本 ${subcommand.slice(4)}`
		if (subcommand === 'install' || subcommand === 'add') return '安装项目依赖'
		if (subcommand === 'remove' || subcommand === 'uninstall') return '移除项目依赖'
		if (subcommand === 'test') return '运行项目测试'
		return subcommand ? `运行 ${name} ${subcommand}` : `运行 ${name}`
	}
	if (name === 'cargo') {
		if (subcommand === 'test') return '运行 Rust 测试'
		if (subcommand === 'build') return '构建 Rust 项目'
		if (subcommand === 'check') return '检查 Rust 项目'
	}
	return COMMAND_SUMMARIES[name] ?? `运行 ${name || '动态命令'}`
}

export function isReadCommandName(name: string) {
	return READ_COMMANDS.has(normalizeCommandName(name))
}

export function isSearchCommandName(name: string) {
	return SEARCH_COMMANDS.has(normalizeCommandName(name))
}

export function isAuditCommand(command: { normalizedName: string; category: CommandCategory }) {
	const name = normalizeCommandName(command.normalizedName)
	if (!name || READ_COMMANDS.has(name) || SEARCH_COMMANDS.has(name) || INSPECTION_COMMANDS.has(name) || HELPER_COMMANDS.has(name) || SHELL_WRAPPERS.has(name) || CONTROL_WORDS.has(name)) return false
	if (FILE_MUTATION_COMMANDS.has(name) || IMPORTANT_SYSTEM_COMMANDS.has(name)) return true
	if (['git', 'docker', 'package', 'build', 'runtime', 'network'].includes(command.category)) return true
	if (command.category === 'system') return false
	return /^[a-z0-9_.@+-]+$/i.test(name)
}

export function commandSignature(command: { normalizedName: string; subcommand?: string }) {
	const name = command.normalizedName === 'docker-compose' ? 'docker compose' : command.normalizedName
	return `${name}${command.subcommand ? ` ${command.subcommand}` : ''}`.trim().replace(/\s+/g, ' ')
}
