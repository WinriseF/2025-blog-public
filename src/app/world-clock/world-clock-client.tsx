'use client'

import Link from 'next/link'
import { ChevronLeft, Clock3, LocateFixed, MapPin, Pause, Play, RotateCcw, SunMedium } from 'lucide-react'
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
import { buildSolarTermPoints, formatSolarTermDate, type SolarTermPoint } from '@/lib/world-clock/solar-terms'
import { getAssetUrl } from '@/lib/asset-url'
import { useTimeTheme } from '@/components/time-theme-provider'
import type { TimeThemeName } from '@/lib/time-theme'

const EARTH_RADIUS = 2.2
const SURFACE_MARKER_OFFSET = 0.008
const SUBSOLAR_TRACK_OFFSET = 0.012
const DAY_MS = 86_400_000
const SOLAR_TERM_OFFSET = 0.026
const INITIAL_RENDER_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
const INITIAL_VIEW: Coordinates = { lat: 18, lon: 108 }
const INITIAL_SELECTION: Coordinates = { lat: 31.23, lon: 121.47 }
const TEXTURE_LOAD_DELAY_MS = 400
const BASE_MAPS = [
	{ key: 'winter-standard', label: '冬季标清', src: getAssetUrl('/world-clock/earth-blue-marble-5400.jpg') },
	{ key: 'winter-high', label: '冬季高清', src: getAssetUrl('/world-clock/earth-winter-8192.jpg') },
	{ key: 'summer-high', label: '夏季高清', src: getAssetUrl('/world-clock/earth-summer-8192.jpg') }
] as const
const WORLD_CLOCK_SCENES: Record<
	TimeThemeName,
	{
		root: string
		vignette: string
		topShade: string
		navBackplate: string
	}
> = {
	dawn: {
		root: 'bg-[#dff2f5]',
		vignette:
			'bg-[radial-gradient(circle_at_48%_50%,transparent_0%,transparent_45%,rgba(150,202,213,0.18)_68%,rgba(68,128,150,0.36)_100%),linear-gradient(180deg,rgba(255,246,222,0.36)_0%,rgba(184,225,232,0.18)_44%,rgba(12,35,52,0.38)_100%)]',
		topShade: 'bg-linear-to-b from-[#f8fff8]/82 via-[#dff2f5]/54 to-transparent',
		navBackplate: 'bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.88)_0%,rgba(230,247,246,0.76)_35%,rgba(204,230,235,0.18)_68%,transparent_100%)]'
	},
	noon: {
		root: 'bg-[#d6eef2]',
		vignette:
			'bg-[radial-gradient(circle_at_48%_50%,transparent_0%,transparent_45%,rgba(113,185,204,0.16)_68%,rgba(54,119,145,0.34)_100%),linear-gradient(180deg,rgba(246,255,252,0.42)_0%,rgba(199,235,237,0.2)_45%,rgba(10,38,56,0.38)_100%)]',
		topShade: 'bg-linear-to-b from-[#f6fffb]/88 via-[#d6eef2]/56 to-transparent',
		navBackplate: 'bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.92)_0%,rgba(223,245,244,0.82)_35%,rgba(188,223,230,0.2)_68%,transparent_100%)]'
	},
	sunset: {
		root: 'bg-[#eadfe2]',
		vignette:
			'bg-[radial-gradient(circle_at_48%_50%,transparent_0%,transparent_45%,rgba(212,156,154,0.18)_68%,rgba(91,70,94,0.36)_100%),linear-gradient(180deg,rgba(255,241,224,0.46)_0%,rgba(234,215,226,0.18)_45%,rgba(28,31,54,0.42)_100%)]',
		topShade: 'bg-linear-to-b from-[#fff0e2]/84 via-[#eadfe2]/52 to-transparent',
		navBackplate: 'bg-[radial-gradient(ellipse_at_top_left,rgba(255,250,240,0.9)_0%,rgba(244,226,225,0.76)_35%,rgba(226,196,211,0.2)_68%,transparent_100%)]'
	},
	night: {
		root: 'bg-[#071623]',
		vignette: 'bg-[radial-gradient(circle_at_48%_50%,transparent_0%,transparent_44%,rgba(6,18,30,0.24)_68%,rgba(4,10,18,0.72)_100%)]',
		topShade: 'bg-linear-to-b from-[#06111e]/75 to-transparent',
		navBackplate: 'bg-[radial-gradient(ellipse_at_top_left,rgba(6,17,30,0.18)_0%,rgba(6,17,30,0.08)_42%,transparent_72%)]'
	}
}

