import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { startAnimationLoop } from '@/lib/animation-loop'
import { createAtmosphereMaterial } from '@/lib/orbitalis-atmosphere'
import { orbitalisAssets } from './orbitalis-assets'

export interface OrbitalisInput {
	hovered: boolean
	pointer: { x: number; y: number }
	activation: number
}

export async function mountOrbitalis(
	host: HTMLElement,
	input: OrbitalisInput,
	signal: AbortSignal,
	onReady: () => void,
	onUnavailable: () => void
) {
	signal.throwIfAborted()
	const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.AgXToneMapping
	renderer.toneMappingExposure = 2 ** 0.35
	renderer.setClearColor(0x000000, 0)
	renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'
	renderer.domElement.setAttribute('aria-hidden', 'true')
	host.appendChild(renderer.domElement)

	const scene = new THREE.Scene()
	const camera = new THREE.PerspectiveCamera(31.417275658, 1, 0.1, 50)
	camera.position.set(0, 0, 5.25)
	const root = new THREE.Group()
	root.position.y = 0.18
	scene.add(root)

	const requests = new AbortController()
	const resources = new Set<{ dispose: () => void }>()
	const textures = new Set<THREE.Texture>()
	const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
	let reduceMotion = motionPreference.matches
	let disposed = false
	let highQualityTimer = 0
	let animationLoop: ReturnType<typeof startAnimationLoop> | undefined
	let resizeObserver: ResizeObserver | undefined

	const releaseTexture = (texture: THREE.Texture) => {
		const image = texture.image as ImageBitmap
		texture.dispose()
		image.close()
		textures.delete(texture)
	}
	const dispose = () => {
		if (disposed) return
		disposed = true
		requests.abort()
		window.clearTimeout(highQualityTimer)
		animationLoop?.destroy()
		resizeObserver?.disconnect()
		motionPreference.removeEventListener('change', updateMotionPreference)
		signal.removeEventListener('abort', dispose)
		renderer.domElement.removeEventListener('webglcontextlost', handleContextLost)
		resources.forEach(resource => resource.dispose())
		textures.forEach(releaseTexture)
		renderer.dispose()
		renderer.forceContextLoss()
		renderer.domElement.remove()
	}
	const track = <T extends { dispose: () => void }>(resource: T) => {
		if (disposed) resource.dispose()
		else resources.add(resource)
		return resource
	}
	function updateMotionPreference() {
		reduceMotion = motionPreference.matches
	}
	function handleContextLost(event: Event) {
		event.preventDefault()
		if (disposed) return
		dispose()
		onUnavailable()
	}
	signal.addEventListener('abort', dispose, { once: true })
	motionPreference.addEventListener('change', updateMotionPreference)
	renderer.domElement.addEventListener('webglcontextlost', handleContextLost)

	const read = async (url: string) => {
		const response = await fetch(url, { signal: requests.signal, mode: 'cors', priority: 'low' })
		if (!response.ok) throw new Error(`Orbitalis asset unavailable: ${response.status}`)
		return response
	}
	const loadTexture = async (url: string) => {
		const response = await read(url)
		const image = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
		if (disposed) {
			image.close()
			requests.signal.throwIfAborted()
		}
		const texture = new THREE.Texture(image)
		// The original glTF UVs expect an unflipped image, including both quality tiers.
		texture.flipY = false
		texture.colorSpace = THREE.SRGBColorSpace
		texture.wrapS = THREE.RepeatWrapping
		texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4)
		texture.needsUpdate = true
		textures.add(texture)
		return texture
	}
	const loadModel = async () => {
		const response = await read(orbitalisAssets.model)
		const model = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '')
		model.scene.traverse(object => {
			if (!(object instanceof THREE.Mesh)) return
			track(object.geometry)
			const materials = Array.isArray(object.material) ? object.material : [object.material]
			materials.forEach(track)
		})
		requests.signal.throwIfAborted()
		return model.scene
	}

	try {
		const [model, preview] = await Promise.all([loadModel(), loadTexture(orbitalisAssets.preview)])
		requests.signal.throwIfAborted()
		const planet = model.getObjectByName('Planet_Core') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>
		planet.scale.setScalar(1 / 5.05)
		planet.quaternion.set(0.413011163, 0.581873119, -0.061157357, 0.697929323)
		const spin = new THREE.Group()
		spin.add(planet)
		root.add(spin)

		const material = planet.material
		material.side = THREE.FrontSide
		material.map = preview
		material.emissiveMap = preview
		material.emissive.setRGB(1, 1, 1)
		material.emissiveIntensity = 0.045
		const detailMap = { value: preview }
		const detailMix = { value: 0 }
		material.onBeforeCompile = shader => {
			shader.uniforms.detailMap = detailMap
			shader.uniforms.detailMix = detailMix
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nuniform float detailMix;')
				.replace('#include <map_fragment>', `
					vec4 planetColor = mix(texture2D(map, vMapUv), texture2D(detailMap, vMapUv), detailMix);
					diffuseColor *= planetColor;
				`)
				.replace('#include <emissivemap_fragment>', `
					vec3 planetEmission = mix(texture2D(emissiveMap, vEmissiveMapUv).rgb, texture2D(detailMap, vMapUv).rgb, detailMix);
					totalEmissiveRadiance *= planetEmission;
				`)
		}
		material.customProgramCacheKey = () => 'orbitalis-progressive-v1'
		material.needsUpdate = true

		scene.add(new THREE.AmbientLight(new THREE.Color().setRGB(0.05, 0.065, 0.13), 0.13))
		const lights = [
			{ color: [1, 0.86, 0.74], position: [12, 7, 4], intensity: 3.5 },
			{ color: [0.17, 0.35, 1], position: [-8, 4, 7], intensity: 0.12 },
			{ color: [1, 0.49, 0.3], position: [6, 7, -4], intensity: 0.6 }
		]
		for (const spec of lights) {
			const light = new THREE.DirectionalLight(new THREE.Color().fromArray(spec.color), spec.intensity)
			light.position.fromArray(spec.position).sub(new THREE.Vector3(-0.55000001, 0.34999999, 0)).add(root.position)
			light.target = root
			scene.add(light)
		}

		const atmosphereGeometry = track(new THREE.SphereGeometry(1, 96, 48))
		const layers = [
			{ radius: 5.064 / 5.05, power: 8, opacity: 0.7, colorLinear: [0.16, 0.48, 1], emission: 5 },
			{ radius: 5.102 / 5.05, power: 12, opacity: 0.25, colorLinear: [0.18, 0.22, 1], emission: 0.8 }
		]
		for (const layer of layers) {
			const atmosphere = track(createAtmosphereMaterial(layer, [0.85052991, 0.45067921, 0.27108523], 0.1))
			const shell = new THREE.Mesh(atmosphereGeometry, atmosphere)
			shell.scale.setScalar(layer.radius)
			root.add(shell)
		}

		let renderWidth = 0
		let renderHeight = 0
		const resize = () => {
			const width = Math.max(host.clientWidth, 1)
			const height = Math.max(host.clientHeight, 1)
			const pixelRatio = Math.min(window.devicePixelRatio || 1, width < 640 ? 1 : 1.25)
			if (width === renderWidth && height === renderHeight && pixelRatio === renderer.getPixelRatio()) return
			renderWidth = width
			renderHeight = height
			renderer.setDrawingBufferSize(width, height, pixelRatio)
			camera.aspect = width / height
			camera.updateProjectionMatrix()
			renderer.render(scene, camera)
		}
		resizeObserver = new ResizeObserver(resize)
		resizeObserver.observe(host)
		resize()
		onReady()

		let detail: THREE.Texture | undefined
		let pointerX = 0
		let swayPhase = 0
		let previousActivation = 0
		animationLoop = startAnimationLoop(({ deltaMs }) => {
			const seconds = deltaMs / 1000
			if (!reduceMotion) {
				if (input.activation > previousActivation) swayPhase = 0
				swayPhase += seconds * 18
				const sway = Math.sin(swayPhase) * input.activation
				const ease = 1 - Math.exp(-seconds * 6)
				pointerX += (input.pointer.x * 0.14 - pointerX) * ease
				root.position.x = pointerX + sway * 0.1
				root.position.y += (0.18 + input.pointer.y * 0.06 - root.position.y) * ease
				root.rotation.y = sway * 0.12
				root.rotation.z = sway * 0.055
				const scale = 1 + (input.hovered ? 0.015 : 0) + input.activation * 0.39
				const scaleEase = 1 - Math.exp(-seconds * (scale > root.scale.x ? 24 : 10))
				root.scale.setScalar(THREE.MathUtils.lerp(root.scale.x, scale, scaleEase))
				spin.rotation.y += seconds * (0.035 + input.activation * 0.32)
				input.activation *= Math.exp(-seconds * 3)
				previousActivation = input.activation
			}
			if (detail) {
				detailMix.value = reduceMotion ? 1 : Math.min(1, detailMix.value + deltaMs / 450)
				if (detailMix.value === 1) {
					material.map = material.emissiveMap = detail
					material.needsUpdate = true
					detailMix.value = 0
					releaseTexture(preview)
					detail = undefined
				}
			}
			renderer.render(scene, camera)
		}, { element: host, targetFps: 60 })

		if (renderer.capabilities.maxTextureSize >= 4096) {
			highQualityTimer = window.setTimeout(() => {
				void loadTexture(orbitalisAssets.texture).then(texture => {
					detailMap.value = texture
					detail = texture
				}).catch(() => {
					// The live 1K sphere remains usable if the detail texture cannot decode or download.
				})
			}, 300)
		}
	} catch (error) {
		dispose()
		throw error
	}
}
