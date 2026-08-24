'use client'

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TokenUsageSample } from '@/lib/codex-session/types'

export default function TokenChart({ samples }: { samples: TokenUsageSample[] }) {
	const stride = Math.max(Math.ceil(samples.length / 1000), 1)
	const data = samples.flatMap((sample, index) => index % stride === 0 || index === samples.length - 1 ? [{ request: index + 1, freshInput: sample.freshInput, cachedInput: sample.cachedInput, output: sample.output, reasoningOutput: sample.reasoningOutput }] : [])
	return (
		<div className='h-72 w-full'>
			<ResponsiveContainer width='100%' height='100%'>
				<ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
					<CartesianGrid stroke='var(--color-border)' strokeDasharray='3 3' opacity={0.55} />
					<XAxis dataKey='request' tick={{ fill: 'var(--color-secondary)', fontSize: 11 }} tickLine={false} axisLine={false} />
					<YAxis tick={{ fill: 'var(--color-secondary)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
					<Tooltip contentStyle={{ background: 'var(--color-article)', border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 12 }} labelFormatter={label => `模型步骤 ${label}`} />
					<Area type='monotone' dataKey='freshInput' name='Fresh input' stackId='input' fill='var(--color-brand)' stroke='var(--color-brand)' fillOpacity={0.38} />
					<Area type='monotone' dataKey='cachedInput' name='Cached input' stackId='input' fill='#22c55e' stroke='#22c55e' fillOpacity={0.3} />
					<Area type='monotone' dataKey='output' name='Output' fill='#f59e0b' stroke='#f59e0b' fillOpacity={0.2} />
					<Line type='monotone' dataKey='reasoningOutput' name='Reasoning（Output 子集）' stroke='#a855f7' strokeWidth={1.5} dot={false} />
				</ComposedChart>
			</ResponsiveContainer>
		</div>
	)
}
