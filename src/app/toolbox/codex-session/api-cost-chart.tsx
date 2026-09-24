'use client'

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ApiCostStep } from '@/lib/codex-session/api-cost'
import { formatUsd } from './format'

export default function ApiCostChart({ steps }: { steps: ApiCostStep[] }) {
	const stride = Math.max(Math.ceil(steps.length / 1000), 1)
	const data = steps.filter((_, index) => index % stride === 0 || index === steps.length - 1)
	return <div className='h-64 w-full'>
		<ResponsiveContainer width='100%' height='100%'>
			<AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
				<CartesianGrid stroke='var(--color-border)' strokeDasharray='3 3' opacity={0.55} />
				<XAxis dataKey='step' tick={{ fill: 'var(--color-secondary)', fontSize: 11 }} tickLine={false} axisLine={false} />
				<YAxis tickFormatter={(value: number) => formatUsd(value)} tick={{ fill: 'var(--color-secondary)', fontSize: 11 }} tickLine={false} axisLine={false} width={82} />
				<Tooltip content={({ active, payload }) => {
					const point = payload?.[0]?.payload as ApiCostStep | undefined
					if (!active || !point) return null
					return <div className='rounded-xl border border-border bg-article px-3 py-2 text-xs shadow-lg'>
						<p className='font-medium'>模型步骤 {point.step} · {point.model}</p>
						<p className='text-secondary mt-1'>本步 {formatUsd(point.cost)}</p>
						<p className='text-brand mt-1 font-semibold'>累计 {formatUsd(point.cumulative)}</p>
					</div>
				}} />
				<Area type='monotone' dataKey='cumulative' stroke='var(--color-brand)' strokeWidth={2} fill='var(--color-brand)' fillOpacity={0.16} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
			</AreaChart>
		</ResponsiveContainer>
	</div>
}