function getBaseMapKeyForDate(date: Date) {
	return getSubsolarPoint(date).lat >= 0 ? 'summer-high' : 'winter-high'
}

const visibleSolarTermLabels = new Set(['立春', '春分', '立夏', '夏至', '立秋', '秋分', '立冬', '冬至'])

function getDaysInUtcYear(year: number) {
	return Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS)
}

function getUtcDayIndex(date: Date) {
	return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY_MS)
}

function createAnnualSubsolarTrack(sampleTime: Date) {
	const year = sampleTime.getUTCFullYear()
	const days = getDaysInUtcYear(year)
	const utcHour = sampleTime.getUTCHours()
	const utcMinute = sampleTime.getUTCMinutes()

	return Array.from({ length: days }, (_, dayIndex) => {
		const date = new Date(Date.UTC(year, 0, dayIndex + 1, utcHour, utcMinute, 0))
		return {
			...getSubsolarPoint(date),
			date
		}
	})
}

function formatTrackDate(date: Date) {
	return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}

function getNearestSolarTerm(date: Date | undefined, terms: SolarTermPoint[]) {
	if (!date || terms.length === 0) return null

	let nearest = terms[0]
	let nearestDistance = Math.abs(terms[0].sampleDate.getTime() - date.getTime())
	for (const term of terms.slice(1)) {
		const distance = Math.abs(term.sampleDate.getTime() - date.getTime())
		if (distance < nearestDistance) {
			nearest = term
			nearestDistance = distance
		}
	}

	return nearest
}

function createSolarTermMarker(term: SolarTermPoint) {
	const color = term.kind === 'cardinal' ? 0xfff0a6 : term.kind === 'season-start' ? 0x8ff6d2 : 0xffd36a
	const marker =
		term.kind === 'minor'
			? new THREE.Mesh(new THREE.SphereGeometry(0.019, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }))
			: new THREE.Mesh(new THREE.TorusGeometry(term.kind === 'cardinal' ? 0.052 : 0.041, 0.006, 12, 36), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }))

	placeSurfaceMarker(marker, term, EARTH_RADIUS + SOLAR_TERM_OFFSET)
	return marker
}

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

function placeSurfaceMarker(marker: THREE.Object3D, coordinates: Coordinates, radius = EARTH_RADIUS + SURFACE_MARKER_OFFSET) {
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
		float daylight = smoothstep(-0.04, 0.18, light);
		float terminator = 1.0 - smoothstep(0.0, 0.11, abs(light));
		float limb = pow(1.0 - max(light, 0.0), 2.0);
		vec3 night = nightTexture * 1.28 + dayTexture * 0.038;
		vec3 day = dayTexture * (1.1 + max(light, 0.0) * 0.7);
		vec3 color = mix(night, day, daylight);
		color += vec3(1.0, 0.68, 0.32) * terminator * 0.16;
		color += vec3(0.36, 0.72, 1.0) * limb * 0.025;
		gl_FragColor = vec4(color, 1.0);
	}
