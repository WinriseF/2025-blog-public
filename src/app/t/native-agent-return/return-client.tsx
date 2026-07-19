'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { consumeLanAgentCallback, deliverLanAgentCallback } from '@/lib/lan-transfer/native-agent/launch-client'

export function NativeAgentReturnClient() {
	const [success, setSuccess] = useState<boolean | null>(null)
	const callbackResultRef = useRef<boolean | null>(null)

	useEffect(() => {
		if (callbackResultRef.current === null) {
			const callback = consumeLanAgentCallback()
			callbackResultRef.current = Boolean(callback)
			if (callback) deliverLanAgentCallback(callback)
		}
		setSuccess(callbackResultRef.current)
		if (!callbackResultRef.current) return
		const timer = window.setTimeout(() => window.close(), 700)
		return () => window.clearTimeout(timer)
	}, [])

	return (
		<main className='bg-background text-primary flex min-h-[100dvh] items-center justify-center p-6'>
			<div className='border-border bg-article w-full max-w-sm rounded-3xl border p-7 text-center shadow-sm'>
				{success === false ? <CircleAlert className='mx-auto text-red-400' size={34} /> : <CheckCircle2 className='text-brand mx-auto' size={34} />}
				<h1 className='mt-4 text-lg font-semibold'>{success === false ? '加速组件回调无效' : '正在连接极速模式'}</h1>
				<p className='text-secondary mt-2 text-sm'>{success === false ? '请返回传输页面重新开启极速模式。' : '凭据已安全交还原页面，可以关闭此页。'}</p>
			</div>
		</main>
	)
}
