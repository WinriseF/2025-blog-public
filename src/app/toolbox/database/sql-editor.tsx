'use client'

import { useDatabaseEditor } from './use-database-editor'
import styles from './database.module.css'

export function SqlEditor({
	value,
	onChange,
	onRun,
	disabled
}: {
	value: string
	onChange: (value: string) => void
	onRun: (sql: string) => void
	disabled: boolean
}) {
	const { element, status } = useDatabaseEditor({
		value,
		language: 'sql',
		onChange,
		onRun,
		options: {
			readOnly: disabled,
			ariaLabel: 'SQL 查询',
			fontSize: 13,
			lineHeight: 21,
			overviewRulerLanes: 0,
			scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }
		}
	})
	return (
		<div className={styles.editor}>
			{status === 'failed' && (
				<div role='status' className={styles.editorFallback}>
					高级编辑器加载失败，已切换为基础编辑器，仍可输入和执行 SQL。
				</div>
			)}
			<div className={styles.editorSurface}>
				<div ref={element} className='absolute inset-0' />
				{status !== 'ready' && (
					<textarea
						aria-label='SQL 查询'
						className='font-mono'
						value={value}
						disabled={disabled}
						onChange={event => onChange(event.target.value)}
						onKeyDown={event => {
							if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
								event.preventDefault()
								onRun(event.currentTarget.value.substring(event.currentTarget.selectionStart, event.currentTarget.selectionEnd) || value)
							}
						}}
					/>
				)}
			</div>
		</div>
	)
}
