'use client'

import { useRef } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { hashFileSHA256 } from '@/lib/file-utils'
import { getAssetUrl } from '@/lib/asset-url'
import type { FileItem } from './types'
import { SHOW_PUBLIC_ADMIN_ACTIONS } from '@/config/public-admin-actions'
import { OptimizedImage } from '@/components/optimized-image'

interface FaviconAvatarUploadProps {
	faviconItem: FileItem | null
	setFaviconItem: React.Dispatch<React.SetStateAction<FileItem | null>>
	avatarItem: FileItem | null
	setAvatarItem: React.Dispatch<React.SetStateAction<FileItem | null>>
}

export function FaviconAvatarUpload({ faviconItem, setFaviconItem, avatarItem, setAvatarItem }: FaviconAvatarUploadProps) {
	const faviconInputRef = useRef<HTMLInputElement>(null)
	const avatarInputRef = useRef<HTMLInputElement>(null)

	const handleFaviconFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return

		if (!file.type.startsWith('image/')) {
			toast.error('请选择图片文件')
			return
		}

		const hash = await hashFileSHA256(file)
		const previewUrl = URL.createObjectURL(file)
		setFaviconItem({ type: 'file', file, previewUrl, hash })
		if (e.currentTarget) e.currentTarget.value = ''
	}

	const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return

		if (!file.type.startsWith('image/')) {
			toast.error('请选择图片文件')
			return
		}

		const hash = await hashFileSHA256(file)
		const previewUrl = URL.createObjectURL(file)
		setAvatarItem({ type: 'file', file, previewUrl, hash })
		if (e.currentTarget) e.currentTarget.value = ''
	}

	const handleRemoveFavicon = () => {
		if (faviconItem?.type === 'file') {
			URL.revokeObjectURL(faviconItem.previewUrl)
		}
		setFaviconItem(null)
	}

	const handleRemoveAvatar = () => {
		if (avatarItem?.type === 'file') {
			URL.revokeObjectURL(avatarItem.previewUrl)
		}
		setAvatarItem(null)
	}

	return (
		<div className='grid grid-cols-2 gap-4'>
			<div>
				<label className='mb-2 block text-sm font-medium'>Favicon</label>
				<input ref={faviconInputRef} type='file' accept='image/*' className='hidden' onChange={handleFaviconFileSelect} />
				<div className='group relative h-20 w-20 overflow-hidden rounded-lg border bg-white/60'>
					{faviconItem?.type === 'file' ? (
						<OptimizedImage src={faviconItem.previewUrl} alt='favicon preview' width={80} height={80} className='h-full w-full object-cover' />
					) : (
						<OptimizedImage src='/favicon.png' alt='current favicon' width={80} height={80} className='h-full w-full object-cover' />
					)}
					{/* Public visitors should not see upload/change overlays; existing upload logic stays wired behind the flag. */}
					{SHOW_PUBLIC_ADMIN_ACTIONS && (
						<div className='pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition-opacity group-hover:opacity-100'>
							<span className='text-xs text-white'>{faviconItem ? '更换' : '上传'}</span>
						</div>
					)}
					{SHOW_PUBLIC_ADMIN_ACTIONS && faviconItem && (
						<div className='absolute top-1 right-1 hidden group-hover:block'>
							<motion.button
								whileHover={{ scale: 1.05 }}
								whileTap={{ scale: 0.95 }}
								onClick={e => {
									e.stopPropagation()
									handleRemoveFavicon()
								}}
								className='rounded-md bg-white/90 px-2 py-1 text-xs text-red-500 shadow hover:bg-white'>
								清除
							</motion.button>
						</div>
					)}
					{SHOW_PUBLIC_ADMIN_ACTIONS && <div className='absolute inset-0 cursor-pointer' onClick={() => faviconInputRef.current?.click()} />}
				</div>
			</div>

			<div>
				<label className='mb-2 block text-sm font-medium'>Avatar</label>
				<input ref={avatarInputRef} type='file' accept='image/*' className='hidden' onChange={handleAvatarFileSelect} />
				<div className='group relative h-20 w-20 overflow-hidden rounded-full border bg-white/60'>
					{avatarItem?.type === 'file' ? (
						<OptimizedImage src={avatarItem.previewUrl} alt='avatar preview' width={80} height={80} className='h-full w-full object-cover' />
					) : (
						<OptimizedImage src={getAssetUrl('/images/avatar.png')} alt='current avatar' width={80} height={80} className='h-full w-full object-cover' />
					)}
					{/* Public visitors should not see upload/change overlays; existing upload logic stays wired behind the flag. */}
					{SHOW_PUBLIC_ADMIN_ACTIONS && (
						<div className='pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100'>
							<span className='text-xs text-white'>{avatarItem ? '更换' : '上传'}</span>
						</div>
					)}
					{SHOW_PUBLIC_ADMIN_ACTIONS && avatarItem && (
						<div className='absolute top-1 right-1 hidden group-hover:block'>
							<motion.button
								whileHover={{ scale: 1.05 }}
								whileTap={{ scale: 0.95 }}
								onClick={e => {
									e.stopPropagation()
									handleRemoveAvatar()
								}}
								className='rounded-md bg-white/90 px-2 py-1 text-xs text-red-500 shadow hover:bg-white'>
								清除
							</motion.button>
						</div>
					)}
					{SHOW_PUBLIC_ADMIN_ACTIONS && <div className='absolute inset-0 cursor-pointer' onClick={() => avatarInputRef.current?.click()} />}
				</div>
			</div>
		</div>
	)
}
