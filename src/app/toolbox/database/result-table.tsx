'use client'

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTable, tableFeatures, columnSizingFeature, columnResizingFeature } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Copy, PanelRightOpen } from 'lucide-react'
import type { CellValue } from '@/lib/database/types'
import styles from './database.module.css'
import { cellText, isBlob, selectionClipboard, writeCellClipboard, type CellPosition } from '@/lib/database/cells'
import { useCellSelection } from './use-cell-selection'
import { ValueViewer } from './value-viewer'
import { CellMenu } from './cell-menu'
import { PaneDivider } from './pane-divider'

const features = tableFeatures({ columnSizingFeature, columnResizingFeature })
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
	const gridId = useId()
	const [detailOpen, setDetailOpen] = useState(false)
	const [gridRatio, setGridRatio] = useState(62)
	const [copyStatus, setCopyStatus] = useState('')
	const [menu, setMenu] = useState<{ point: CellPosition; x: number; y: number; rows: CellValue[][]; columns: string[]; rowOffset: number } | null>(null)
	const currentMenu = menu?.rows === rows && menu.columns === columns && menu.rowOffset === rowOffset ? menu : null
	function openMenu(point: CellPosition, x: number, y: number) {
		setMenu({ point, x, y, rows, columns, rowOffset })
	}
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
	const cells = useCellSelection({
		container,
		rowCount: rows.length,
		widths: leaves.map(column => column.getSize()),
		onOpen: () => setDetailOpen(true),
		onMenu: openMenu
	})
	const active = cells.selection?.focus
	const validActive = active && active.row < rows.length && active.column < columns.length ? active : null
	const bounds = cells.bounds
	const selectedCount = bounds ? (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1) : 0
	useEffect(() => setCopyStatus(''), [cells.selection])
	function closeMenu() {
		setMenu(null)
		cells.focusGrid()
	}
	async function copy(selection = cells.selection) {
		if (!selection) return
		try {
			await writeCellClipboard(selectionClipboard(rows, selection))
			setCopyStatus('已复制')
		} catch {
			setCopyStatus('复制失败，请使用 Ctrl / ⌘ + C 或在查看器中选择文字复制。')
		}
	}
	function showValue(point = validActive) {
		if (!point) return
		cells.select(point)
		setDetailOpen(true)
		setMenu(null)
	}

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
		cells.setSelection(null)
		cells.stopDrag()
		setCopyStatus('')
		setMenu(null)
	}, [rowOffset, columns, rows])
	return (
		<div className={styles.resultWorkspace} data-details={detailOpen && !!validActive} style={{ '--grid-ratio': `${gridRatio}%` } as CSSProperties}>
			<div className={styles.gridFrame}>
				<div className={styles.selectionBar}>
					<button className={styles.button} disabled={!validActive} onClick={() => void copy()} aria-label='复制选中内容'>
						<Copy size={12} />
						复制
					</button>
					<button className={styles.button} disabled={!validActive} onClick={() => showValue()} aria-label='查看单元格内容'>
						<PanelRightOpen size={13} />
						查看值
					</button>
					<span className={styles.spacer} />
					<span role='status' className={styles.selectionStatus}>
						{copyStatus ||
							(validActive
								? selectedCount > 1
									? `已选择 ${selectedCount.toLocaleString()} 个单元格`
									: detailOpen
										? '方向键切换 · Shift 扩选'
										: `第 ${rowOffset + validActive.row + 1} 行 · ${columns[validActive.column]}`
								: '单击选择 · 双击查看 · Ctrl / ⌘ + C 复制')}
					</span>
				</div>
				<div
					ref={container}
					role='grid'
					id={gridId}
					tabIndex={0}
					aria-multiselectable='true'
					aria-readonly='true'
					aria-activedescendant={
						validActive &&
						vertical.getVirtualItems().some(row => row.index === validActive.row) &&
						horizontal.getVirtualItems().some(column => column.index === validActive.column)
							? `${gridId}-${validActive.row}-${validActive.column}`
							: undefined
					}
					aria-label='查询结果'
					aria-rowcount={rows.length + 1}
					aria-colcount={columns.length + 1}
					className={styles.grid}
					onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)}
					onKeyDown={cells.keyDown}
					onPointerMove={cells.moveDrag}
					onPointerUp={cells.stopDrag}
					onPointerCancel={cells.stopDrag}
					onLostPointerCapture={cells.stopDrag}
					onDoubleClick={event => {
						if (event.target === event.currentTarget || (event.target as HTMLElement).closest('[role=gridcell]')) showValue()
					}}
					onCopy={event => {
						if (!cells.selection) return
						const payload = selectionClipboard(rows, cells.selection)
						event.preventDefault()
						event.clipboardData.setData('text/plain', payload.text)
						if (payload.html) event.clipboardData.setData('text/html', payload.html)
						setCopyStatus('已复制')
					}}>
					<div style={{ width: scrollWidth, minWidth: '100%' }}>
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
										aria-colindex={column.index + 2}
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
									data-row-selected={cells.selection?.wholeRows && bounds && row.index >= bounds.top && row.index <= bounds.bottom}
									style={{ top: row.start }}
									className={styles.gridRow}>
									<div
										className={styles.rowNumber}
										role='rowheader'
										aria-colindex={1}
										aria-label={`选择第 ${rowOffset + row.index + 1} 行`}
										onPointerDown={event => {
											cells.beginDrag(event, { row: row.index, column: 0 }, true)
										}}>
										{rowOffset + row.index + 1}
									</div>
									{horizontal.getVirtualItems().map(column => {
										const value = rows[row.index][column.index]
										const text = cellText(value)
										return (
											<div
												role='gridcell'
												id={`${gridId}-${row.index}-${column.index}`}
												aria-selected={cells.contains({ row: row.index, column: column.index })}
												data-active={validActive?.row === row.index && validActive.column === column.index}
												onPointerDown={event => {
													cells.beginDrag(event, { row: row.index, column: column.index })
												}}
												onContextMenu={event => {
													event.preventDefault()
													const point = { row: row.index, column: column.index }
													if (!cells.contains(point)) cells.select(point)
													openMenu(point, event.clientX, event.clientY)
												}}
												aria-colindex={column.index + 2}
												key={column.key}
												title={isBlob(value) ? '双击查看 BLOB 预览' : '双击查看完整内容'}
												style={{ left: column.start, width: column.size }}
												className={styles.cell}
												data-numeric={typeof value === 'number' || typeof value === 'bigint'}
												data-null={value === null}
												data-empty={value === ''}>
												{value === '' ? '空字符串' : text}
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
			{detailOpen && validActive && (
				<>
					<PaneDivider value={gridRatio} onChange={setGridRatio} min={35} max={75} percent label='调整单元格查看器宽度' />
					<ValueViewer
						value={rows[validActive.row][validActive.column]}
						column={columns[validActive.column]}
						row={rowOffset + validActive.row + 1}
						onClose={() => {
							setDetailOpen(false)
							cells.focusGrid()
						}}
					/>
				</>
			)}
			{currentMenu && (
				<CellMenu
					key={`${currentMenu.x}-${currentMenu.y}`}
					x={currentMenu.x}
					y={currentMenu.y}
					preview={isBlob(rows[currentMenu.point.row][currentMenu.point.column])}
					hasRange={selectedCount > 1}
					onCopyValue={() => {
						void copy({ anchor: currentMenu.point, focus: currentMenu.point })
						closeMenu()
					}}
					onCopyRange={() => {
						void copy()
						closeMenu()
					}}
					onCopyRow={() => {
						void copy({ anchor: { row: currentMenu.point.row, column: 0 }, focus: { row: currentMenu.point.row, column: columns.length - 1 } })
						closeMenu()
					}}
					onView={() => showValue(currentMenu.point)}
					onClose={restoreFocus => {
						setMenu(null)
						if (restoreFocus) cells.focusGrid()
					}}
				/>
			)}
		</div>
	)
}
