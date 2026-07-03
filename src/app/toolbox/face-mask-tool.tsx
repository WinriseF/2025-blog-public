'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FaceMaskControls } from './face-mask-controls'
import { FaceMaskEditor } from './face-mask-editor'
import { FaceMaskUpload } from './face-mask-upload'
import { detectFaceRects } from '@/lib/face-mask/detector'
import { downloadMaskedImage } from '@/lib/face-mask/export-image'
import { moveRect, resizeRect } from '@/lib/face-mask/geometry'
import { DEFAULT_STICKER } from '@/lib/face-mask/stickers'
import type { EditorMode, LoadedImage, MaskItem, MaskMode, Rect } from '@/lib/face-mask/types'

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

function createMaskId() {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
	return `mask-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function disposeImage(image: LoadedImage | null) {
	if (!image) return
	URL.revokeObjectURL(image.previewUrl)
	image.bitmap.close()
}

function makeMask(rect: Rect, mode: MaskMode, emoji: string, source: MaskItem['source']): MaskItem {
	return {
		id: createMaskId(),
		...rect,
		mode,
		emoji,
		source
	}
}

export function FaceMaskTool() {
	const [image, setImage] = useState<LoadedImage | null>(null)
	const [masks, setMasks] = useState<MaskItem[]>([])
	const [history, setHistory] = useState<MaskItem[][]>([])
	const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null)
	const [defaultMode, setDefaultMode] = useState<MaskMode>('mosaic')
	const [defaultEmoji, setDefaultEmoji] = useState(DEFAULT_STICKER.emoji)
	const [editorMode, setEditorMode] = useState<EditorMode>('idle')
	const [detecting, setDetecting] = useState(false)
	const [statusText, setStatusText] = useState('点击或拖拽图片开始。')
	const [zoom, setZoom] = useState(1)
	const imageRef = useRef<LoadedImage | null>(null)
	const masksRef = useRef<MaskItem[]>([])
	const fileInputRef = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		imageRef.current = image
	}, [image])

	useEffect(() => {
		masksRef.current = masks
	}, [masks])

	useEffect(() => {
		return () => disposeImage(imageRef.current)
	}, [])

	const selectedMask = useMemo(() => masks.find(mask => mask.id === selectedMaskId) ?? null, [masks, selectedMaskId])
	const creating = editorMode === 'creating'

	const recordHistory = useCallback(() => {
		const snapshot = masksRef.current.map(mask => ({ ...mask }))
		setHistory(prev => [...prev, snapshot].slice(-20))
	}, [])

	const handleFiles = useCallback(async (fileList: FileList | null) => {
		const file = Array.from(fileList ?? []).find(item => item.type.startsWith('image/'))
		if (!file) return
		if (file.type && !SUPPORTED_IMAGE_TYPES.has(file.type)) {
			toast.error('暂只支持 PNG、JPG、JPEG、WEBP 图片')
			return
		}

		try {
			const bitmap = await createImageBitmap(file)
			const loaded: LoadedImage = {
				file,
				name: file.name || 'image',
				type: file.type || 'image/png',
				previewUrl: URL.createObjectURL(file),
				width: bitmap.width,
				height: bitmap.height,
				bitmap
			}

			setImage(prev => {
				disposeImage(prev)
				return loaded
			})
			setMasks([])
			setHistory([])
			setSelectedMaskId(null)
			setEditorMode('idle')
			setZoom(1)
			setStatusText('图片已加载，可自动检测人脸，也可以手动新增遮挡区域。')
			toast.success('图片已加载')
		} catch (error) {
			console.error(error)
			toast.error('图片读取失败，请换一张图片试试')
		}
	}, [])

	const updateMask = useCallback((id: string, updater: (mask: MaskItem) => MaskItem) => {
		setMasks(prev => prev.map(mask => (mask.id === id ? updater(mask) : mask)))
	}, [])

	const handleDetect = useCallback(async () => {
		const currentImage = imageRef.current
		if (!currentImage || detecting) return

		setDetecting(true)
		setStatusText('正在加载检测模型...')
		try {
			setStatusText('正在检测人脸...')
			const rects = await detectFaceRects(currentImage.bitmap, currentImage.width, currentImage.height)

			if (!rects.length) {
				setStatusText('没有自动检测到人脸，你可以手动添加遮挡区域。')
				toast.info('没有自动检测到人脸')
				return
			}

			const detectedMasks = rects.map(rect => makeMask(rect, defaultMode, defaultEmoji, 'auto'))
			recordHistory()
			setMasks(prev => [...prev.filter(mask => mask.source !== 'auto'), ...detectedMasks])
			setSelectedMaskId(detectedMasks[0]?.id ?? null)
			setStatusText(`检测到 ${detectedMasks.length} 个区域，可继续手动调整。`)
			toast.success(`检测到 ${detectedMasks.length} 个区域`)
		} catch (error) {
			console.error(error)
			setStatusText('自动检测失败，你仍然可以手动添加遮挡区域。')
			toast.error('自动检测失败，可继续手动添加区域')
		} finally {
			setDetecting(false)
		}
	}, [defaultEmoji, defaultMode, detecting, recordHistory])

	const handleCreateMask = useCallback(
		(rect: Rect) => {
			const mask = makeMask(rect, defaultMode, defaultEmoji, 'manual')
			recordHistory()
			setMasks(prev => [...prev, mask])
			setSelectedMaskId(mask.id)
			setStatusText(`当前共有 ${masksRef.current.length + 1} 个区域，可继续手动调整。`)
		},
		[defaultEmoji, defaultMode, recordHistory]
	)

	const handleMoveMask = useCallback(
		(id: string, dx: number, dy: number) => {
			const currentImage = imageRef.current
			if (!currentImage) return
			updateMask(id, mask => ({
				...mask,
				...moveRect(mask, dx, dy, currentImage.width, currentImage.height)
			}))
		},
		[updateMask]
	)

	const handleResizeMask = useCallback(
		(id: string, width: number, height: number) => {
			const currentImage = imageRef.current
			if (!currentImage) return
			updateMask(id, mask => ({
				...mask,
				...resizeRect(mask, width, height, currentImage.width, currentImage.height)
			}))
		},
		[updateMask]
	)

	const handleInteractionStart = useCallback(
		(mode: EditorMode) => {
			recordHistory()
			setEditorMode(mode)
		},
		[recordHistory]
	)

	const handleInteractionEnd = useCallback(() => {
		setEditorMode('idle')
	}, [])

	const handleModeChange = useCallback(
		(mode: MaskMode) => {
			if (selectedMaskId) {
				recordHistory()
				updateMask(selectedMaskId, mask => ({
					...mask,
					mode,
					emoji: mode === 'emoji' ? mask.emoji || defaultEmoji : mask.emoji
				}))
			} else {
				setDefaultMode(mode)
			}
		},
		[defaultEmoji, recordHistory, selectedMaskId, updateMask]
	)

	const handleStickerChange = useCallback(
		(emoji: string) => {
			setDefaultEmoji(emoji)
			setDefaultMode('emoji')
			if (selectedMaskId) {
				recordHistory()
				updateMask(selectedMaskId, mask => ({ ...mask, mode: 'emoji', emoji }))
			}
		},
		[recordHistory, selectedMaskId, updateMask]
	)

	const handleCustomSticker = useCallback(() => {
		const value = window.prompt('输入一个用于遮挡的表情', defaultEmoji)
		const emoji = Array.from(value?.trim() ?? '')[0]
		if (emoji) handleStickerChange(emoji)
	}, [defaultEmoji, handleStickerChange])

	const handleDeleteMask = useCallback(
		(id: string) => {
			recordHistory()
			setMasks(prev => prev.filter(mask => mask.id !== id))
			setSelectedMaskId(current => (current === id ? null : current))
			setStatusText('已删除当前遮挡区域。')
		},
		[recordHistory]
	)

	const handleClearMasks = useCallback(() => {
		if (!masksRef.current.length) return
		recordHistory()
		setMasks([])
		setSelectedMaskId(null)
		setStatusText('已清空所有遮挡区域。')
	}, [recordHistory])

	const handleUndo = useCallback(() => {
		setHistory(prev => {
			const last = prev[prev.length - 1]
			if (!last) return prev
			setMasks(last)
			setSelectedMaskId(null)
			setStatusText('已撤销上一步遮挡编辑。')
			return prev.slice(0, -1)
		})
	}, [])

	const handleExport = useCallback(async () => {
		const currentImage = imageRef.current
		if (!currentImage) return

		try {
			await downloadMaskedImage(currentImage, masksRef.current)
			toast.success('图片已导出')
		} catch (error) {
			console.error(error)
			toast.error('导出失败，请稍后再试')
		}
	}, [])

	return (
		<div className='mx-auto flex max-w-6xl flex-col gap-6'>
			<input
				ref={fileInputRef}
				type='file'
				accept='image/png,image/jpeg,image/jpg,image/webp'
				className='hidden'
				onChange={event => {
					void handleFiles(event.target.files)
					event.currentTarget.value = ''
				}}
			/>

			<header>
				<h1 className='text-2xl font-semibold tracking-normal text-primary'>人脸打码</h1>
				<p className='text-secondary mt-3 text-sm'>自动检测人脸，也可以手动调整遮挡区域</p>
			</header>

			{image ? (
				<>
					<FaceMaskEditor
						image={image}
						masks={masks}
						selectedMaskId={selectedMaskId}
						defaultMode={defaultMode}
						defaultEmoji={defaultEmoji}
						creating={creating}
						zoom={zoom}
						onCreateMask={handleCreateMask}
						onCreateEnd={() => setEditorMode('idle')}
						onSelectMask={setSelectedMaskId}
						onMoveMask={handleMoveMask}
						onResizeMask={handleResizeMask}
						onDeleteMask={handleDeleteMask}
						onInteractionStart={handleInteractionStart}
						onInteractionEnd={handleInteractionEnd}
					/>
					<FaceMaskControls
						masks={masks}
						selectedMask={selectedMask}
						defaultMode={defaultMode}
						defaultEmoji={defaultEmoji}
						statusText={statusText}
						detecting={detecting}
						creating={creating}
						zoom={zoom}
						canUndo={history.length > 0}
						onModeChange={handleModeChange}
						onStickerChange={handleStickerChange}
						onCustomSticker={handleCustomSticker}
						onDetect={handleDetect}
						onCreate={() => setEditorMode(creating ? 'idle' : 'creating')}
						onClear={handleClearMasks}
						onDeleteSelected={() => selectedMaskId && handleDeleteMask(selectedMaskId)}
						onUndo={handleUndo}
						onExport={handleExport}
						onReplaceImage={() => fileInputRef.current?.click()}
						onZoomIn={() => setZoom(value => Math.min(1.8, Number((value + 0.1).toFixed(2))))}
						onZoomOut={() => setZoom(value => Math.max(0.5, Number((value - 0.1).toFixed(2))))}
					/>
				</>
			) : (
				<FaceMaskUpload onFiles={files => void handleFiles(files)} />
			)}
		</div>
	)
}
