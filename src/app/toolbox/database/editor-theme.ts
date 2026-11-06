import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'

export function applyDatabaseEditorTheme(monaco: typeof Monaco, element: HTMLElement, dark: boolean) {
	const css = getComputedStyle(element)
	const color = (name: string) =>
		css
			.getPropertyValue(name)
			.trim()
			.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3')
	monaco.editor.defineTheme('database-sql', {
		base: dark ? 'vs-dark' : 'vs',
		inherit: true,
		rules: [],
		colors: {
			'editor.background': color('--db-bg'),
			'editor.foreground': color('--db-text'),
			'editorLineNumber.foreground': color('--db-muted'),
			'editor.lineHighlightBackground': color('--db-panel'),
			'editor.lineHighlightBorder': '#00000000'
		}
	})
	monaco.editor.setTheme('database-sql')
}
