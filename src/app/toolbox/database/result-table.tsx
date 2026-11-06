'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTable, tableFeatures, columnSizingFeature, columnResizingFeature } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { CellValue } from '@/lib/database/types'
import styles from './database.module.css'

const features = tableFeatures({ columnSizingFeature, columnResizingFeature })
export function cellText(value: CellValue) {
	if (value === null) return 'NULL'
	if (typeof value === 'object') return `BLOB (${value.blobBytes.toLocaleString()} bytes) ${value.preview}`
	return String(value)
}
const textWidth = (text: string) => [...text.slice(0, 80)].reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 13 : 7), 0)

export function ResultTable({
	columns,
	rows,
	onSort,
	sort,
	disabled,
	rowOffset = 0
}: {
	columns: string[]
	rows: CellValue[][]
	onSort?: (column: string) => void
	sort?: { column: string; desc: boolean }
	disabled?: boolean
	rowOffset?: number
}) {
	const container = useRef<HTMLDivElement>(null)
	const [viewportWidth, setViewportWidth] = useState(0)
	const [selected, setSelected] = useState<number | null>(null)
	const [scrollLeft, setScrollLeft] = useState(0)
	useEffect(() => {
		const observer = new ResizeObserver(entries => setViewportWidth(entries[0].contentRect.width))
		if (container.current) observer.observe(container.current)
		return () => observer.disconnect()
	}, [])
	const defs = useMemo(() => {
		const widths = columns.map((header, index) =>
			Math.min(320, Math.max(88, textWidth(header) + 42, ...rows.slice(0, 24).map(row => textWidth(cellText(row[index])) + 24)))
		)
		const contentWidth = widths.reduce((sum, width) => sum + width, 0)
		const extra = Math.max(0, viewportWidth - 44 - contentWidth)
		return columns.map((header, index) => ({
			id: String(index),
			header,
			accessorFn: (row: CellValue[]) => row[index],
			size: widths[index] + extra * (widths[index] / contentWidth),
			minSize: 64,
			maxSize: Math.max(800, viewportWidth)
		}))
	}, [columns, rows, viewportWidth])
	const table = useTable({ features, columns: defs, data: rows, columnResizeMode: 'onChange' })
	const leaves = table.getAllLeafColumns()
	const headers = table.getHeaderGroups()[0]?.headers || []
	const vertical = useVirtualizer({ count: rows.length, getScrollElement: () => container.current, estimateSize: () => 28, overscan: 8 })
	const horizontal = useVirtualizer({
		count: leaves.length,
		getScrollElement: () => container.current,
		estimateSize: index => leaves[index].getSize(),
		horizontal: true,
		paddingStart: 44,
		overscan: 2
	})
	const sizing = table.state.columnSizing
	const scrollWidth = horizontal.getTotalSize()
	const maxScroll = Math.max(0, scrollWidth - viewportWidth)
	useEffect(() => {
		horizontal.measure()
	}, [horizontal, sizing, defs])
	useEffect(() => {
		if (container.current) container.current.scrollTop = 0
		setSelected(null)
	}, [rowOffset, columns])
	return (
		<div className={styles.gridFrame}>
			<div
				ref={container}
				role='table'
				aria-label='查询结果'
				aria-rowcount={rows.length + 1}
				aria-colcount={columns.length}
				className={styles.grid}
				onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)}>
				<div style={{ width: horizontal.getTotalSize(), minWidth: '100%' }}>
					<div role='row' className={styles.gridHeader}>
						<div className={styles.rowNumber} aria-hidden='true'>
							#
						</div>
						{horizontal.getVirtualItems().map(column => {
							const name = columns[column.index]
							const sample = rows.find(row => row[column.index] !== null)?.[column.index]
							const mark = typeof sample === 'number' || typeof sample === 'bigint' ? '123' : typeof sample === 'object' ? 'BIN' : 'Aa'
							const header = headers[column.index]
							return (
								<div
									role='columnheader'
									key={column.key}
									style={{ left: column.start, width: column.size }}
									className={styles.columnHeader}
									aria-sort={sort?.column === name ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
									<span className={styles.typeMark} aria-hidden='true'>
										{mark}
									</span>
									{onSort ? (
										<button disabled={disabled} onClick={() => onSort(name)} title={`排序：${name}`}>
											<span>{name}</span>
											{sort?.column === name && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
										</button>
									) : (
										<span className='truncate'>{name}</span>
									)}
									<div
										role='separator'
										tabIndex={0}
										aria-label={`调整列 ${name} 宽度`}
										aria-orientation='vertical'
										aria-valuenow={Math.round(column.size)}
										aria-valuemin={64}
										className={styles.columnResize}
										onMouseDown={header?.getResizeHandler()}
										onTouchStart={header?.getResizeHandler()}
										onDoubleClick={() => leaves[column.index].resetSize()}
										onKeyDown={event => {
											if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
												event.preventDefault()
												table.setColumnSizing(previous => ({
													...previous,
													[String(column.index)]: Math.max(64, column.size + (event.key === 'ArrowRight' ? 16 : -16))
												}))
											}
										}}
									/>
								</div>
							)
						})}
					</div>
					<div style={{ height: vertical.getTotalSize(), position: 'relative' }}>
						{vertical.getVirtualItems().map(row => (
							<div
								role='row'
								aria-rowindex={row.index + 2}
								key={row.key}
								data-selected={selected === row.index}
								style={{ top: row.start }}
								className={styles.gridRow}
								onClick={() => setSelected(row.index)}>
								<div className={styles.rowNumber} aria-hidden='true'>
									{rowOffset + row.index + 1}
								</div>
								{horizontal.getVirtualItems().map(column => {
									const value = rows[row.index][column.index]
									const text = cellText(value)
									return (
										<div
											role='cell'
											tabIndex={0}
											aria-colindex={column.index + 1}
											key={column.key}
											title={text}
											style={{ left: column.start, width: column.size }}
											className={styles.cell}
											data-numeric={typeof value === 'number' || typeof value === 'bigint'}
											data-null={value === null}>
											{text}
										</div>
									)
								})}
							</div>
						))}
					</div>
				</div>
				{rows.length === 0 && <div className={styles.schemaEmpty}>查询完成，没有匹配的记录。</div>}
			</div>
			<input
				type='range'
				aria-label='横向滚动查询结果'
				className={styles.horizontalScroll}
				min={0}
				max={maxScroll}
				step={1}
				value={Math.min(scrollLeft, maxScroll)}
				disabled={maxScroll === 0}
				style={{ '--scroll-thumb-width': `${maxScroll ? Math.max(32, (viewportWidth * viewportWidth) / scrollWidth) : viewportWidth}px` } as CSSProperties}
				onChange={event => {
					if (container.current) container.current.scrollLeft = Number(event.target.value)
				}}
			/>
		</div>
	)
}
