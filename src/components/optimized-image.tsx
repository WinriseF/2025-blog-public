import Image, { type ImageProps } from 'next/image'
import { type ImgHTMLAttributes } from 'react'
import { ASSET_ORIGIN } from '@/lib/asset-url'

type OptimizedImageProps = Omit<ImageProps, 'src'> & {
	src: string
}

const ASSET_HOSTNAME = new URL(ASSET_ORIGIN).hostname

function canUseNextImage(src: string) {
	if (!src) return false
	if (src.startsWith('/')) return true
	if (/^(data:|blob:|local-image:)/.test(src)) return false
	if (/\.svg(?:[?#].*)?$/i.test(src)) return false

	try {
		const url = new URL(src)
		return url.protocol === 'https:' && url.hostname === ASSET_HOSTNAME
	} catch {
		return false
	}
}

export function OptimizedImage({ src, alt, fill, priority, quality, placeholder, blurDataURL, sizes, loader, unoptimized, ...props }: OptimizedImageProps) {
	if (canUseNextImage(src)) {
		return (
			<Image
				src={src}
				alt={alt}
				fill={fill}
				priority={priority}
				quality={quality}
				placeholder={placeholder}
				blurDataURL={blurDataURL}
				sizes={sizes}
				loader={loader}
				unoptimized={unoptimized}
				{...props}
			/>
		)
	}

	const imgProps = props as ImgHTMLAttributes<HTMLImageElement>
	const fillStyle: ImgHTMLAttributes<HTMLImageElement>['style'] = fill
		? {
				position: 'absolute',
				inset: 0,
				width: '100%',
				height: '100%',
				...imgProps.style
			}
		: imgProps.style

	return <img src={src} alt={alt} {...imgProps} style={fillStyle} />
}
