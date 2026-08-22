import { marked } from 'marked'
import type { Tokens } from 'marked'
import { codeToHtml } from 'shiki'

export type TocItem = { id: string; text: string; level: number }

export interface MarkdownRenderResult {
	html: string
	toc: TocItem[]
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
}

export async function renderMarkdown(markdown: string): Promise<MarkdownRenderResult> {
	// Parse TOC from markdown
	const toc: TocItem[] = []
	for (const line of markdown.split('\n')) {
		const m = /^(#{1,3})\s+(.+)$/.exec(line.trim())
		if (m) {
			const level = m[1].length
			const text = m[2].trim()
			const id = slugify(text)
			toc.push({ id, text, level })
		}
	}

	// Pre-process code blocks with Shiki — batch parallel, zero visual diff
	const codeBlockMap = new Map<string, { html: string; original: string }>()
	const tokens = marked.lexer(markdown)

	const codeTasks: Array<{ token: Tokens.Code; index: number }> = []
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (token.type === 'code') {
			const codeToken = token as Tokens.Code
			if ((codeToken.lang || '').trim().toLowerCase() === 'mermaid') continue
			codeTasks.push({ token: codeToken, index: codeBlockMap.size })
			// reserve key to keep stable ordering
			const placeholder = `__SHIKI_CODE_${codeBlockMap.size}__`
			codeBlockMap.set(placeholder, { html: '', original: codeToken.text })
			codeToken.text = placeholder
		}
	}

	if (codeTasks.length > 0) {
		const CONCURRENCY = 4
		for (let i = 0; i < codeTasks.length; i += CONCURRENCY) {
			const batch = codeTasks.slice(i, i + CONCURRENCY)
			await Promise.all(
				batch.map(async ({ token, index }) => {
					const key = `__SHIKI_CODE_${index}__`
					const originalCode = codeBlockMap.get(key)?.original ?? token.text
					try {
						const html = await codeToHtml(originalCode, {
							lang: token.lang || 'text',
							themes: {
								light: 'one-light',
								dark: 'github-dark'
							}
						})
						codeBlockMap.set(key, { html, original: originalCode })
					} catch {
						codeBlockMap.set(key, { html: '', original: originalCode })
					}
				})
			)
		}
	}

	// Render HTML with heading ids
	const renderer = new marked.Renderer()

	renderer.heading = (token: Tokens.Heading) => {
		const id = slugify(token.text || '')
		return `<h${token.depth} id="${id}">${token.text}</h${token.depth}>`
	}

	renderer.code = (token: Tokens.Code) => {
		if ((token.lang || '').trim().toLowerCase() === 'mermaid') {
			return `<div data-mermaid-code="${escapeHtmlAttribute(token.text)}"></div>`
		}

		// Check if this code block was pre-processed
		const codeData = codeBlockMap.get(token.text)
		if (codeData) {
			// Add data-code attribute with original code for copy functionality
			// Escape HTML entities for attribute value
			const escapedCode = escapeHtmlAttribute(codeData.original)
			if (codeData.html) {
				// Shiki highlighted code
				return `<pre data-code="${escapedCode}">${codeData.html}</pre>`
			}
			// Fallback for failed highlighting
			return `<pre data-code="${escapedCode}"><code>${codeData.original}</code></pre>`
		}
		// Fallback to default (inline code, not code block)
		return `<code>${token.text}</code>`
	}

	renderer.listitem = (token: Tokens.ListItem) => {
		// Render inline markdown inside list items (e.g. links, emphasis)
		const inner = token.tokens ? (marked.parser(token.tokens) as string) : token.text

		if (token.task) {
			const checkbox = token.checked ? '<input type="checkbox" checked disabled />' : '<input type="checkbox" disabled />'
			return `<li class="task-list-item">${checkbox} ${inner}</li>\n`
		}

		return `<li>${inner}</li>\n`
	}

	marked.use({
		renderer
	})
	const html = (marked.parser(tokens) as string) || ''

	return { html, toc }
}
