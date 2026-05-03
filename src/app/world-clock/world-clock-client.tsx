'use client'

import Link from 'next/link'
import { ChevronLeft, Clock3, LocateFixed, MapPin, RotateCcw, SunMedium } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
	coordinatesToVector,
	formatCoordinate,
	formatSignedMinutes,
	getSubsolarPoint,
	getWorldClockReading,
	vectorToCoordinates,
	type Coordinates
} from '@/lib/world-clock/solar'

const EARTH_RADIUS = 2.2
const INITIAL_VIEW: Coordinates = { lat: 18, lon: 108 }
const INITIAL_SELECTION: Coordinates = { lat: 31.23, lon: 121.47 }
const BASE_MAPS = [
	{ key: 'winter-standard', label: '冬季标清', src: '/world-clock/earth-blue-marble-5400.jpg' },
	{ key: 'winter-high', label: '冬季高清', src: '/world-clock/earth-winter-8192.jpg' },
	{ key: 'summer-high', label: '夏季高清', src: '/world-clock/earth-summer-8192.jpg' }
] as const

function createSolidTexture(color: string) {
	const canvas = document.createElement('canvas')
	canvas.width = 2
	canvas.height = 2
	const context = canvas.getContext('2d')
	if (!context) return new THREE.CanvasTexture(canvas)
	context.fillStyle = color
	context.fillRect(0, 0, canvas.width, canvas.height)
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	return texture
}

function configureTexture(texture: THREE.Texture) {
	texture.colorSpace = THREE.SRGBColorSpace
	texture.anisotropy = 8
	texture.wrapS = THREE.RepeatWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	texture.needsUpdate = true
	return texture
}

function toThreeVector(coordinates: Coordinates, radius = 1) {
	const vector = coordinatesToVector(coordinates, radius)
	return new THREE.Vector3(vector.x, vector.y, vector.z)
}

function createGraticule() {
	const group = new THREE.Group()
	const material = new THREE.LineBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0.18,
		depthWrite: false
	})

	for (let lat = -60; lat <= 60; lat += 30) {
		const points: THREE.Vector3[] = []
		for (let lon = -180; lon <= 180; lon += 4) {
			points.push(toThreeVector({ lat, lon }, EARTH_RADIUS + 0.01))
		}
		group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material))
	}

	for (let lon = -150; lon <= 180; lon += 30) {
		const points: THREE.Vector3[] = []
		for (let lat = -84; lat <= 84; lat += 4) {
			points.push(toThreeVector({ lat, lon }, EARTH_RADIUS + 0.01))
		}
		group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material))
	}

	return group
}

function seededRandom(seed: number) {
	const value = Math.sin(seed * 12.9898) * 43758.5453
	return value - Math.floor(value)
}

function createStarField() {
	const positions: number[] = []
	for (let index = 0; index < 900; index++) {
		const theta = seededRandom(index + 1) * Math.PI * 2
		const phi = Math.acos(seededRandom(index + 2) * 2 - 1)
		const radius = 18 + seededRandom(index + 3) * 10
		positions.push(Math.sin(phi) * Math.cos(theta) * radius, Math.cos(phi) * radius, Math.sin(phi) * Math.sin(theta) * radius)
	}

	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	return new THREE.Points(
		geometry,
		new THREE.PointsMaterial({
			color: 0xffffff,
			size: 0.035,
			transparent: true,
			opacity: 0.55,
			depthWrite: false
		})
	)
}

function placeSurfaceMarker(marker: THREE.Object3D, coordinates: Coordinates, radius = EARTH_RADIUS + 0.055) {
	const normal = toThreeVector(coordinates, 1).normalize()
	marker.position.copy(normal.clone().multiplyScalar(radius))
	marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
}

const vertexShader = `
	varying vec2 vUv;
	varying vec3 vNormal;

	void main() {
		vUv = uv;
		vNormal = normalize(normal);
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`

