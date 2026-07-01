'use client'

import { useState } from 'react'
import { AlertTriangle, BarChart3, Database, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import type { TransferCleanupResponse, TransferErrorBody, TransferStatsObjectType, TransferStatsResponse } from '@/lib/transfer-types'

const transferApiBase = (process.env.NEXT_PUBLIC_TRANSFER_API_BASE || '').replace(/\/+$/, '')
const typeLabels: Record<TransferStatsObjectType, string> = {
	chunk: '文件分片',
	meta: '元信息',
	consumed: '销毁标记',
	'code-index': '提取码索引',
	'expire-index': '过期索引',
	rate: '频率记录',
	other: '其它'
}

function transferApiUrl(action: string) {
	if (!transferApiBase) throw new Error('未配置 Edge Functions API 地址')
	return `${transferApiBase}/api/transfer/${action}`
}

function formatBytes(value: number) {
	if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
	if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`
	if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
	return `${value} B`
}

function formatDate(value: number) {
	return new Intl.DateTimeFormat('zh-CN', {
		dateStyle: 'short',
		timeStyle: 'medium',
		hour12: false
	}).format(value)
}

async function readStatsError(response: Response) {
	const body = (await response.json().catch(() => null)) as TransferErrorBody | null
	return body?.message || '读取状态失败'
}

export function TransferStatusClient() {
	const [password, setPassword] = useState('')
	const [topLimit, setTopLimit] = useState(50)
	const [stats, setStats] = useState<TransferStatsResponse | null>(null)
	const [cleanup, setCleanup] = useState<TransferCleanupResponse | null>(null)
	const [status, setStatus] = useState('')
	const [busy, setBusy] = useState(false)
	const [cleanupBusy, setCleanupBusy] = useState(false)

	const loadStats = async () => {
		setBusy(true)
		setStatus('')
		try {
			const response = await fetch(transferApiUrl('stats'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password, topLimit })
			})
			if (!response.ok) throw new Error(await readStatsError(response))
			setStats((await response.json()) as TransferStatsResponse)
			setStatus('状态已刷新')
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '读取状态失败')
		} finally {
			setBusy(false)
		}
	}

	const runCleanup = async () => {
		if (!window.confirm('确定清理所有公网中转对象吗？当前未读取的中转内容也会失效。')) return
		setCleanupBusy(true)
		setStatus('')
		try {
			const response = await fetch(transferApiUrl('cleanup'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			})
			if (!response.ok) throw new Error(await readStatsError(response))
			const result = (await response.json()) as TransferCleanupResponse
			setCleanup(result)
			setStats(null)
			setStatus(`清理完成：扫描 ${result.scanned} 个对象，删除 ${result.cleaned} 个对象`)
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '清理失败')
		} finally {
			setCleanupBusy(false)
		}
	}

	const typeRows = stats
		? (Object.entries(stats.byType) as Array<[TransferStatsObjectType, { count: number; bytes: number }]>).sort((a, b) => b[1].bytes - a[1].bytes)
		: []

	return (
		<div className='space-y-6'>
			<div className='flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5'>
				<div className='space-y-2'>
					<p className='text-secondary text-xs tracking-[0.18em] uppercase'>Transfer Status</p>
					<h1 className='text-2xl font-semibold'>公网中转存储状态</h1>
					<p className='text-secondary max-w-2xl text-sm leading-6'>输入管理密码后查看 Pages Blob 当前对象数量、占用大小和最大对象。统计接口只读，不会修改或清理中转内容。</p>
				</div>
				{stats && <div className='text-secondary rounded-full border border-border bg-background/30 px-3 py-1.5 text-xs'>更新时间：{formatDate(stats.generatedAt)}</div>}
			</div>

			<section className='grid gap-3 rounded-2xl border border-border bg-background/30 p-4 md:grid-cols-[minmax(0,1fr)_140px_160px]'>
				<label className='relative block'>
					<KeyRound className='text-secondary absolute top-1/2 left-3 -translate-y-1/2' size={16} />
					<input
						type='password'
						value={password}
						onChange={event => setPassword(event.target.value)}
						onKeyDown={event => {
							if (event.key === 'Enter') void loadStats()
						}}
						placeholder='管理密码'
						className='w-full rounded-2xl border border-border bg-article py-3 pr-4 pl-10 text-sm'
					/>
				</label>
				<input
					type='number'
					min={0}
					max={200}
					value={topLimit}
					onChange={event => setTopLimit(Math.max(0, Math.min(200, Number(event.target.value) || 0)))}
					className='w-full rounded-2xl border border-border bg-article px-4 py-3 text-sm'
					aria-label='最大对象条数'
				/>
				<button disabled={busy || cleanupBusy || !password} onClick={() => void loadStats()} className='bg-brand text-background flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-50'>
					<RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
					刷新状态
				</button>
			</section>

			<section className='flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200/60 bg-red-50/10 p-4'>
				<div className='space-y-1'>
					<h2 className='font-semibold'>管理员清理</h2>
					<p className='text-secondary text-sm'>立即清理 Blob 里的公网中转对象。北京 02 点定时清理仍然保留。</p>
					{cleanup && <p className='text-secondary text-xs'>上次清理：扫描 {cleanup.scanned}，删除 {cleanup.cleaned}，失败 {cleanup.deleteErrorCount}</p>}
					{cleanup?.deleteErrorCount ? (
						<div className='space-y-1 pt-1'>
							{cleanup.errors.map(error => (
								<p key={error.key} className='text-secondary break-all text-xs'>
									{error.key}：{error.message}
								</p>
							))}
						</div>
					) : null}
				</div>
				<button disabled={busy || cleanupBusy || !password} onClick={() => void runCleanup()} className='flex items-center justify-center gap-2 rounded-full border border-red-300/70 px-5 py-3 text-sm font-semibold text-red-600 disabled:opacity-50'>
					<Trash2 size={16} />
					{cleanupBusy ? '清理中...' : '立即清理'}
				</button>
			</section>

			{status && <p className='text-secondary rounded-2xl border border-border bg-article px-4 py-3 text-sm'>{status}</p>}

			{stats && (
				<>
					<section className='grid gap-4 md:grid-cols-3'>
						<div className='rounded-2xl border border-border bg-background/30 p-5'>
							<div className='text-secondary flex items-center gap-2 text-xs'>
								<Database size={15} />
								Blob Store
							</div>
							<p className='mt-3 truncate text-xl font-semibold'>{stats.store}</p>
						</div>
						<div className='rounded-2xl border border-border bg-background/30 p-5'>
							<div className='text-secondary flex items-center gap-2 text-xs'>
								<BarChart3 size={15} />
								总占用
							</div>
							<p className='mt-3 text-xl font-semibold'>{formatBytes(stats.totalBytes)}</p>
						</div>
						<div className='rounded-2xl border border-border bg-background/30 p-5'>
							<div className='text-secondary flex items-center gap-2 text-xs'>
								<BarChart3 size={15} />
								对象数量
							</div>
							<p className='mt-3 text-xl font-semibold'>{stats.objectCount}</p>
						</div>
					</section>

					<section className='grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]'>
						<div className='space-y-3 rounded-2xl border border-border bg-background/30 p-5'>
							<h2 className='font-semibold'>分类占用</h2>
							{typeRows.length ? (
								<div className='space-y-3'>
									{typeRows.map(([type, item]) => (
										<div key={type} className='space-y-1'>
											<div className='flex items-center justify-between gap-3 text-sm'>
												<span>{typeLabels[type] || type}</span>
												<span className='text-secondary'>{formatBytes(item.bytes)}</span>
											</div>
											<div className='h-2 overflow-hidden rounded-full bg-border/60'>
												<div className='bg-brand h-full rounded-full' style={{ width: `${stats.totalBytes ? Math.max(2, (item.bytes / stats.totalBytes) * 100) : 0}%` }} />
											</div>
											<p className='text-secondary text-xs'>{item.count} 个对象</p>
										</div>
									))}
								</div>
							) : (
								<p className='text-secondary text-sm'>暂无对象</p>
							)}
						</div>

						<div className='min-w-0 rounded-2xl border border-border bg-background/30 p-5'>
							<div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
								<h2 className='font-semibold'>最大对象</h2>
								<p className='text-secondary text-xs'>最多显示 {topLimit} 条</p>
							</div>
							<div className='overflow-x-auto'>
								<table className='w-full min-w-[720px] text-left text-sm'>
									<thead className='text-secondary border-b border-border text-xs'>
										<tr>
											<th className='py-2 pr-3 font-medium'>对象</th>
											<th className='py-2 pr-3 font-medium'>类型</th>
											<th className='py-2 pr-3 font-medium'>大小</th>
											<th className='py-2 font-medium'>Content-Type</th>
										</tr>
									</thead>
									<tbody>
										{stats.top.map(item => (
											<tr key={item.key} className='border-b border-border/60 last:border-0'>
												<td className='max-w-[460px] truncate py-2 pr-3 font-mono text-xs'>{item.key}</td>
												<td className='py-2 pr-3'>{typeLabels[item.type] || item.type}</td>
												<td className='py-2 pr-3'>{formatBytes(item.bytes)}</td>
												<td className='text-secondary py-2'>{item.contentType || '-'}</td>
											</tr>
										))}
										{!stats.top.length && (
											<tr>
												<td colSpan={4} className='text-secondary py-6 text-center'>
													暂无对象
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						</div>
					</section>

					{stats.metadataErrorCount > 0 && (
						<section className='space-y-3 rounded-2xl border border-amber-300/50 bg-amber-50/20 p-5'>
							<div className='flex items-center gap-2 font-semibold'>
								<AlertTriangle size={16} />
								Metadata 读取失败：{stats.metadataErrorCount}
							</div>
							<div className='space-y-2'>
								{stats.errors.map(error => (
									<p key={error.key} className='text-secondary break-all rounded-xl border border-border bg-article px-3 py-2 text-xs'>
										{error.key}：{error.message}
									</p>
								))}
							</div>
						</section>
					)}
				</>
			)}
		</div>
	)
}
