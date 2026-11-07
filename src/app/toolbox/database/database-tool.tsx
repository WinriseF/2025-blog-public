'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import {
	ArrowLeft,
	ArrowRight,
	ChevronDown,
	ChevronRight,
	Database,
	Eye,
	FileCode2,
	Filter,
	FolderOpen,
	LockKeyhole,
	PanelLeftClose,
	PanelLeftOpen,
	Play,
	RefreshCw,
	Search,
	Square,
	Table2,
	X,
	Columns3,
	Rows3
} from 'lucide-react'
import { PAGE_ROWS } from '@/lib/database/types'
import { ResultTable } from './result-table'
import { SqlEditor } from './sql-editor'
import { PaneDivider } from './pane-divider'
import { StructureView } from './structure-view'
import { useDatabaseWorkspace } from './use-database-workspace'
import styles from './database.module.css'

const formatBytes = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(2)} MB`)

export function DatabaseTool() {
	const db = useDatabaseWorkspace()
	const input = useRef<HTMLInputElement>(null)
	const [sidebar, setSidebar] = useState(true)
	const [sidebarWidth, setSidebarWidth] = useState(232)
	const [editorRatio, setEditorRatio] = useState(32)
	const [search, setSearch] = useState('')
	const [selectionStatus, setSelectionStatus] = useState('')
	const [collapsed, setCollapsed] = useState({ table: false, view: false })
	const { open: filterOpen, column: filterColumn, operator, value: filterValue } = db.filter
	const setFilterOpen = (open: boolean) => db.setFilter({ open })
	const setFilterColumn = (column: string) => db.setFilter({ column })
	const setOperator = (operator: typeof db.filter.operator) => db.setFilter({ operator })
	const setFilterValue = (value: string) => db.setFilter({ value })
	const tabs = useRef<HTMLDivElement>(null)
	useEffect(() => {
		tabs.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
	}, [db.activeId])
	const [elapsedSeconds, setElapsedSeconds] = useState(0)
	useEffect(() => {
		setElapsedSeconds(0)
		if (!db.busy) return
		const started = performance.now()
		const timer = setInterval(() => setElapsedSeconds(Math.floor((performance.now() - started) / 1000)), 1000)
		return () => clearInterval(timer)
	}, [db.busy])
	const result = db.tab === 'sql' ? db.sqlResult : db.tableResult
	const tables = db.info?.objects.filter(object => object.type === 'table') || []
	const views = db.info?.objects.filter(object => object.type === 'view') || []
	const selectedObject = db.info?.objects.find(object => object.name === db.table)
	const readingLabel = db.counting ? '正在统计行数' : selectedObject?.type === 'view' && db.tab !== 'sql' ? '正在计算视图' : '正在读取'
	const chooseFile = () => input.current?.click()
	const switchTab = (tab: 'data' | 'structure' | 'sql') => {
		if (tab === 'sql') db.showSql()
		else db.setTab(tab)
		db.setError('')
	}
	const results = (
		<div className={styles.resultPane}>
			{db.tab === 'sql' && (
				<div className={styles.paneHeading}>
					<Table2 size={13} />
					<strong>查询结果</strong>
				</div>
			)}
			{result ? (
				<ResultTable
					key={db.activeId}
					viewport={db.viewport}
					onSelectionStatusChange={setSelectionStatus}
					columns={result.columns}
					rows={result.rows}
					disabled={db.busy}
					rowOffset={db.tab === 'data' ? db.query.offset : 0}
					sort={db.tab === 'data' ? db.query.sort : undefined}
					onSort={
						db.tab === 'data'
							? column => db.browse({ ...db.query, offset: 0, sort: { column, desc: db.query.sort?.column === column ? !db.query.sort.desc : false } })
							: undefined
					}
				/>
			) : (
				<div className={styles.empty}>
					<div className={styles.emptyInner}>
						<span>
							{db.busy
								? `${readingLabel}… ${elapsedSeconds} 秒`
								: db.error
									? '读取未完成，请调整查询后重试。'
									: db.tab === 'sql'
										? '运行 SQL 后在此查看查询结果'
										: '从左侧选择一张表'}
						</span>
						{db.busy && selectedObject?.type === 'view' && <p>包含连接、分组或排序的视图，需要先计算结果。</p>}
						{db.busy && (
							<button className={styles.button} onClick={db.cancel} aria-label='停止读取'>
								<Square size={12} />
								停止读取
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	)
	const resultFooter =
		db.activeId && db.tab !== 'structure' ? (
			<>
				{db.tab === 'data' ? (
					<>
						<button
							className={styles.button}
							aria-label='上一页'
							disabled={db.busy || !result || db.query.offset === 0}
							onClick={() => db.browse({ ...db.query, offset: Math.max(0, db.query.offset - PAGE_ROWS) })}>
							<ArrowLeft size={13} />
						</button>
						<span className={styles.pageNumber}>
							第 <strong>{Math.floor(db.query.offset / PAGE_ROWS) + 1}</strong> 页
						</span>
						<button
							className={styles.button}
							aria-label='下一页'
							disabled={db.busy || !result?.hasMore}
							onClick={() => db.browse({ ...db.query, offset: db.query.offset + PAGE_ROWS })}>
							<ArrowRight size={13} />
						</button>
						<span className={styles.divider} />
						<span className={styles.optional}>{PAGE_ROWS} 行/页</span>
						<span className={styles.divider} />
						<button
							className={styles.button}
							aria-label='统计行数'
							disabled={db.busy || !db.table}
							title={selectedObject?.type === 'view' ? '统计视图行数可能需要执行完整查询' : '按当前筛选条件统计准确行数'}
							onClick={db.countRows}>
							{db.counting ? '统计中…' : '统计行数'}
						</button>
						{db.rowCount && (
							<span aria-label='行数统计结果' title={`统计耗时 ${(db.rowCount.elapsedMs / 1000).toFixed(3)} s`}>
								{db.query.filter ? '匹配' : '共'} {db.rowCount.value.toLocaleString()} 行
							</span>
						)}
					</>
				) : (
					<button className={styles.button} disabled={db.busy || !result?.hasMore} onClick={db.more}>
						加载更多 <ChevronDown size={12} />
					</button>
				)}
				<span role='status' className={styles.selectionStatus} title={selectionStatus}>
					{selectionStatus}
				</span>
				{result?.truncated ? (
					<span role='status'>已达到 10,000 行或 16 MB 显示上限</span>
				) : (
					<span className={styles.muted}>
						{result
							? `${result.rows.length ? (db.tab === 'data' ? db.query.offset + 1 : 1) : 0}–${(db.tab === 'data' ? db.query.offset : 0) + result.rows.length} 行`
							: ''}
					</span>
				)}
				{result && <span className={styles.muted}>{(result.elapsedMs / 1000).toFixed(3)} s</span>}
			</>
		) : (
			<span className={styles.spacer} />
		)

	return (
		<section
			className={styles.workspace}
			aria-label='数据库工作台'
			onDragOver={event => {
				if (event.dataTransfer.types.includes('Files')) event.preventDefault()
			}}
			onDrop={event => {
				if (event.dataTransfer.files.length) {
					event.preventDefault()
					db.open(event.dataTransfer.files[0])
				}
			}}>
			<input
				ref={input}
				aria-label='选择 SQLite 文件'
				type='file'
				hidden
				onChange={event => {
					db.open(event.target.files?.[0])
					event.target.value = ''
				}}
			/>
			<header className={styles.titlebar}>
				<Link href='/toolbox' className={styles.back} title='返回工具箱' aria-label='返回工具箱'>
					<ArrowLeft size={15} />
				</Link>
				<Database size={16} />
				<h1>数据库查看器</h1>
				{db.info && (
					<>
						<span className={styles.muted}>/</span>
						<span className={styles.filename} title={db.info.name}>
							{db.info.name}
						</span>
					</>
				)}
				<span className={styles.spacer} />
				{db.info && (
					<button className={`${styles.button} ${styles.primary}`} onClick={chooseFile}>
						<FolderOpen size={15} />
						切换文件
					</button>
				)}
				<button
					className={styles.button}
					onClick={() => setSidebar(!sidebar)}
					aria-label={sidebar ? '隐藏对象导航' : '显示对象导航'}
					title={sidebar ? '隐藏对象导航' : '显示对象导航'}>
					{sidebar ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
				</button>
				<button className={styles.button} disabled={!db.info && !db.busy} onClick={db.close} aria-label='关闭数据库'>
					<X size={14} />
					关闭
				</button>
			</header>
			<div className={styles.body}>
				{sidebar && (
					<>
						<aside className={styles.sidebar} style={{ width: sidebarWidth }} aria-label='对象导航'>
							<div className={styles.sidebarHeading}>数据库对象</div>
							<div className={styles.search}>
								<Search size={13} />
								<input aria-label='搜索表' placeholder='搜索表 / 视图' value={search} onChange={event => setSearch(event.target.value)} />
							</div>
							<div className={styles.tree}>
								{(
									[
										['table', '表', tables],
										['view', '视图', views]
									] as const
								).map(([type, title, objects]) => (
									<div key={type}>
										<button
											className={styles.treeGroup}
											aria-expanded={!collapsed[type] || !!search}
											onClick={() => setCollapsed(previous => ({ ...previous, [type]: !previous[type] }))}>
											{collapsed[type] && !search ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
											{type === 'table' ? <Table2 size={13} /> : <Eye size={13} />}
											<span>{title}</span>
											<span>{objects.length}</span>
										</button>
										{(!collapsed[type] || search) &&
											objects
												.filter(object => object.name.toLowerCase().includes(search.toLowerCase()))
												.map(object => (
													<button
														className={styles.treeItem}
														key={object.name}
														aria-label={`打开${type === 'table' ? '表' : '视图'} ${object.name}`}
														data-active={db.table === object.name}
														disabled={db.busy && !db.documents.some(document => document.kind === 'table' && document.title === object.name)}
														onClick={() => db.selectTable(object.name)}
														title={object.name}>
														{type === 'table' ? <Table2 size={13} /> : <Eye size={13} />}
														<span>{object.name}</span>
													</button>
												))}
									</div>
								))}
							</div>
						</aside>
						<PaneDivider value={sidebarWidth} onChange={setSidebarWidth} min={180} max={400} label='调整对象导航宽度' />
					</>
				)}
				<div className={styles.main}>
					<nav className={styles.tabs} aria-label='数据库视图'>
						<div ref={tabs} className={styles.tabList}>
							{db.documents.map(document => (
								<div key={document.id} className={styles.tab} data-active={db.activeId === document.id}>
									<button
										className={styles.tabLabel}
										aria-label={document.kind === 'sql' ? document.title : `标签 ${document.title}`}
										aria-pressed={db.activeId === document.id}
										onClick={() => db.activate(document.id)}
										title={document.title}>
										{document.kind === 'sql' ? (
											<FileCode2 size={13} />
										) : db.info?.objects.find(object => object.name === document.title)?.type === 'view' ? (
											<Eye size={13} />
										) : (
											<Table2 size={13} />
										)}
										<span>{document.title}</span>
									</button>
									<button className={styles.tabClose} onClick={() => db.closeDocument(document.id)} aria-label={`关闭标签 ${document.title}`} title='关闭标签'>
										<X size={12} />
									</button>
								</div>
							))}
						</div>
						<button
							className={styles.button}
							disabled={!db.info}
							onClick={db.showSql}
							aria-label={db.documents.some(document => document.kind === 'sql') ? '新建 SQL 查询' : 'SQL 查询'}
							title='新建 SQL 查询'>
							<FileCode2 size={13} /> SQL +
						</button>
					</nav>
					{db.error && (
						<div role='alert' className={styles.message}>
							<span>{db.error}</span>
							<button title='关闭错误提示' aria-label='关闭错误提示' onClick={() => db.setError('')}>
								<X size={13} />
							</button>
						</div>
					)}
					{!db.info ? (
						<div className={styles.empty}>
							<div className={styles.emptyInner}>
								<Database size={36} strokeWidth={1.4} />
								<h2>打开本地数据库</h2>
								<p>
									浏览表结构、筛选数据，或使用 SQL 查询。
									<br />将 SQLite 文件拖入窗口，即可开始。
								</p>
								<button className={`${styles.button} ${styles.primary}`} onClick={chooseFile}>
									<FolderOpen size={15} />
									选择 SQLite 文件
								</button>
								<p className={styles.hint}>最大 20 GB · 仅本地读取 · 支持完整、未加密的数据库文件</p>
							</div>
						</div>
					) : !db.activeId ? (
						<div className={styles.empty}>从左侧打开表或视图，或新建 SQL 查询。</div>
					) : (
						<div className={styles.view}>
							<div className={styles.objectToolbar}>
								{db.tab === 'sql' ? (
									<>
										<button className={`${styles.button} ${styles.primary}`} disabled={db.busy} onClick={() => db.run(db.sql)}>
											<Play size={12} />
											运行 SQL
										</button>
										<button className={styles.button} disabled={!db.busy || db.operationOwner !== db.activeId} onClick={db.cancel} aria-label='取消'>
											<Square size={12} />
											停止
										</button>
										<span className={styles.spacer} />
										<span className={styles.toolbarHint}>Ctrl / ⌘ + Enter 执行选中语句</span>
									</>
								) : (
									<>
										<button className={styles.mode} data-active={db.tab === 'data'} onClick={() => switchTab('data')}>
											<Rows3 size={13} />
											数据
										</button>
										<button className={styles.mode} data-active={db.tab === 'structure'} disabled={!db.structure} onClick={() => switchTab('structure')}>
											<Columns3 size={13} />
											结构
										</button>
										<span className={styles.spacer} />
										<button
											className={styles.button}
											disabled={db.busy}
											onClick={() => {
												db.setTab('data')
												db.browse(db.query)
											}}>
											<RefreshCw size={13} />
											刷新
										</button>
										{db.tab === 'data' && (
											<button
												className={styles.button}
												data-active={filterOpen}
												aria-pressed={filterOpen}
												disabled={!db.structure}
												onClick={() => setFilterOpen(!filterOpen)}>
												<Filter size={13} />
												筛选{db.query.filter ? ' · 1' : ''}
											</button>
										)}
									</>
								)}
							</div>
							{db.tab === 'data' && filterOpen && db.structure && (
								<form
									className={styles.filterBar}
									onSubmit={event => {
										event.preventDefault()
										db.browse({ ...db.query, offset: 0, filter: filterColumn ? { column: filterColumn, operator, value: filterValue } : undefined })
									}}>
									<Filter size={13} className={styles.muted} />
									<select
										className={styles.field}
										aria-label='筛选列'
										value={filterColumn}
										disabled={db.busy}
										onChange={event => setFilterColumn(event.target.value)}>
										<option value=''>全部数据</option>
										{db.structure.columns.map(column => (
											<option key={column.cid} value={column.name}>
												{column.name}
											</option>
										))}
									</select>
									<select
										className={styles.field}
										aria-label='筛选条件'
										value={operator}
										disabled={db.busy || !filterColumn}
										onChange={event => setOperator(event.target.value as typeof operator)}>
										<option value='contains'>包含</option>
										<option value='eq'>等于</option>
										<option value='gt'>大于</option>
										<option value='lt'>小于</option>
										<option value='null'>为空</option>
									</select>
									<input
										className={`${styles.field} ${styles.filterValue}`}
										aria-label='筛选值'
										placeholder='输入筛选值'
										value={filterValue}
										disabled={db.busy || !filterColumn || operator === 'null'}
										onChange={event => setFilterValue(event.target.value)}
									/>
									<button className={styles.button} disabled={db.busy}>
										应用筛选
									</button>
									<button
										type='button'
										className={styles.button}
										disabled={db.busy}
										onClick={() => {
											setFilterColumn('')
											setFilterValue('')
											db.browse({ ...db.query, offset: 0, filter: undefined })
										}}>
										清除
									</button>
								</form>
							)}
							{db.tab === 'structure' && db.structure ? (
								<StructureView structure={db.structure} />
							) : db.tab === 'sql' ? (
								<div className={styles.sqlSplit} style={{ '--editor-ratio': `${editorRatio}%` } as CSSProperties}>
									<div className={styles.editorPane}>
										<SqlEditor key={db.activeId} value={db.sql} onChange={db.setSql} onRun={db.run} disabled={db.busy} />
									</div>
									<PaneDivider horizontal percent value={editorRatio} onChange={setEditorRatio} min={18} max={70} label='调整 SQL 编辑区高度' />
									{results}
								</div>
							) : (
								results
							)}
						</div>
					)}
				</div>
			</div>
			<footer className={styles.statusbar} aria-label='数据库状态与分页'>
				<span role='status'>
					<i className={styles.statusDot} data-busy={db.busy} />
					{db.busy ? `${readingLabel}… ${elapsedSeconds} 秒` : db.notice || (db.info ? '就绪' : '未连接')}
				</span>
				{db.busy && (db.tab !== 'sql' || db.operationOwner !== db.activeId) && (
					<button className={styles.button} onClick={db.cancel} aria-label='取消'>
						<Square size={11} />
						停止
					</button>
				)}
				{resultFooter}
				{db.info && (
					<span className={styles.optional} title={`文件大小：${db.info.name}`}>
						{formatBytes(db.info.size)}
					</span>
				)}
				<span title={db.info ? `SQLite ${db.info.version} · 文件仅在本地读取` : '文件仅在本地读取'}>
					<LockKeyhole size={10} />
					本地只读
				</span>
			</footer>
		</section>
	)
}
