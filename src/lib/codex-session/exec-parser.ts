import { parse, type AnyNode, type Pattern } from 'acorn'
import { simple } from 'acorn-walk'

const UNKNOWN = Symbol('unknown')
const MAX_EXPANSION = 128
const BLOCKED_PROPERTIES = new Set(['__proto__', 'prototype', 'constructor'])

type LooseNode = AnyNode & Record<string, any>
type StaticFunction = {
	kind: 'function'
	params: Pattern[]
	body: LooseNode
	env: Map<string, unknown>
}

type ToolResultRef = {
	kind: 'tool-result'
	ordinal: number
}

export type DecodedToolCall = {
	id: string
	ordinal: number
	name: string
	input?: unknown
	inputSource?: string
	source: string
	start: number
	end: number
}

export type ExecDecodeResult = {
	calls: DecodedToolCall[]
	diagnostics: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStaticFunction(value: unknown): value is StaticFunction {
	return isRecord(value) && value.kind === 'function' && Array.isArray(value.params) && isRecord(value.body) && value.env instanceof Map
}

function memberName(node: LooseNode): string | undefined {
	if (node.type !== 'MemberExpression') return
	if (!node.computed && node.property?.type === 'Identifier') return node.property.name
	if (node.computed && node.property?.type === 'Literal' && typeof node.property.value === 'string') return node.property.value
}

function toolsCallName(node: LooseNode): string | undefined {
	if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return
	const object = node.callee.object as LooseNode
	if (object?.type !== 'Identifier' || object.name !== 'tools') return
	return memberName(node.callee as LooseNode)
}

function isToolsCall(node: LooseNode) {
	return node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.object?.type === 'Identifier' && node.callee.object.name === 'tools'
}

function cloneEnv(env: Map<string, unknown>) {
	return new Map(env)
}

function toSerializable(value: unknown): unknown {
	if (value === UNKNOWN) return undefined
	if (Array.isArray(value)) return value.map(toSerializable)
	if (isRecord(value)) {
		if (value.kind === 'tool-result' || value.kind === 'function') return undefined
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toSerializable(child)]))
	}
	return value
}

