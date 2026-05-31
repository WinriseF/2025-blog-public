import type { CSSProperties, ImgHTMLAttributes } from 'react'

type OptimizedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
	src: string
	alt: string
	fill?: boolean
}

export function OptimizedImage({ src, alt, fill = false, style, loading = 'lazy', decoding = 'async', ...props }: OptimizedImageProps) {
	const imageStyle: CSSProperties | undefined = fill
		? {
				position: 'absolute',
				inset: 0,
				width: '100%',
				height: '100%',
				...style
			}
		: style

	return <img src={src} alt={alt} loading={loading} decoding={decoding} {...props} style={imageStyle} />
}
