import { KeyRound, FileCode2 } from 'lucide-react'
import type { TableStructure } from '@/lib/database/types'
import styles from './database.module.css'

export function StructureView({ structure }: { structure: TableStructure }) {
	return (
		<div className={styles.structure}>
			<div className={styles.structureMain}>
				<div className={styles.paneHeading}>
					<strong>字段</strong>
					<span>{structure.columns.length}</span>
				</div>
				<table className={styles.schemaTable}>
					<thead>
						<tr>
							{['名称', '类型', '非空', '主键', '默认值'].map(name => (
								<th key={name}>{name}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{structure.columns.map(column => (
							<tr key={column.cid}>
								<td>
									<span className='flex items-center gap-2'>
										{column.pk > 0 && <KeyRound size={12} className='text-amber-500' />}
										{column.name}
									</span>
								</td>
								<td>{column.type || '—'}</td>
								<td>{column.notnull ? '✓' : '—'}</td>
								<td>{column.pk || '—'}</td>
								<td>{column.dflt_value ?? 'NULL'}</td>
							</tr>
						))}
					</tbody>
				</table>
				<div className={styles.schemaSection}>
					索引 <span className={styles.muted}>({structure.indexes.length})</span>
				</div>
				{structure.indexes.length ? (
					<table className={styles.schemaTable}>
						<thead>
							<tr>
								<th>名称</th>
								<th>唯一</th>
								<th>来源</th>
								<th>部分索引</th>
							</tr>
						</thead>
						<tbody>
							{structure.indexes.map((index, i) => (
								<tr key={i}>
									<td>{String(index.name)}</td>
									<td>{index.unique ? '✓' : '—'}</td>
									<td>{String(index.origin)}</td>
									<td>{index.partial ? '✓' : '—'}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p className={styles.schemaEmpty}>无索引</p>
				)}
				<div className={styles.schemaSection}>
					外键 <span className={styles.muted}>({structure.foreignKeys.length})</span>
				</div>
				{structure.foreignKeys.length ? (
					<table className={styles.schemaTable}>
						<thead>
							<tr>
								<th>字段</th>
								<th>引用表</th>
								<th>引用字段</th>
								<th>更新规则</th>
								<th>删除规则</th>
							</tr>
						</thead>
						<tbody>
							{structure.foreignKeys.map((key, i) => (
								<tr key={i}>
									{['from', 'table', 'to', 'on_update', 'on_delete'].map(name => (
										<td key={name}>{key[name] == null ? '—' : String(key[name])}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p className={styles.schemaEmpty}>无外键</p>
				)}
			</div>
			<aside className={styles.ddlPane}>
				<div className={styles.paneHeading}>
					<FileCode2 size={13} />
					<strong>DDL · 建表语句</strong>
				</div>
				<pre>{structure.sql}</pre>
			</aside>
		</div>
	)
}
