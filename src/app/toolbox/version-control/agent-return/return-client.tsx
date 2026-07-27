'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { consumeVersionControlCallback, deliverVersionControlCallback } from '@/lib/version-control/launch-client'

export function VersionControlReturnClient() {
	const [success, setSuccess] = useState<boolean | null>(null)
	const handled = useRef(false)
	useEffect(() => {
		if (handled.current) return
		handled.current = true
		const callback = consumeVersionControlCallback()
		setSuccess(Boolean(callback))
		if (!callback) return
		deliverVersionControlCallback(callback)
		const timer = window.setTimeout(() => window.close(), 700)
		return () => window.clearTimeout(timer)
	}, [])
	return (
		<main className='bg-background text-primary flex min-h-[100dvh] items-center justify-center p-6'>
			<div className='border-border bg-article w-full max-w-sm rounded-2xl border p-7 text-center'>
				{success === false ? <CircleAlert className='mx-auto text-red-400' /> : <CheckCircle2 className='text-brand mx-auto' />}
				<h1 className='mt-4 text-lg font-semibold'>{success === false ? '版本控制器回调无效' : '正在连接版本控制器'}</h1>
				<p className='text-secondary mt-2 text-sm'>{success === false ? '请返回工具页重新启动 Agent。' : '短期凭据已交还原页面，可以关闭此页。'}</p>
			</div>
		</main>
	)
}
