'use client'

import { useCallback, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { FileUp } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

type OcrUploadProps = {
	onFile: (file: File) => void
}

export function OcrUpload({ onFile }: OcrUploadProps) {
	const inputId = useId()
	const inputRef = useRef<HTMLInputElement | null>(null)
	const dragCounterRef = useRef(0)
	const shouldReduceMotion = useReducedMotion()
	const [dragging, setDragging] = useState(false)

	const useFirstFile = useCallback(
		(files: FileList | null) => {
			const file = files?.[0]
			if (file) onFile(file)
		},
		[onFile]
	)

	const handleDragEnter = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		dragCounterRef.current += 1
		setDragging(true)
	}, [])

	const handleDragLeave = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
		if (dragCounterRef.current === 0) setDragging(false)
	}, [])

	const handleDrop = useCallback(
		(event: DragEvent<HTMLLabelElement>) => {
			event.preventDefault()
			dragCounterRef.current = 0
			setDragging(false)
			useFirstFile(event.dataTransfer.files)
		},
		[useFirstFile]
	)

	const handleKeyDown = useCallback((event: KeyboardEvent<HTMLLabelElement>) => {
		if (event.key !== 'Enter' && event.key !== ' ') return
		event.preventDefault()
		inputRef.current?.click()
	}, [])

	return (
		<motion.label
			htmlFor={inputId}
			role='button'
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onDragEnter={handleDragEnter}
			onDragOver={event => event.preventDefault()}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			animate={{ scale: dragging && !shouldReduceMotion ? 1.01 : 1 }}
			whileHover={shouldReduceMotion || dragging ? undefined : { y: -2 }}
			whileTap={shouldReduceMotion ? undefined : { scale: 0.995 }}
			transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
			className={`group focus-visible:ring-brand focus-visible:ring-offset-background flex min-h-[300px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 max-sm:min-h-[230px] max-sm:p-6 ${
				dragging ? 'border-brand bg-brand/10' : 'border-brand/30 bg-background/25 hover:border-brand/55 hover:bg-brand/5'
			}`}>
			<input
				ref={inputRef}
				id={inputId}
				type='file'
				accept='image/png,image/jpeg,image/jpg,image/webp,application/pdf,.pdf'
				className='hidden'
				onChange={event => {
					useFirstFile(event.currentTarget.files)
					event.currentTarget.value = ''
				}}
			/>
			<div className='bg-brand/10 text-brand group-hover:bg-brand/15 flex size-20 items-center justify-center rounded-lg transition-colors duration-200 max-sm:size-16'>
				<FileUp size={36} strokeWidth={1.7} />
			</div>
			<div className='mt-5'>
				<p className='text-primary text-lg font-semibold max-sm:text-base'>点击或拖拽图片 / PDF，也可粘贴图片</p>
				<p className='text-secondary mt-2 text-sm'>支持 PNG / JPG / JPEG / WEBP / PDF</p>
			</div>
		</motion.label>
	)
}
