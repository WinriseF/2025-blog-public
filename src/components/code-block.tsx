import { Copy, Check } from 'lucide-react'

type CodeBlockProps = {
	code: string
	html: string
}

export function CodeBlock({ code, html }: CodeBlockProps) {
	return (
		<div className='code-block-wrapper'>
			<button type='button' data-code-copy={code} className='code-block-copy-btn' aria-label='Copy code'>
				<Copy size={16} className='code-block-copy-icon' />
				<Check size={16} className='code-block-check-icon' />
			</button>
			<div className='code-block-content' dangerouslySetInnerHTML={{ __html: html }} />
		</div>
	)
}

