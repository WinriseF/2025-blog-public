import { asObject, asString } from './record-utils'

const COMMAND_TOOLS = new Set(['exec_command', 'shell_command', 'local_shell_call'])

function leafToolName(name: string) {
	return name.toLowerCase().split(/__|[.:/]/).at(-1) ?? ''
}

export function isCommandTool(name: string) {
	return COMMAND_TOOLS.has(leafToolName(name))
}

function asIdentifier(value: unknown) {
	return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
}

function displayArgument(value: string) {
	if (value && !/[\s"'`;|&<>(){}\[\]]/.test(value)) return value
	return `"${value.replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`
}

export function commandInput(input: unknown) {
	const object = asObject(input)
	const rawCommand = object?.cmd ?? object?.command
	const argv = Array.isArray(rawCommand) && rawCommand.every(item => typeof item === 'string') ? rawCommand : undefined
	return {
		command: asString(rawCommand) ?? argv?.map(displayArgument).join(' '),
		argv,
		cwd: asString(object?.workdir) ?? asString(object?.cwd) ?? asString(object?.working_directory),
		sessionId: asIdentifier(object?.session_id),
		cellId: asIdentifier(object?.cell_id),
		shell: asString(object?.shell)
	}
}
