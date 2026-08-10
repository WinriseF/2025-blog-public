import { describe, expect, it } from 'vitest'
import { decodeExecSource } from './exec-parser'

describe('decodeExecSource', () => {
	it('静态展开常量、模板字符串和 Promise.all', () => {
		const result = decodeExecSource(`
			const root = 'src'
			const files = ['a', 'b']
			await tools.exec_command({ cmd: 'rg todo ' + root })
			await Promise.all(files.map(name => tools.apply_patch({ patch: \`*** Add File: \${root}/\${name}.txt\` })))
		`, 'outer')

		expect(result.calls.map(call => call.id)).toEqual(['outer:0', 'outer:1', 'outer:2'])
		expect(result.calls[0].input).toEqual({ cmd: 'rg todo src' })
		expect(result.calls[2].input).toEqual({ patch: '*** Add File: src/b.txt' })
	})

	it('不会把注释、字符串或动态属性当成可证明调用', () => {
		const result = decodeExecSource(`
			const text = "tools.apply_patch({ patch: 'fake' })"
			// tools.exec_command({ cmd: 'fake' })
			const name = externalValue
			await tools[name]({ dangerous: true })
		`, 'outer')

		expect(result.calls).toHaveLength(0)
	})

	it('不执行任意函数或构造器', () => {
		const result = decodeExecSource(`
			globalThis.compromised = true
			new Function('return tools.exec_command({cmd: "bad"})')()
			eval('tools.apply_patch({patch: "bad"})')
		`, 'outer')

		expect(result.calls).toHaveLength(0)
	})
})