export function decodeExecSource(source: string, outerCallId: string): ExecDecodeResult {
	const diagnostics: string[] = []
	const calls: DecodedToolCall[] = []
	let program: ReturnType<typeof parse>

	try {
		program = parse(source, {
			ecmaVersion: 'latest',
			sourceType: 'module',
			allowAwaitOutsideFunction: true
		})
	} catch (error) {
		return {
			calls,
			diagnostics: [`exec JavaScript 语法无法解析：${error instanceof Error ? error.message : '未知错误'}`]
		}
	}

	const env = new Map<string, unknown>()
	let expansionCount = 0

	const assignPattern = (pattern: LooseNode, value: unknown, target: Map<string, unknown>) => {
		if (pattern.type === 'Identifier') {
			target.set(pattern.name, value)
			return
		}
		if (pattern.type === 'ArrayPattern' && Array.isArray(value)) {
			pattern.elements.forEach((element: LooseNode | null, index: number) => {
				if (element) assignPattern(element, value[index], target)
			})
			return
		}
		if (pattern.type === 'ObjectPattern' && isRecord(value)) {
			for (const property of pattern.properties as LooseNode[]) {
				if (property.type !== 'Property') continue
				const keyNode = property.key as LooseNode
				const key = keyNode.type === 'Identifier' ? keyNode.name : keyNode.value
				if (typeof key === 'string') assignPattern(property.value, value[key], target)
			}
		}
	}

	const callFunction = (fn: StaticFunction, args: unknown[]): unknown => {
		if (++expansionCount > MAX_EXPANSION) return UNKNOWN
		const local = cloneEnv(fn.env)
		fn.params.forEach((parameter, index) => assignPattern(parameter as LooseNode, args[index], local))
		if (fn.body.type === 'BlockStatement') return executeStatements(fn.body.body as LooseNode[], local)
		return evaluate(fn.body, local)
	}

	const evaluateCall = (node: LooseNode, currentEnv: Map<string, unknown>): unknown => {
		const toolName = toolsCallName(node)
		if (toolName) {
			if (calls.length >= MAX_EXPANSION) {
				diagnostics.push('exec 内工具调用超过安全展开上限，剩余调用保持原始源码')
				return UNKNOWN
			}
			const argumentNodes = node.arguments as LooseNode[]
			const values = argumentNodes.map(argument => evaluate(argument, currentEnv))
			const rawInput = argumentNodes[0] ? source.slice(argumentNodes[0].start, argumentNodes[0].end) : undefined
			const ordinal = calls.length
			calls.push({
				id: `${outerCallId}:${ordinal}`,
				ordinal,
				name: toolName,
				input: toSerializable(values.length <= 1 ? values[0] : values),
				inputSource: rawInput,
				source: source.slice(node.start, node.end),
				start: node.start,
				end: node.end
			})
			return { kind: 'tool-result', ordinal } satisfies ToolResultRef
		}

		const callee = node.callee as LooseNode
		const args = (node.arguments as LooseNode[]).map(argument => evaluate(argument, currentEnv))
		if (callee.type === 'Identifier') {
			if (callee.name === 'text') return undefined
			const fn = currentEnv.get(callee.name)
			return isStaticFunction(fn) ? callFunction(fn, args) : UNKNOWN
		}

		if (callee.type !== 'MemberExpression') return UNKNOWN
		const name = memberName(callee)
		if (!name || BLOCKED_PROPERTIES.has(name)) return UNKNOWN
		const ownerNode = callee.object as LooseNode
		if (ownerNode.type === 'Identifier' && ownerNode.name === 'Promise' && name === 'all') return Array.isArray(args[0]) ? args[0] : UNKNOWN
		if (ownerNode.type === 'Identifier' && ownerNode.name === 'Object') {
			if (!isRecord(args[0])) return UNKNOWN
			if (name === 'keys') return Object.keys(args[0])
			if (name === 'values') return Object.values(args[0])
			if (name === 'entries') return Object.entries(args[0])
		}
		if (ownerNode.type === 'Identifier' && ownerNode.name === 'Array' && name === 'from') return Array.isArray(args[0]) ? [...args[0]] : UNKNOWN
		if (ownerNode.type === 'Identifier' && ownerNode.name === 'JSON' && name === 'stringify') {
			try {
				return JSON.stringify(toSerializable(args[0]))
			} catch {
				return UNKNOWN
			}
		}

		const owner = evaluate(ownerNode, currentEnv)
		if (Array.isArray(owner)) {
			const callback = args[0]
			if (name === 'join') return owner.map(value => String(value ?? '')).join(typeof args[0] === 'string' ? args[0] : ',')
			if (name === 'slice') return owner.slice(typeof args[0] === 'number' ? args[0] : undefined, typeof args[1] === 'number' ? args[1] : undefined)
			if (name === 'concat') return owner.concat(...args.map(value => (Array.isArray(value) ? value : [value])))
			if (name === 'map' && isStaticFunction(callback)) return owner.slice(0, MAX_EXPANSION).map((value, index) => callFunction(callback, [value, index, owner]))
			if (name === 'filter' && isStaticFunction(callback)) return owner.filter((value, index) => Boolean(callFunction(callback, [value, index, owner])))
		}
		if (typeof owner === 'string') {
			if (name === 'trim') return owner.trim()
			if (name === 'toLowerCase') return owner.toLowerCase()
			if (name === 'toUpperCase') return owner.toUpperCase()
			if (name === 'slice') return owner.slice(typeof args[0] === 'number' ? args[0] : undefined, typeof args[1] === 'number' ? args[1] : undefined)
			if (name === 'concat') return owner.concat(...args.map(value => String(value ?? '')))
		}
		return UNKNOWN
	}

	const evaluate = (node: LooseNode | null | undefined, currentEnv: Map<string, unknown>): unknown => {
		if (!node) return undefined
		switch (node.type) {
			case 'Literal':
				return node.value
			case 'Identifier':
				if (node.name === 'undefined') return undefined
				return currentEnv.has(node.name) ? currentEnv.get(node.name) : UNKNOWN
			case 'ArrayExpression':
				return node.elements.map((element: LooseNode | null) => evaluate(element, currentEnv))
			case 'ObjectExpression': {
				const value: Record<string, unknown> = {}
				for (const property of node.properties as LooseNode[]) {
					if (property.type === 'SpreadElement') {
						const spread = evaluate(property.argument, currentEnv)
						if (isRecord(spread)) Object.assign(value, spread)
						continue
					}
					if (property.type !== 'Property' || property.kind !== 'init') continue
					const keyNode = property.key as LooseNode
					const key = property.computed ? evaluate(keyNode, currentEnv) : keyNode.type === 'Identifier' ? keyNode.name : keyNode.value
					if ((typeof key === 'string' || typeof key === 'number') && !BLOCKED_PROPERTIES.has(String(key))) value[String(key)] = evaluate(property.value, currentEnv)
				}
				return value
			}
			case 'TemplateLiteral': {
				let value = ''
				for (let index = 0; index < node.quasis.length; index++) {
					value += node.quasis[index].value.cooked ?? node.quasis[index].value.raw
					if (index < node.expressions.length) {
						const expression = evaluate(node.expressions[index], currentEnv)
						if (expression === UNKNOWN) return UNKNOWN
						value += String(expression ?? '')
					}
				}
				return value
			}
			case 'BinaryExpression': {
				const left = evaluate(node.left, currentEnv)
				const right = evaluate(node.right, currentEnv)
				if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN
				if (node.operator === '+') return typeof left === 'string' || typeof right === 'string' ? String(left ?? '') + String(right ?? '') : Number(left) + Number(right)
				if (node.operator === '===') return left === right
				if (node.operator === '!==') return left !== right
				if (node.operator === '==') return left == right
				if (node.operator === '!=') return left != right
				return UNKNOWN
			}
			case 'LogicalExpression': {
				const left = evaluate(node.left, currentEnv)
				if (left === UNKNOWN) return UNKNOWN
				if (node.operator === '&&') return left ? evaluate(node.right, currentEnv) : left
				if (node.operator === '||') return left ? left : evaluate(node.right, currentEnv)
				return left ?? evaluate(node.right, currentEnv)
			}
			case 'UnaryExpression': {
				const argument = evaluate(node.argument, currentEnv)
				if (argument === UNKNOWN) return UNKNOWN
				if (node.operator === '!') return !argument
				if (node.operator === '+') return Number(argument)
				if (node.operator === '-') return -Number(argument)
				if (node.operator === 'typeof') return typeof argument
				if (node.operator === 'void') return undefined
				return UNKNOWN
			}
			case 'ConditionalExpression': {
				const test = evaluate(node.test, currentEnv)
				return test === UNKNOWN ? UNKNOWN : evaluate(test ? node.consequent : node.alternate, currentEnv)
			}
			case 'MemberExpression': {
				const owner = evaluate(node.object, currentEnv)
				const property = node.computed ? evaluate(node.property, currentEnv) : memberName(node)
				if (owner === UNKNOWN || (typeof property !== 'string' && typeof property !== 'number') || BLOCKED_PROPERTIES.has(String(property))) return UNKNOWN
				if (Array.isArray(owner) || typeof owner === 'string') return owner[Number.isInteger(Number(property)) ? Number(property) : (property as never)]
				return isRecord(owner) ? owner[String(property)] : UNKNOWN
			}
			case 'ArrowFunctionExpression':
			case 'FunctionExpression':
				return { kind: 'function', params: node.params, body: node.body, env: cloneEnv(currentEnv) } satisfies StaticFunction
			case 'CallExpression':
				return evaluateCall(node, currentEnv)
			case 'AwaitExpression':
			case 'ChainExpression':
			case 'ParenthesizedExpression':
				return evaluate(node.argument ?? node.expression, currentEnv)
			case 'SequenceExpression': {
				let value: unknown
				for (const expression of node.expressions as LooseNode[]) value = evaluate(expression, currentEnv)
				return value
			}
			case 'AssignmentExpression': {
				const value = evaluate(node.right, currentEnv)
				if (node.operator === '=') assignPattern(node.left, value, currentEnv)
				return value
			}
			default:
				return UNKNOWN
		}
	}

	const executeStatement = (statement: LooseNode, currentEnv: Map<string, unknown>): unknown => {
		switch (statement.type) {
			case 'VariableDeclaration':
				for (const declaration of statement.declarations as LooseNode[]) assignPattern(declaration.id, evaluate(declaration.init, currentEnv), currentEnv)
				return
			case 'ExpressionStatement':
				return evaluate(statement.expression, currentEnv)
			case 'ReturnStatement':
				return evaluate(statement.argument, currentEnv)
			case 'BlockStatement':
				return executeStatements(statement.body, currentEnv)
			case 'IfStatement': {
				const test = evaluate(statement.test, currentEnv)
				if (test === UNKNOWN) return UNKNOWN
				const branch = test ? statement.consequent : statement.alternate
				return branch ? executeStatement(branch as LooseNode, currentEnv) : undefined
			}
			case 'ForOfStatement': {
				const values = evaluate(statement.right, currentEnv)
				if (!Array.isArray(values)) return UNKNOWN
				for (const value of values.slice(0, MAX_EXPANSION)) {
					if (++expansionCount > MAX_EXPANSION) break
					const local = cloneEnv(currentEnv)
					const left = statement.left as LooseNode
					if (left.type === 'VariableDeclaration') assignPattern(left.declarations[0].id, value, local)
					else assignPattern(left, value, local)
					executeStatement(statement.body, local)
				}
				return
			}
			case 'FunctionDeclaration':
				if (statement.id?.name) currentEnv.set(statement.id.name, { kind: 'function', params: statement.params, body: statement.body, env: cloneEnv(currentEnv) } satisfies StaticFunction)
				return
			default:
				return UNKNOWN
		}
	}

	const executeStatements = (statements: LooseNode[], currentEnv: Map<string, unknown>): unknown => {
		let value: unknown
		for (const statement of statements) value = executeStatement(statement, currentEnv)
		return value
	}

	try {
		executeStatements(program.body as LooseNode[], env)
	} catch (error) {
		diagnostics.push(`exec 静态求值已安全停止：${error instanceof Error ? error.message : '无法处理的表达式'}`)
	}

	const decodedStarts = new Set(calls.map(call => call.start))
	let unresolvedToolsCalls = 0
	try {
		simple(program, {
			CallExpression(node) {
				if (isToolsCall(node as LooseNode) && !decodedStarts.has(node.start)) unresolvedToolsCalls++
			}
		})
	} catch {
		diagnostics.push('exec AST 遍历未完成，剩余源码保持 opaque')
	}
	if (unresolvedToolsCalls) diagnostics.push(`${unresolvedToolsCalls} 个动态或不可达的 tools.* 调用未展开`)
	return { calls, diagnostics }
}
