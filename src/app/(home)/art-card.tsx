import Card from '@/components/card'
import { useCenterStore } from '@/hooks/use-center'
import { useConfigStore } from './stores/config-store'
import { CARD_SPACING } from '@/consts'
import { useRouter } from 'next/navigation'
import { HomeDraggableLayer } from './home-draggable-layer'
import { getAssetUrl } from '@/lib/asset-url'
import { OptimizedImage } from '@/components/optimized-image'

export default function ArtCard() {
	const center = useCenterStore()
	const { cardStyles, siteContent } = useConfigStore()
	const router = useRouter()
	const styles = cardStyles.artCard
	const hiCardStyles = cardStyles.hiCard

	const x = styles.offsetX !== null ? center.x + styles.offsetX : center.x - styles.width / 2
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y - hiCardStyles.height / 2 - styles.height - CARD_SPACING

	const artImages = siteContent.artImages ?? []
	const currentId = siteContent.currentArtImageId
	const currentArt = (currentId ? artImages.find(item => item.id === currentId) : undefined) ?? artImages[0]
	const artUrl = getAssetUrl(currentArt?.url || '/images/art/74c41a55ffa3f0d4.webp')

	return (
		<HomeDraggableLayer cardKey='artCard' x={x} y={y} width={styles.width} height={styles.height}>
			<Card className='p-2 max-sm:static max-sm:translate-0' order={styles.order} width={styles.width} height={styles.height} x={x} y={y}>
				<div className='relative h-full w-full'>
					<OptimizedImage
						onClick={() => router.push('/pictures')}
						src={artUrl}
						alt='wall art'
						fill
						className='rounded-[32px] object-cover'
					/>
				</div>
			</Card>
		</HomeDraggableLayer>
	)
}