`

export default function WorldClockClient() {
	const { theme } = useTimeTheme()
	const containerRef = useRef<HTMLDivElement | null>(null)
	const controlsRef = useRef<OrbitControls | null>(null)
	const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
	const selectedRef = useRef<Coordinates>(INITIAL_SELECTION)
	const trackCursorRef = useRef(getUtcDayIndex(INITIAL_RENDER_DATE))
	const showSubsolarRef = useRef(true)
	const showSolarTermsRef = useRef(true)
	const activeSolarTermRef = useRef<SolarTermPoint | null>(null)
	const baseMapTouchedRef = useRef(false)
	const solarTermLabelRefs = useRef<Record<string, HTMLDivElement | null>>({})
	const [selected, setSelected] = useState<Coordinates>(INITIAL_SELECTION)
	const [now, setNow] = useState(() => INITIAL_RENDER_DATE)
	const [trackSampleTime, setTrackSampleTime] = useState(() => INITIAL_RENDER_DATE)
	const [trackPlaying, setTrackPlaying] = useState(false)
	const [trackCursor, setTrackCursor] = useState(() => getUtcDayIndex(INITIAL_RENDER_DATE))
	const [showSubsolar, setShowSubsolar] = useState(true)
	const [showSolarTerms, setShowSolarTerms] = useState(true)
	const [baseMapKey, setBaseMapKey] = useState<(typeof BASE_MAPS)[number]['key']>(() => getBaseMapKeyForDate(INITIAL_RENDER_DATE))
	const [sceneReady, setSceneReady] = useState(false)
	const currentBaseMap = useMemo(() => BASE_MAPS.find(item => item.key === baseMapKey) || BASE_MAPS[0], [baseMapKey])
	const scenePalette = WORLD_CLOCK_SCENES[theme.name]
	const annualTrack = useMemo(() => createAnnualSubsolarTrack(trackSampleTime), [trackSampleTime])
	const solarTerms = useMemo(() => buildSolarTermPoints(trackSampleTime.getUTCFullYear(), trackSampleTime), [trackSampleTime])
	const activeTrackPoint = annualTrack[Math.min(trackCursor, annualTrack.length - 1)] || annualTrack[0]
	const activeSolarTerm = useMemo(() => getNearestSolarTerm(activeTrackPoint?.date, solarTerms), [activeTrackPoint, solarTerms])

	useEffect(() => {
		selectedRef.current = selected
	}, [selected])

	useEffect(() => {
		trackCursorRef.current = trackCursor
	}, [trackCursor])

	useEffect(() => {
		showSubsolarRef.current = showSubsolar
	}, [showSubsolar])

	useEffect(() => {
		showSolarTermsRef.current = showSolarTerms
	}, [showSolarTerms])

	useEffect(() => {
		activeSolarTermRef.current = activeSolarTerm
	}, [activeSolarTerm])

	useEffect(() => {
		const syncCurrentTime = () => {
			const nextNow = new Date()
			setNow(nextNow)
			setTrackSampleTime(nextNow)
			const nextCursor = getUtcDayIndex(nextNow)
			trackCursorRef.current = nextCursor
			setTrackCursor(nextCursor)
			if (!baseMapTouchedRef.current) setBaseMapKey(getBaseMapKeyForDate(nextNow))
			setSceneReady(true)
		}

		syncCurrentTime()

		const timer = window.setInterval(() => {
			setNow(new Date())
		}, 1000)

		return () => window.clearInterval(timer)
	}, [])

	const reading = useMemo(() => getWorldClockReading(now, selected), [now, selected])

	useEffect(() => {
		if (!trackPlaying) return

		const timer = window.setInterval(() => {
			setTrackCursor(value => {
				const next = (value + 1) % annualTrack.length
				trackCursorRef.current = next
				return next
			})
		}, 70)

		return () => window.clearInterval(timer)
	}, [annualTrack.length, trackPlaying])

	useEffect(() => {
		const container = containerRef.current
		if (!container || !sceneReady) return
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

		const textureLoadTimer = window.setTimeout(() => {
			textureLoader.load(currentBaseMap.src, texture => {
				if (disposed) {
					texture.dispose()
					return
				}
				earthMaterial.uniforms.dayMap.value = configureTexture(texture)
				disposableTextures.add(texture)
			})
			textureLoader.load(getAssetUrl('/world-clock/earth-night-8192.jpg'), texture => {
				if (disposed) {
					texture.dispose()
					return
				}
				earthMaterial.uniforms.nightMap.value = configureTexture(texture)
				disposableTextures.add(texture)
			})
		}, TEXTURE_LOAD_DELAY_MS)

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

		const selectedMarker = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.006, 12, 36), new THREE.MeshBasicMaterial({ color: 0xff6a95 }))
		scene.add(selectedMarker)

		const annualTrackGeometry = new THREE.BufferGeometry().setFromPoints(annualTrack.map(point => toThreeVector(point, EARTH_RADIUS + SUBSOLAR_TRACK_OFFSET)))
		const annualTrackLine = new THREE.Line(
			annualTrackGeometry,
			new THREE.LineBasicMaterial({
				color: 0xffd36a,
				transparent: true,
				opacity: 0.72,
				depthWrite: false
			})
		)
		scene.add(annualTrackLine)

		const annualTrackMarker = new THREE.Mesh(
			new THREE.TorusGeometry(0.036, 0.0055, 12, 36),
			new THREE.MeshBasicMaterial({ color: 0x86d7ff, transparent: true, opacity: 0.95 })
		)
		scene.add(annualTrackMarker)

		const solarTermMarkers = solarTerms.map(term => ({
			term,
			marker: createSolarTermMarker(term)
		}))
		const solarTermGroup = new THREE.Group()
		solarTermMarkers.forEach(({ marker }) => solarTermGroup.add(marker))
		scene.add(solarTermGroup)

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

		const hideSolarTermLabels = () => {
			Object.values(solarTermLabelRefs.current).forEach(label => {
				if (label) label.style.opacity = '0'
			})
		}

		const updateSolarTermLabels = () => {
			if (!showSolarTermsRef.current) {
				hideSolarTermLabels()
				return
			}

			const activeName = activeSolarTermRef.current?.name
			const width = renderer.domElement.clientWidth
			const height = renderer.domElement.clientHeight
			const cameraNormal = camera.position.clone().normalize()

			for (const term of solarTerms) {
				const label = solarTermLabelRefs.current[term.name]
				if (!label) continue

				const surfaceNormal = toThreeVector(term, 1).normalize()
				const visible = surfaceNormal.dot(cameraNormal) > 0.12
				if (!visible) {
					label.style.opacity = '0'
					continue
				}

				const projected = surfaceNormal.clone().multiplyScalar(EARTH_RADIUS + 0.2).project(camera)
				const x = (projected.x * 0.5 + 0.5) * width
				const y = (-projected.y * 0.5 + 0.5) * height
				const isActive = activeName === term.name
				label.style.opacity = isActive ? '1' : '0.78'
				label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${isActive ? 1.04 : 1})`
			}
		}

		let frame = 0
		const animate = () => {
			const showSubsolarLayer = showSubsolarRef.current
			const showSolarTermLayer = showSolarTermsRef.current
			const subsolar = getSubsolarPoint(new Date())
			const sunDirection = toThreeVector(subsolar, 1).normalize()
			earthMaterial.uniforms.sunDirection.value.copy(sunDirection)
			sunMarker.visible = showSubsolarLayer
			annualTrackLine.visible = showSubsolarLayer
			annualTrackMarker.visible = showSubsolarLayer
			solarTermGroup.visible = showSolarTermLayer
			if (showSubsolarLayer) sunMarker.position.copy(sunDirection.clone().multiplyScalar(EARTH_RADIUS + 0.045))
			placeSurfaceMarker(selectedMarker, selectedRef.current)
			const trackPoint = annualTrack[trackCursorRef.current]
			if (showSubsolarLayer && trackPoint) placeSurfaceMarker(annualTrackMarker, trackPoint, EARTH_RADIUS + SUBSOLAR_TRACK_OFFSET)
			const activeTermName = activeSolarTermRef.current?.name
			const pulse = 1 + Math.sin(Date.now() / 160) * 0.08
			for (const { term, marker } of solarTermMarkers) {
				marker.scale.setScalar(activeTermName === term.name ? 1.32 * pulse : 1)
			}
			controls.update()
			updateSolarTermLabels()
			renderer.render(scene, camera)
			frame = window.requestAnimationFrame(animate)
		}
		animate()

		return () => {
			disposed = true
			window.clearTimeout(textureLoadTimer)
			window.cancelAnimationFrame(frame)
			resizeObserver.disconnect()
			hideSolarTermLabels()
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
	}, [annualTrack, currentBaseMap.src, sceneReady, solarTerms])

	const resetView = () => {
		const camera = cameraRef.current
		if (!camera) return
		camera.position.copy(toThreeVector(INITIAL_VIEW, 6.2))
		camera.lookAt(0, 0, 0)
		controlsRef.current?.target.set(0, 0, 0)
		controlsRef.current?.update()
	}

	const handleTrackCursorChange = (value: number) => {
		setTrackPlaying(false)
		trackCursorRef.current = value
		setTrackCursor(value)
	}

	return (
		<div className={`relative h-dvh overflow-hidden text-white ${scenePalette.root}`}>
			<div ref={containerRef} className='absolute inset-0' />
			<div className={`pointer-events-none absolute inset-0 ${scenePalette.vignette}`} />
			<div className={`pointer-events-none absolute inset-x-0 top-0 h-32 ${scenePalette.topShade}`} />
			<div className={`pointer-events-none absolute top-0 left-0 h-36 w-[580px] max-w-full ${scenePalette.navBackplate}`} />
			<div className='pointer-events-none absolute inset-0 z-10'>
				{solarTerms
					.filter(term => visibleSolarTermLabels.has(term.name))
					.map(term => (
						<div
							key={term.name}
							ref={node => {
								solarTermLabelRefs.current[term.name] = node
							}}
							className={`absolute top-0 left-0 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shadow-[0_10px_24px_-18px_rgba(0,0,0,0.8)] backdrop-blur-md transition-[opacity,background-color,border-color,color] ${
								activeSolarTerm?.name === term.name
									? 'border-[#ffd36a]/60 bg-[#ffd36a]/22 text-white'
									: term.kind === 'season-start'
										? 'border-[#8ff6d2]/32 bg-[#071623]/48 text-[#bffbe9]'
										: 'border-[#ffd36a]/32 bg-[#071623]/48 text-[#ffe2a3]'
							}`}
							style={{ opacity: 0 }}>
							{term.name}
						</div>
					))}
			</div>

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
						onClick={() => {
							baseMapTouchedRef.current = true
							setBaseMapKey(item.key)
						}}
						className={`rounded-full px-3.5 py-2 transition-colors ${baseMapKey === item.key ? 'bg-white/20 text-white' : 'hover:bg-white/10 hover:text-white'}`}>
						{item.label}
					</button>
				))}
			</div>

			<section className='absolute top-24 left-1/2 z-10 w-[min(520px,calc(100%-2rem))] -translate-x-1/2 text-center max-sm:top-22'>
				<h1 className='text-3xl leading-none font-semibold tracking-normal text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.38)] max-sm:text-2xl'>世界时钟</h1>
				<div className='mt-3 text-sm text-white/68'>标准时间 / 太阳时</div>
			</section>

			<div className='absolute bottom-4 left-5 z-20 w-[min(320px,calc(100%-2rem))] rounded-xl border border-white/12 bg-[#071623]/52 px-3 py-2.5 text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.7)] backdrop-blur-md max-lg:bottom-[220px] max-sm:bottom-[210px] max-sm:left-4 max-sm:w-[min(300px,calc(100%-2rem))]'>
				<div className='flex items-center justify-between gap-3'>
					<div>
						<div className='text-xs font-medium text-white/58'>地表太阳标注</div>
						<div className='mt-1 text-[10px] leading-relaxed text-white/46'>
							<span className='text-[#ffd36a]'>黄线/蓝圈</span> 为直射轨迹，
							<span className='text-[#8ff6d2]'>节气点</span> 标在地表
						</div>
					</div>
					<button
						type='button'
						title={trackPlaying ? '暂停' : '播放'}
						aria-label={trackPlaying ? '暂停太阳直射点年度动画' : '播放太阳直射点年度动画'}
						onClick={() => setTrackPlaying(value => !value)}
						className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 transition-colors hover:bg-white/18'>
						{trackPlaying ? <Pause className='h-4 w-4 text-[#ffd36a]' /> : <Play className='h-4 w-4 text-[#ffd36a]' />}
					</button>
				</div>
				<div className='mt-2.5 flex gap-1.5 text-[11px] font-medium'>
					<button
						type='button'
						onClick={() => setShowSubsolar(value => !value)}
						className={`rounded-full border px-2.5 py-1 transition-colors ${
							showSubsolar ? 'border-[#ffd36a]/40 bg-[#ffd36a]/16 text-[#ffe2a3]' : 'border-white/12 bg-white/6 text-white/42 hover:bg-white/10 hover:text-white/68'
						}`}>
						直射点
					</button>
					<button
						type='button'
						onClick={() => setShowSolarTerms(value => !value)}
						className={`rounded-full border px-2.5 py-1 transition-colors ${
							showSolarTerms ? 'border-[#8ff6d2]/36 bg-[#8ff6d2]/14 text-[#bffbe9]' : 'border-white/12 bg-white/6 text-white/42 hover:bg-white/10 hover:text-white/68'
						}`}>
						节气
					</button>
				</div>
				<div className='mt-2.5 flex items-center gap-2'>
					<div className='w-13 shrink-0 text-[11px] font-medium text-white/70'>{activeTrackPoint ? formatTrackDate(activeTrackPoint.date) : ''}</div>
					<input
						type='range'
						min={0}
						max={Math.max(annualTrack.length - 1, 0)}
						value={trackCursor}
						aria-label='选择太阳直射点年度轨迹日期'
						onChange={event => handleTrackCursorChange(Number(event.currentTarget.value))}
						className='range-track min-w-0 flex-1'
						style={{ '--range-progress': `${annualTrack.length > 1 ? (trackCursor / (annualTrack.length - 1)) * 100 : 0}%` } as React.CSSProperties}
					/>
				</div>
				{activeTrackPoint && (
					<div className='mt-1.5 text-[10px] leading-relaxed text-white/46'>
						直射动画点 {formatCoordinate(activeTrackPoint.lat, 'N', 'S')} · {formatCoordinate(activeTrackPoint.lon, 'E', 'W')}
						{activeSolarTerm && (
							<>
								<br />
								最近节气 <span className='text-[#ffd36a]'>{activeSolarTerm.name}</span> · {formatSolarTermDate(activeSolarTerm.date)}
							</>
						)}
					</div>
				)}
			</div>

			<aside className='scrollbar-none absolute top-1/2 right-5 z-10 max-h-[calc(100dvh-8rem)] w-[220px] -translate-y-1/2 overflow-y-auto rounded-[20px] border border-white/18 bg-[#071623]/58 p-3 text-white shadow-[0_24px_60px_-34px_rgba(0,0,0,0.85)] backdrop-blur-xl max-lg:top-auto max-lg:right-4 max-lg:bottom-4 max-lg:max-h-[calc(100dvh-9rem)] max-lg:w-[min(260px,calc(100%-2rem))] max-lg:translate-y-0'>
				<div className='flex items-start justify-between gap-3'>
					<div>
						<div className='text-xs font-medium text-white/54'>选中位置</div>
						<div className='mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1 text-sm font-medium text-white'>
							<span>{formatCoordinate(reading.coordinates.lat, 'N', 'S')}</span>
							<span>{formatCoordinate(reading.coordinates.lon, 'E', 'W')}</span>
						</div>
					</div>
					<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10'>
						<MapPin className='h-3.5 w-3.5 text-[#ff87a8]' />
					</div>
				</div>

				<div className='mt-3.5 space-y-3 border-t border-white/12 pt-3.5'>
					<div>
						<div className='flex items-center gap-2 text-xs font-medium text-white/56'>
							<Clock3 className='h-4 w-4 text-[#86d7ff]' />
							标准时间
						</div>
						<div className='mt-1.5 text-2xl leading-none font-semibold tracking-normal tabular-nums'>{reading.standardTime}</div>
						<div className='mt-1.5 text-xs leading-relaxed text-white/58'>
							{reading.standardDate} · {reading.utcOffset}
						</div>
					</div>

					<div className='border-t border-white/10 pt-3'>
						<div className='flex items-center gap-2 text-xs font-medium text-white/56'>
							<SunMedium className='h-4 w-4 text-[#ffd36a]' />
							真太阳时
						</div>
						<div className='mt-1.5 text-2xl leading-none font-semibold tracking-normal text-[#ffd996] tabular-nums'>{reading.solarTime}</div>
						<div className='mt-1.5 text-xs leading-relaxed text-white/58'>
							{reading.solarDate} · 均时差 {formatSignedMinutes(reading.equationOfTimeMinutes)}
						</div>
					</div>
				</div>

				<div className='mt-3.5 grid gap-2 border-t border-white/12 pt-3.5'>
					<div className='rounded-xl border border-white/12 bg-white/8 px-2.5 py-2.5'>
						<div className='flex items-center gap-2 text-[11px] font-medium text-white/52'>
							<LocateFixed className='h-3.5 w-3.5' />
							日照
						</div>
						<div className='mt-1.5 text-sm font-medium'>{reading.daylightLabel}</div>
						<div className='mt-1 text-xs text-white/50'>{reading.sunAltitude.toFixed(1)}°</div>
					</div>
					<div className='rounded-xl border border-white/12 bg-white/8 px-2.5 py-2.5'>
						<div className='text-[11px] font-medium text-white/52'>太阳直射点</div>
						<div className='mt-1.5 text-xs leading-relaxed text-white/76'>
							{formatCoordinate(reading.subsolar.lat, 'N', 'S')}
							<br />
							{formatCoordinate(reading.subsolar.lon, 'E', 'W')}
						</div>
					</div>
				</div>
			</aside>

			<div className='absolute right-5 bottom-4 z-10 max-w-[420px] rounded-2xl border border-white/12 bg-[#071623]/48 px-4 py-3 text-[11px] leading-relaxed text-white/52 backdrop-blur-md max-lg:hidden'>
				无国界自然影像底图；夜侧使用城市灯光贴图，仅用于昼夜和时间交互展示。
			</div>
		</div>
	)
}
