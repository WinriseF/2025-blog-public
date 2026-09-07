import type { ReadingSelection } from './types'

const EXCLUDED_CONTENT = 'button, input, textarea, select, pre, code, audio, video, svg, img, [contenteditable], [data-reading-ignore]'
const EXCLUDED = `a, ${EXCLUDED_CONTENT}`
const BLOCKS = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th'
const words = new Intl.Segmenter('en', { granularity: 'word' })
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' })

type TextPart = { node: Text; start: number; end: number }
type Word = { start: number; end: number }

export function isReadingTextTarget(root: HTMLElement, target: EventTarget | null) {
	const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
	return Boolean(element && root.contains(element) && !element.closest(EXCLUDED))
}

export function createReadingTextIndex(root: HTMLElement) {
	const parts: TextPart[] = []
	const positions = new WeakMap<Text, TextPart>()
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	let text = ''
	let previousBlock: Element | null = null
	while (walker.nextNode()) {
		const node = walker.currentNode as Text
		if (!node.data || node.parentElement?.closest(EXCLUDED_CONTENT)) continue
		const block = node.parentElement?.closest(BLOCKS) || root
		if (previousBlock && previousBlock !== block) text += '\n\n'
		const part = { node, start: text.length, end: text.length + node.length }
		parts.push(part)
		positions.set(node, part)
		text += node.data
		previousBlock = block
	}
	const segments = words.segment(text)

	function rangeBetween(start: number, end: number) {
		const first = parts.find(part => part.end > start)
		const last = parts.find(part => part.end >= end && part.start < end)
		if (!first || !last) return null
		const range = document.createRange()
		range.setStart(first.node, Math.max(0, start - first.start))
		range.setEnd(last.node, Math.min(last.node.length, end - last.start))
		return range
	}

	function wordAtPoint(x: number, y: number): Word | null {
		if (!isReadingTextTarget(root, document.elementFromPoint(x, y))) return null
		// WebKit exposes the range variant of the same caret hit test.
		const caretDocument = document as Document & {
			caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
			caretRangeFromPoint?: (x: number, y: number) => Range | null
		}
		const caret = caretDocument.caretPositionFromPoint?.(x, y)
		const fallback = caret ? null : caretDocument.caretRangeFromPoint?.(x, y)
		const node = caret?.offsetNode ?? fallback?.startContainer
		const offset = caret?.offset ?? fallback?.startOffset ?? 0
		if (!(node instanceof Text)) return null
		const part = positions.get(node)
		if (!part) return null
		const position = part.start + offset
		const candidate = segments.containing(position)
		const segment = candidate?.isWordLike ? candidate : segments.containing(position - 1)
		if (!segment?.isWordLike || !/[A-Za-z]/.test(segment.segment)) return null
		const word = { start: segment.index, end: segment.index + segment.segment.length }
		const range = rangeBetween(word.start, word.end)
		// Caret APIs can snap blank paragraph space to the nearest word; reject distant hits.
		if (!range || !Array.from(range.getClientRects()).some(rect => x >= rect.left - 3 && x <= rect.right + 3 && y >= rect.top - 3 && y <= rect.bottom + 3)) return null
		return word
	}

	function select(anchor: Word, focus: Word): ReadingSelection | null {
		const start = Math.min(anchor.start, focus.start)
		const end = Math.max(anchor.end, focus.end)
		const range = rangeBetween(start, end)
		if (!range) return null
		const before = text.lastIndexOf('\n\n', start)
		const after = text.indexOf('\n\n', end)
		let contextStart = Math.max(before < 0 ? 0 : before + 2, start - 500)
		let contextEnd = Math.min(after < 0 ? text.length : after, end + 500)
		if (anchor.start === focus.start) {
			for (const sentence of sentences.segment(text.slice(contextStart, contextEnd))) {
				const sentenceStart = contextStart + sentence.index
				const sentenceEnd = sentenceStart + sentence.segment.length
				if (sentenceStart <= start && sentenceEnd >= end) {
					contextStart = sentenceStart
					contextEnd = sentenceEnd
					break
				}
			}
		}
		return { range, text: text.slice(start, end), context: text.slice(contextStart, contextEnd), contextOffset: start - contextStart, mode: anchor.start === focus.start ? 'word' : 'passage' }
	}

	function fromNativeSelection() {
		const selection = window.getSelection()
		if (!selection || selection.isCollapsed || !selection.rangeCount) return null
		const range = selection.getRangeAt(0)
		if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
		const intersecting = parts.filter(part => range.intersectsNode(part.node))
		const first = intersecting[0]
		const last = intersecting.at(-1)
		if (!first || !last) return null
		const start = first.start + (range.startContainer === first.node ? range.startOffset : 0)
		const end = last.start + (range.endContainer === last.node ? range.endOffset : last.node.length)
		const selectedWords = Array.from(words.segment(text.slice(start, end))).filter(segment => segment.isWordLike)
		const firstWord = selectedWords[0]
		const lastWord = selectedWords.at(-1)
		if (!firstWord || !lastWord) return null
		const anchor = segments.containing(start + firstWord.index)
		const focus = segments.containing(start + lastWord.index)
		if (!anchor || !focus) return null
		return select({ start: anchor.index, end: anchor.index + anchor.segment.length }, { start: focus.index, end: focus.index + focus.segment.length })
	}

	return { wordAtPoint, select, fromNativeSelection }
}