const fragmentShader = `
	uniform sampler2D dayMap;
	uniform sampler2D nightMap;
	uniform vec3 sunDirection;
	varying vec2 vUv;
	varying vec3 vNormal;

	void main() {
		vec3 dayTexture = texture2D(dayMap, vUv).rgb;
		vec3 nightTexture = texture2D(nightMap, vUv).rgb;
		float light = dot(normalize(vNormal), normalize(sunDirection));
		float daylight = smoothstep(-0.08, 0.14, light);
		float terminator = 1.0 - smoothstep(0.0, 0.10, abs(light));
		float limb = pow(1.0 - max(light, 0.0), 2.0);
		vec3 night = nightTexture * 1.42 + dayTexture * 0.075;
		vec3 day = dayTexture * (1.02 + max(light, 0.0) * 0.62);
		vec3 color = mix(night, day, daylight);
		color += vec3(1.0, 0.68, 0.32) * terminator * 0.18;
		color += vec3(0.36, 0.72, 1.0) * limb * 0.025;
		gl_FragColor = vec4(color, 1.0);
	}
`

export default function WorldClockClient() {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const controlsRef = useRef<OrbitControls | null>(null)
	const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
	const selectedRef = useRef<Coordinates>(INITIAL_SELECTION)
	const [selected, setSelected] = useState<Coordinates>(INITIAL_SELECTION)
	const [now, setNow] = useState(() => new Date())
	const [baseMapKey, setBaseMapKey] = useState<(typeof BASE_MAPS)[number]['key']>('winter-high')
	const currentBaseMap = useMemo(() => BASE_MAPS.find(item => item.key === baseMapKey) || BASE_MAPS[0], [baseMapKey])

	useEffect(() => {
		selectedRef.current = selected
	}, [selected])

	useEffect(() => {
		const timer = window.setInterval(() => {
			setNow(new Date())
		}, 1000)

		return () => window.clearInterval(timer)
	}, [])

	const reading = useMemo(() => getWorldClockReading(now, selected), [now, selected])

	useEffect(() => {
		const container = containerRef.current
		if (!container) return
		let disposed = false

		const scene = new THREE.Scene()
		const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
		camera.position.copy(toThreeVector(INITIAL_VIEW, 6.2))
		camera.lookAt(0, 0, 0)
		cameraRef.current = camera

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
		renderer.outputColorSpace = THREE.SRGBColorSpace
		renderer.domElement.style.display = 'block'
		renderer.domElement.style.height = '100%'
		renderer.domElement.style.width = '100%'
		renderer.domElement.setAttribute('aria-label', '世界时钟三维地球')
		container.appendChild(renderer.domElement)

		const disposableTextures = new Set<THREE.Texture>()
		const textureLoader = new THREE.TextureLoader()
		const dayTexture = createSolidTexture('#174767')
		const nightTexture = createSolidTexture('#020917')
		disposableTextures.add(dayTexture)
		disposableTextures.add(nightTexture)

		const earthMaterial = new THREE.ShaderMaterial({
			uniforms: {
				dayMap: { value: dayTexture },
				nightMap: { value: nightTexture },
				sunDirection: { value: toThreeVector(getSubsolarPoint(new Date()), 1).normalize() }
			},
			vertexShader,
			fragmentShader
		})
		const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 128, 80), earthMaterial)
		scene.add(earth)

		textureLoader.load(currentBaseMap.src, texture => {
			if (disposed) {
				texture.dispose()
				return
			}
			earthMaterial.uniforms.dayMap.value = configureTexture(texture)
			disposableTextures.add(texture)
		})
		textureLoader.load('/world-clock/earth-night-8192.jpg', texture => {
			if (disposed) {
				texture.dispose()
				return
			}
			earthMaterial.uniforms.nightMap.value = configureTexture(texture)
			disposableTextures.add(texture)
		})

		scene.add(createGraticule())
		scene.add(createStarField())

		const atmosphere = new THREE.Mesh(
			new THREE.SphereGeometry(EARTH_RADIUS + 0.09, 128, 80),
			new THREE.MeshBasicMaterial({
				color: 0x8ed7ff,
				transparent: true,
				opacity: 0.16,
				side: THREE.BackSide,
				blending: THREE.AdditiveBlending,
				depthWrite: false
			})
		)
		scene.add(atmosphere)

		const sunMarker = new THREE.Mesh(
			new THREE.SphereGeometry(0.045, 24, 16),
			new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.95 })
		)
		scene.add(sunMarker)

		const selectedMarker = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 12, 36), new THREE.MeshBasicMaterial({ color: 0xff6a95 }))
		scene.add(selectedMarker)

		const controls = new OrbitControls(camera, renderer.domElement)
		controls.enablePan = false
		controls.enableDamping = true
		controls.dampingFactor = 0.08
		controls.minDistance = 3.4
		controls.maxDistance = 8.5
		controls.rotateSpeed = 0.45
		controls.zoomSpeed = 0.65
		controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
		controls.autoRotateSpeed = 0.28
		controlsRef.current = controls

		const resize = () => {
			const width = Math.max(container.clientWidth, 1)
			const height = Math.max(container.clientHeight, 1)
			camera.aspect = width / height
			camera.updateProjectionMatrix()
			renderer.setSize(width, height, false)
		}
		const resizeObserver = new ResizeObserver(resize)
		resizeObserver.observe(container)
		resize()

		const pointerStart = new THREE.Vector2()
		const pointer = new THREE.Vector2()
		const raycaster = new THREE.Raycaster()

		const handlePointerDown = (event: PointerEvent) => {
			pointerStart.set(event.clientX, event.clientY)
		}

		const handlePointerUp = (event: PointerEvent) => {
			if (pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 7) return

			const rect = renderer.domElement.getBoundingClientRect()
			pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
			raycaster.setFromCamera(pointer, camera)
			const [hit] = raycaster.intersectObject(earth)
			if (!hit) return

			const coordinates = vectorToCoordinates(hit.point)
			setSelected(coordinates)
			selectedRef.current = coordinates
		}

		renderer.domElement.addEventListener('pointerdown', handlePointerDown)
		renderer.domElement.addEventListener('pointerup', handlePointerUp)

		let frame = 0
		const animate = () => {
			const subsolar = getSubsolarPoint(new Date())
			const sunDirection = toThreeVector(subsolar, 1).normalize()
			earthMaterial.uniforms.sunDirection.value.copy(sunDirection)
			sunMarker.position.copy(sunDirection.clone().multiplyScalar(EARTH_RADIUS + 0.15))
			placeSurfaceMarker(selectedMarker, selectedRef.current)
			controls.update()
			renderer.render(scene, camera)
			frame = window.requestAnimationFrame(animate)
		}
		animate()

		return () => {
			disposed = true
			window.cancelAnimationFrame(frame)
			resizeObserver.disconnect()
			renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
			renderer.domElement.removeEventListener('pointerup', handlePointerUp)
			controls.dispose()
			controlsRef.current = null
			cameraRef.current = null
			disposableTextures.forEach(texture => texture.dispose())
			scene.traverse(object => {
				if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
					object.geometry.dispose()
					const material = object.material
					if (Array.isArray(material)) material.forEach(item => item.dispose())
					else material.dispose()
				}
			})
			renderer.dispose()
			renderer.domElement.remove()
		}
	}, [currentBaseMap.src])

	const resetView = () => {
		const camera = cameraRef.current
		if (!camera) return
		camera.position.copy(toThreeVector(INITIAL_VIEW, 6.2))
		camera.lookAt(0, 0, 0)
		controlsRef.current?.target.set(0, 0, 0)
		controlsRef.current?.update()
	}

	return (
		<div className='relative h-dvh overflow-hidden bg-[#071623] text-white'>
			<div ref={containerRef} className='absolute inset-0' />
			<div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_48%_50%,transparent_0%,transparent_44%,rgba(6,18,30,0.24)_68%,rgba(4,10,18,0.72)_100%)]' />
			<div className='pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-[#06111e]/75 to-transparent' />

			<div className='absolute top-24 right-6 z-20 flex items-center gap-3 max-sm:top-22 max-sm:right-4'>
				<Link
					href='/'
					title='返回首页'
					aria-label='返回首页'
					className='flex h-11 w-11 items-center justify-center rounded-full border border-white/18 bg-white/12 text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.7)] backdrop-blur-md transition-colors hover:bg-white/20'>
					<ChevronLeft className='h-5 w-5' />
				</Link>
				<button
					type='button'
					title='重置视角'
					aria-label='重置视角'
					onClick={resetView}
					className='flex h-11 w-11 items-center justify-center rounded-full border border-white/18 bg-white/12 text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.7)] backdrop-blur-md transition-colors hover:bg-white/20'>
					<RotateCcw className='h-4.5 w-4.5' />
				</button>
			</div>

			<div className='absolute top-24 left-6 z-20 flex rounded-full border border-white/16 bg-[#071623]/46 p-1 text-xs font-medium text-white/68 shadow-[0_18px_40px_-26px_rgba(0,0,0,0.7)] backdrop-blur-md max-sm:top-22 max-sm:left-4'>
				{BASE_MAPS.map(item => (
					<button
						key={item.key}
						type='button'
						onClick={() => setBaseMapKey(item.key)}
						className={`rounded-full px-3.5 py-2 transition-colors ${baseMapKey === item.key ? 'bg-white/20 text-white' : 'hover:bg-white/10 hover:text-white'}`}>
						{item.label}
					</button>
				))}
			</div>

			<section className='absolute top-24 left-1/2 z-10 w-[min(520px,calc(100%-2rem))] -translate-x-1/2 text-center max-sm:top-22'>
				<h1 className='text-3xl leading-none font-semibold tracking-normal text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.38)] max-sm:text-2xl'>世界时钟</h1>
				<div className='mt-3 text-sm text-white/68'>标准时间 / 太阳时</div>
			</section>

			<aside className='absolute top-1/2 right-6 z-10 w-[360px] -translate-y-1/2 rounded-[32px] border border-white/18 bg-[#071623]/58 p-5 text-white shadow-[0_28px_70px_-34px_rgba(0,0,0,0.85)] backdrop-blur-xl max-lg:top-auto max-lg:right-4 max-lg:bottom-5 max-lg:left-4 max-lg:w-auto max-lg:translate-y-0 max-sm:rounded-[26px] max-sm:p-4'>
				<div className='flex items-start justify-between gap-5'>
					<div>
						<div className='text-xs font-medium text-white/54'>选中位置</div>
						<div className='mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium text-white'>
							<span>{formatCoordinate(reading.coordinates.lat, 'N', 'S')}</span>
							<span>{formatCoordinate(reading.coordinates.lon, 'E', 'W')}</span>
						</div>
					</div>
					<div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10'>
						<MapPin className='h-4.5 w-4.5 text-[#ff87a8]' />
					</div>
				</div>

				<div className='mt-5 space-y-4 border-t border-white/12 pt-5'>
					<div>
						<div className='flex items-center gap-2 text-xs font-medium text-white/56'>
							<Clock3 className='h-4 w-4 text-[#86d7ff]' />
							标准时间
						</div>
						<div className='mt-2 text-4xl leading-none font-semibold tracking-normal tabular-nums max-sm:text-3xl'>{reading.standardTime}</div>
						<div className='mt-2 text-xs leading-relaxed text-white/58'>
							{reading.standardDate} · {reading.utcOffset}
						</div>
					</div>

					<div className='border-t border-white/10 pt-4'>
						<div className='flex items-center gap-2 text-xs font-medium text-white/56'>
							<SunMedium className='h-4 w-4 text-[#ffd36a]' />
							真太阳时
						</div>
						<div className='mt-2 text-4xl leading-none font-semibold tracking-normal text-[#ffd996] tabular-nums max-sm:text-3xl'>{reading.solarTime}</div>
						<div className='mt-2 text-xs leading-relaxed text-white/58'>
							{reading.solarDate} · 均时差 {formatSignedMinutes(reading.equationOfTimeMinutes)}
						</div>
					</div>
				</div>

				<div className='mt-5 grid grid-cols-2 gap-3 border-t border-white/12 pt-5'>
					<div className='rounded-[20px] border border-white/12 bg-white/8 px-3 py-3'>
						<div className='flex items-center gap-2 text-[11px] font-medium text-white/52'>
							<LocateFixed className='h-3.5 w-3.5' />
							日照
						</div>
						<div className='mt-2 text-sm font-medium'>{reading.daylightLabel}</div>
						<div className='mt-1 text-xs text-white/50'>{reading.sunAltitude.toFixed(1)}°</div>
					</div>
					<div className='rounded-[20px] border border-white/12 bg-white/8 px-3 py-3'>
						<div className='text-[11px] font-medium text-white/52'>太阳直射点</div>
						<div className='mt-2 text-xs leading-relaxed text-white/76'>
							{formatCoordinate(reading.subsolar.lat, 'N', 'S')}
							<br />
							{formatCoordinate(reading.subsolar.lon, 'E', 'W')}
						</div>
					</div>
				</div>
			</aside>

			<div className='absolute bottom-4 left-5 z-10 max-w-[420px] rounded-2xl border border-white/12 bg-[#071623]/48 px-4 py-3 text-[11px] leading-relaxed text-white/52 backdrop-blur-md max-lg:hidden'>
				无国界自然影像底图；夜侧使用城市灯光贴图，仅用于昼夜和时间交互展示。
			</div>
		</div>
	)
}
