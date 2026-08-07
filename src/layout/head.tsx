import { ASSET_ORIGIN } from '@/lib/asset-url'

export default function Head() {
	return (
		<head>
			<meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no' />
			<link rel='manifest' href='/manifest.json' />

			<link rel='icon' href='/images/toolbox/winrisef-toolbox-agent-favicon.png' />

			<link rel='preconnect' href={ASSET_ORIGIN} crossOrigin='anonymous' />
			<link rel='dns-prefetch' href={ASSET_ORIGIN} />

			<link rel='preconnect' href='https://fonts.googleapis.com' />
			<link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='anonymous' />

			<link href='https://fonts.googleapis.com/css2?family=Averia+Gruesa+Libre&display=swap' rel='stylesheet' />
		</head>
	)
}
