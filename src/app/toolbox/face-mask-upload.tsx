'use client'

import { useCallback, useRef, useState, type DragEvent } from 'react'
import { ImageIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

type FaceMaskUploadProps = {
	onFiles: (files: FileList | null) => void
}

export function FaceMaskUpload({ onFiles }: FaceMaskUploadProps) {
	const shouldReduceMotion = useReducedMotion()
	const [dragging, setDragging] = useState(false)
	const dragCounterRef = useRef(0)

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
			onFiles(event.dataTransfer.files)
		},
		[onFiles]
	)

	return (
		<motion.label
			onDragEnter={handleDragEnter}
			onDragOver={event => event.preventDefault()}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			animate={{ scale: dragging && !shouldReduceMotion ? 1.01 : 1 }}
			whileHover={shouldReduceMotion || dragging ? undefined : { y: -2 }}
			whileTap={shouldReduceMotion ? undefined : { scale: 0.995 }}
			className={`group flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center transition max-sm:min-h-[220px] max-sm:p-6 ${
				dragging ? 'border-brand bg-brand/10' : 'border-brand/30 bg-background/25 hover:border-brand/50 hover:bg-brand/5'
			}`}>
			<input
				type='file'
				accept='image/png,image/jpeg,image/jpg,image/webp'
				className='hidden'
				onChange={event => {
					onFiles(event.target.files)
					event.currentTarget.value = ''
				}}
			/>
			<motion.div
				animate={{ y: dragging && !shouldReduceMotion ? -3 : 0, scale: dragging && !shouldReduceMotion ? 1.06 : 1 }}
				className='text-brand bg-brand/10 group-hover:bg-brand/15 flex h-20 w-20 items-center justify-center rounded-2xl transition max-sm:h-16 max-sm:w-16'>
				<ImageIcon size={36} strokeWidth={1.7} />
			</motion.div>
			<div className='mt-5'>
				<p className='text-lg font-semibold text-primary max-sm:text-base'>点击或拖拽图片</p>
				<p className='text-secondary mt-2 text-sm'>支持 PNG / JPG / JPEG / WEBP</p>
			</div>
		</motion.label>
	)
}
