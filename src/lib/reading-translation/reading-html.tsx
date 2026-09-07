import { createElement, Fragment, type ReactElement } from 'react'
import parse, { domToReact, Element, type DOMNode, type HTMLReactParserOptions } from 'html-react-parser'
import { MarkdownImage } from '@/components/markdown-image'

// This reader only renders a small, inert Markdown vocabulary while credentials are in page memory.
const tags = new Set(['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'])

function readingHref(href?: string) {
	if (!href) return undefined
	try {
		const url = new URL(href, window.location.href)
		return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined
	} catch { return undefined }
}

export function parseReadingHtml(html: string): ReactElement {
	const options: HTMLReactParserOptions = {
		replace(node: DOMNode) {
			if (!(node instanceof Element)) return
			if (node.name === 'img') {
				const url = readingHref(node.attribs.src)
				return url?.startsWith('http') ? <MarkdownImage src={node.attribs.src} alt={node.attribs.alt} title={node.attribs.title} /> : <Fragment />
			}
			if (!tags.has(node.name)) return <Fragment />
			const props: Record<string, string | undefined> = {}
			if (/^h[1-6]$/.test(node.name)) props.id = node.attribs.id
			if (node.name === 'a') {
				props.href = readingHref(node.attribs.href)
				if (/^https?:\/\//i.test(node.attribs.href || '')) {
					props.target = '_blank'
					props.rel = 'noopener noreferrer'
				}
			}
			if (node.name === 'br' || node.name === 'hr') return createElement(node.name, props)
			return createElement(node.name, props, domToReact(node.children as DOMNode[], options))
		}
	}
	return <>{parse(html, options)}</>
}
