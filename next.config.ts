import path from 'node:path'
import { NextConfig } from 'next'

// The default ORT entry emits a 25+ MiB WASM asset; use its external-WASM build instead.
const onnxRuntimeExternalEntry = './node_modules/onnxruntime-web/dist/ort.min.mjs'

const nextConfig: NextConfig = {
	devIndicators: false,
	reactStrictMode: false,
	reactCompiler: true,
	pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
	typescript: {
		ignoreBuildErrors: true
	},
	experimental: {
		scrollRestoration: false
	},
	turbopack: {
		resolveAlias: {
			'onnxruntime-web': onnxRuntimeExternalEntry
		},
		rules: {
			'*.svg': {
				loaders: ['@svgr/webpack'],
				as: '*.js'
			}
		},

		resolveExtensions: ['.mdx', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json', 'css']
	},
	webpack: config => {
		config.resolve.alias = {
			...config.resolve.alias,
			'onnxruntime-web$': path.resolve(onnxRuntimeExternalEntry)
		}

		config.module.rules.push({
			test: /\.svg$/i,
			use: [{ loader: '@svgr/webpack', options: { svgo: false } }]
		})

		return config
	},

	async redirects() {
		return [
			{
				source: '/zh',
				destination: '/',
				permanent: true
			},
			{
				source: '/en',
				destination: '/',
				permanent: true
			}
		]
	}
}

export default nextConfig
