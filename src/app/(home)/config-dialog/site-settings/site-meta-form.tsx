'use client'

import type { SiteContent } from '../../stores/config-store'

interface SiteMetaFormProps {
	formData: SiteContent
	setFormData: React.Dispatch<React.SetStateAction<SiteContent>>
}

export function SiteMetaForm({ formData, setFormData }: SiteMetaFormProps) {
	return (
		<>
			<div>
				<label className='mb-2 block text-sm font-medium'>站点标题</label>
				<input
					type='text'
					value={formData.meta.title}
					onChange={e => setFormData({ ...formData, meta: { ...formData.meta, title: e.target.value } })}
					className='bg-secondary/10 w-full rounded-lg border px-4 py-2 text-sm'
				/>
			</div>

			<div>
				<label className='mb-2 block text-sm font-medium'>站点描述</label>
				<textarea
					value={formData.meta.description}
					onChange={e => setFormData({ ...formData, meta: { ...formData.meta, description: e.target.value } })}
					rows={3}
					className='bg-secondary/10 w-full rounded-lg border px-4 py-2 text-sm'
				/>
			</div>

			<div>
				<label className='mb-2 block text-sm font-medium'>首页文案前缀</label>
				<input
					type='text'
					value={formData.home?.intro || ''}
					onChange={e => setFormData({ ...formData, home: { ...formData.home, intro: e.target.value, outro: formData.home?.outro || '' } })}
					className='bg-secondary/10 w-full rounded-lg border px-4 py-2 text-sm'
				/>
			</div>

			<div>
				<label className='mb-2 block text-sm font-medium'>首页文案后缀</label>
				<input
					type='text'
					value={formData.home?.outro || ''}
					onChange={e => setFormData({ ...formData, home: { ...formData.home, intro: formData.home?.intro || '', outro: e.target.value } })}
					className='bg-secondary/10 w-full rounded-lg border px-4 py-2 text-sm'
				/>
			</div>
		</>
	)
}
