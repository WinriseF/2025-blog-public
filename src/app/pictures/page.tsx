'use client'

import { useState, useRef } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import initialList from './list.json'
import { RandomLayout } from './components/random-layout'
import UploadDialog from './components/upload-dialog'
import { pushPictures } from './services/push-pictures'
import { useAuthStore } from '@/hooks/use-auth'
import type { ImageItem } from '../projects/components/image-upload-dialog'
import { useRouter } from 'next/navigation'
import { SHOW_PUBLIC_ADMIN_ACTIONS } from '@/config/public-admin-actions'

export interface Picture {
	id: string
	uploadedAt: string
	description?: string
	images: string[]
}

export default function Page() {
	const [pictures, setPictures] = useState<Picture[]>(initialList as Picture[])
	const [originalPictures, setOriginalPictures] = useState<Picture[]>(initialList as Picture[])
	const [isEditMode, setIsEditMode] = useState(false)
	const [isSaving, setIsSaving] = useState(false)
	const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false)
	const [imageItems, setImageItems] = useState<Map<string, ImageItem>>(new Map())
	const keyInputRef = useRef<HTMLInputElement>(null)
	const router = useRouter()

	const { isAuth, setPrivateKey } = useAuthStore()

	const handleUploadSubmit = ({ images, description }: { images: ImageItem[]; description: string }) => {
		const now = new Date().toISOString()

		if (images.length === 0) {
			toast.error('请至少选择一张图片')
			return
		}

		const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
		const desc = description.trim() || undefined

		const imageUrls = images.map(imageItem => (imageItem.type === 'url' ? imageItem.url : imageItem.previewUrl))

		const newPicture: Picture = {
			id,
			uploadedAt: now,
			description: desc,
			images: imageUrls
		}

		const newMap = new Map(imageItems)

		images.forEach((imageItem, index) => {
			if (imageItem.type === 'file') {
				newMap.set(`${id}::${index}`, imageItem)
			}
		})

		setPictures(prev => [...prev, newPicture])
		setImageItems(newMap)
		setIsUploadDialogOpen(false)
	}

	const handleDeleteSingleImage = (pictureId: string, imageIndex: number) => {
		setPictures(prev => {
			return prev
				.map(picture => {
					if (picture.id !== pictureId) return picture

					const images = picture.images.filter((_, idx) => idx !== imageIndex)
					if (images.length === 0) {
						return null
					}

					return {
						...picture,
						images
					}
				})
				.filter((p): p is Picture => p !== null)
		})

		setImageItems(prev => {
			const next = new Map(prev)
			next.delete(`${pictureId}::${imageIndex}`)

			const keysToUpdate: Array<{ oldKey: string; newKey: string }> = []
			for (const key of next.keys()) {
				if (key.startsWith(`${pictureId}::`)) {
					const oldIndex = Number(key.split('::')[1])
					if (oldIndex > imageIndex) {
						keysToUpdate.push({
							oldKey: key,
							newKey: `${pictureId}::${oldIndex - 1}`
						})
					}
				}
			}

			for (const { oldKey, newKey } of keysToUpdate) {
				const value = next.get(oldKey)
				if (value) {
					next.set(newKey, value)
					next.delete(oldKey)
				}
			}

			return next
		})
	}

	const handleChoosePrivateKey = async (file: File) => {
		try {
			const text = await file.text()
			setPrivateKey(text)
			await handleSave()
		} catch (error) {
			console.error('Failed to read private key:', error)
			toast.error('读取密钥文件失败')
		}
	}

	const handleSaveClick = () => {
		if (!isAuth) {
			keyInputRef.current?.click()
		} else {
			handleSave()
		}
	}

	const handleSave = async () => {
		setIsSaving(true)

		try {
			await pushPictures({
				pictures,
				imageItems
			})

			setOriginalPictures(pictures)
			setImageItems(new Map())
			setIsEditMode(false)
			toast.success('保存成功！')
		} catch (error: any) {
			console.error('Failed to save:', error)
			toast.error(`保存失败: ${error?.message || '未知错误'}`)
		} finally {
			setIsSaving(false)
		}
	}

	const handleCancel = () => {
		setPictures(originalPictures)
		setImageItems(new Map())
		setIsEditMode(false)
	}

	const buttonText = isAuth ? '保存' : '导入密钥'

	return (
		<>
			<input
				ref={keyInputRef}
				type='file'
				accept='.pem'
				className='hidden'
				onChange={async e => {
					const f = e.target.files?.[0]
					if (f) await handleChoosePrivateKey(f)
					if (e.currentTarget) e.currentTarget.value = ''
				}}
			/>

			<RandomLayout
				pictures={pictures}
				isEditMode={SHOW_PUBLIC_ADMIN_ACTIONS && isEditMode}
				onDeleteSingle={handleDeleteSingleImage}
			/>

			{pictures.length === 0 && (
				<div className='text-secondary flex min-h-screen items-center justify-center text-center text-sm'>还没有图片。</div>
			)}

			{/* Public visitors should not see picture edit or upload controls; existing logic stays wired behind the flag. */}
			{SHOW_PUBLIC_ADMIN_ACTIONS && (
				<motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} className='absolute top-4 right-6 flex gap-3 max-sm:hidden'>
					{isEditMode ? (
						<>
							<motion.button
								whileHover={{ scale: 1.05 }}
								whileTap={{ scale: 0.95 }}
								onClick={() => router.push('/t')}
								className='rounded-xl border bg-blue-50 px-4 py-2 text-sm text-blue-700'>
								压缩工具
							</motion.button>
							<motion.button
								whileHover={{ scale: 1.05 }}
								whileTap={{ scale: 0.95 }}
								onClick={handleCancel}
								disabled={isSaving}
								className='rounded-xl border bg-white/60 px-6 py-2 text-sm'>
								取消
							</motion.button>
							<motion.button
								whileHover={{ scale: 1.05 }}
								whileTap={{ scale: 0.95 }}
								onClick={() => setIsUploadDialogOpen(true)}
								className='rounded-xl border bg-white/60 px-6 py-2 text-sm'>
								上传
							</motion.button>
							<motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleSaveClick} disabled={isSaving} className='brand-btn px-6'>
								{isSaving ? '保存中...' : buttonText}
							</motion.button>
						</>
					) : (
						<motion.button
							whileHover={{ scale: 1.05 }}
							whileTap={{ scale: 0.95 }}
							onClick={() => setIsEditMode(true)}
							className='rounded-xl border bg-white/60 px-6 py-2 text-sm backdrop-blur-sm transition-colors hover:bg-white/80'>
							编辑
						</motion.button>
					)}
				</motion.div>
			)}

			{SHOW_PUBLIC_ADMIN_ACTIONS && isUploadDialogOpen && <UploadDialog onClose={() => setIsUploadDialogOpen(false)} onSubmit={handleUploadSubmit} />}
		</>
	)
}
