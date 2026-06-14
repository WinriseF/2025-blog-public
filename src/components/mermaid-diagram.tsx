'use client'

import { useEffect, useId, useRef, useState } from 'react'

type MermaidDiagramProps = {
	chart: string
}

let renderSerial = 0

function getMermaidTheme() {
	if (typeof document === 'undefined') return 'default'
	return document.documentElement.dataset.timeTheme === 'night' ? 'dark' : 'default'
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
	const reactId = useId()
	const [svg, setSvg] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [theme, setTheme] = useState(getMermaidTheme)
	const currentRenderRef = useRef(0)

	useEffect(() => {
		const observer = new MutationObserver(() => {
			setTheme(getMermaidTheme())
		})

		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-time-theme']
		})

		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		let cancelled = false
		const renderId = ++currentRenderRef.current

		async function renderDiagram() {
			try {
				const mermaid = (await import('mermaid')).default
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'strict',
					theme,
					fontFamily: 'inherit'
				})

				const diagramId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${++renderSerial}`
				const result = await mermaid.render(diagramId, chart)

				if (!cancelled && currentRenderRef.current === renderId) {
					setSvg(result.svg)
					setError(null)
				}
			} catch (err) {
				if (!cancelled && currentRenderRef.current === renderId) {
					setSvg('')
					setError(err instanceof Error ? err.message : 'Mermaid render failed')
				}
			}
		}

		setSvg('')
		setError(null)
		void renderDiagram()

		return () => {
			cancelled = true
		}
	}, [chart, reactId, theme])

	if (error) {
		return (
			<div className='mermaid-diagram mermaid-diagram-error'>
				<div className='mermaid-diagram-error-title'>Mermaid 图表渲染失败</div>
				<pre>{chart}</pre>
			</div>
		)
	}

	if (!svg) {
		return <div className='mermaid-diagram mermaid-diagram-loading'>图表渲染中...</div>
	}

	return <div className='mermaid-diagram' dangerouslySetInnerHTML={{ __html: svg }} />
}
