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
import { startAnimationLoop } from '@/lib/animation-loop'
import { useTimeTheme } from '@/components/time-theme-provider'
import type { TimeThemeName } from '@/lib/time-theme'
import styles from './world-clock.module.css'

const EARTH_RADIUS = 2.2
const CAMERA_DISTANCE = 7.4
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
const markerForward = new THREE.Vector3(0, 0, 1)

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
	return setThreeVector(new THREE.Vector3(), coordinates, radius)
}

function setThreeVector(target: THREE.Vector3, coordinates: Coordinates, radius = 1) {
	const vector = coordinatesToVector(coordinates, radius)
	return target.set(vector.x, vector.y, vector.z)
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

function placeSurfaceMarker(marker: THREE.Object3D, coordinates: Coordinates, radius = EARTH_RADIUS + SURFACE_MARKER_OFFSET, normal = new THREE.Vector3()) {
	setThreeVector(normal, coordinates).normalize()
	marker.position.copy(normal).multiplyScalar(radius)
	marker.quaternion.setFromUnitVectors(markerForward, normal)
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
		let timer: number | null = null
		const syncClockTimer = () => {
			if (timer !== null) window.clearInterval(timer)
			timer = null
			if (document.hidden) return
			setNow(new Date())
			timer = window.setInterval(() => setNow(new Date()), 1000)
		}
		syncClockTimer()
		document.addEventListener('visibilitychange', syncClockTimer)

		return () => {
			if (timer !== null) window.clearInterval(timer)
			document.removeEventListener('visibilitychange', syncClockTimer)
		}
	}, [])

	const reading = useMemo(() => getWorldClockReading(now, selected), [now, selected])

	useEffect(() => {
		if (!trackPlaying) return

		let timer: number | null = null
		const advanceTrack = () => {
			setTrackCursor(value => {
				const next = (value + 1) % annualTrack.length
				trackCursorRef.current = next
				return next
			})
		}
		const syncTrackTimer = () => {
			if (timer !== null) window.clearInterval(timer)
			timer = document.hidden ? null : window.setInterval(advanceTrack, 70)
		}
		syncTrackTimer()
		document.addEventListener('visibilitychange', syncTrackTimer)

		return () => {
			if (timer !== null) window.clearInterval(timer)
			document.removeEventListener('visibilitychange', syncTrackTimer)
		}
	}, [annualTrack.length, trackPlaying])

	useEffect(() => {
		const container = containerRef.current
		if (!container || !sceneReady) return
		let disposed = false

		const scene = new THREE.Scene()
		const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
		camera.position.copy(toThreeVector(INITIAL_VIEW, CAMERA_DISTANCE))
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
			new THREE.SphereGeometry(EARTH_RADIUS + 0.035, 128, 80),
			new THREE.MeshBasicMaterial({
				color: 0x8ed7ff,
				transparent: true,
				opacity: 0.1,
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
		const solarTermLabelPoints = solarTerms
			.filter(term => visibleSolarTermLabels.has(term.name))
			.map(term => ({ term, normal: toThreeVector(term), projected: new THREE.Vector3(), opacity: '', transform: '' }))
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

		let renderWidth = 0
		let renderHeight = 0
		const resize = () => {
			const nextWidth = Math.max(container.clientWidth, 1)
			const nextHeight = Math.max(container.clientHeight, 1)
			if (nextWidth === renderWidth && nextHeight === renderHeight) return
			renderWidth = nextWidth
			renderHeight = nextHeight
			camera.aspect = renderWidth / renderHeight
			// Preserve the globe's framing when the stage becomes taller than it is wide.
			camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) / Math.min(camera.aspect, 1)))
			// Leave room for the reading panel without clipping the scene to a smaller canvas.
			if (window.innerWidth > 960) camera.setViewOffset(renderWidth, renderHeight, Math.min(120, renderWidth * 0.09), 0, renderWidth, renderHeight)
			else camera.clearViewOffset()
			camera.updateProjectionMatrix()
			renderer.setSize(renderWidth, renderHeight, false)
		}
		const resizeObserver = new ResizeObserver(resize)
		resizeObserver.observe(container)
		resize()

		const pointerStart = new THREE.Vector2()
		const pointerEnd = new THREE.Vector2()
		const pointer = new THREE.Vector2()
		const raycaster = new THREE.Raycaster()

		const handlePointerDown = (event: PointerEvent) => {
			pointerStart.set(event.clientX, event.clientY)
		}

		const handlePointerUp = (event: PointerEvent) => {
			pointerEnd.set(event.clientX, event.clientY)
			if (pointerStart.distanceTo(pointerEnd) > 7) return

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

		let labelsHidden = false
		const hideSolarTermLabels = () => {
			if (labelsHidden) return
			for (const point of solarTermLabelPoints) {
				const label = solarTermLabelRefs.current[point.term.name]
				if (label && point.opacity !== '0') label.style.opacity = '0'
				point.opacity = '0'
			}
			labelsHidden = true
		}

		const updateSolarTermLabels = () => {
			if (!showSolarTermsRef.current) {
				hideSolarTermLabels()
				return
			}

			labelsHidden = false
			const activeName = activeSolarTermRef.current?.name
			cameraNormal.copy(camera.position).normalize()

			for (const point of solarTermLabelPoints) {
				const { term, normal, projected } = point
				const label = solarTermLabelRefs.current[term.name]
				if (!label) continue

				const visible = normal.dot(cameraNormal) > 0.12
				if (!visible) {
					if (point.opacity !== '0') label.style.opacity = '0'
					point.opacity = '0'
					continue
				}

				projected.copy(normal).multiplyScalar(EARTH_RADIUS + 0.2).project(camera)
				const x = (projected.x * 0.5 + 0.5) * renderWidth
				const y = (-projected.y * 0.5 + 0.5) * renderHeight
				const isActive = activeName === term.name
				const opacity = isActive ? '1' : '0.78'
				const transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${isActive ? 1.04 : 1})`
				if (point.opacity !== opacity) label.style.opacity = opacity
				if (point.transform !== transform) label.style.transform = transform
				point.opacity = opacity
				point.transform = transform
			}
		}

		const cameraNormal = new THREE.Vector3()
		const markerNormal = new THREE.Vector3()
		const sunDirection = new THREE.Vector3()
		const markerByTerm = new Map(solarTermMarkers.map(item => [item.term.name, item.marker]))
		let lastActiveTermName: string | undefined
		let lastSelected = selectedRef.current
		let lastTrackCursor = trackCursorRef.current
		let lastShowSubsolar: boolean | undefined
		let lastShowSolarTerms: boolean | undefined
		let nextSolarUpdate = 0
		placeSurfaceMarker(selectedMarker, lastSelected, undefined, markerNormal)
		const initialTrackPoint = annualTrack[lastTrackCursor]
		if (initialTrackPoint) placeSurfaceMarker(annualTrackMarker, initialTrackPoint, EARTH_RADIUS + SUBSOLAR_TRACK_OFFSET, markerNormal)

		const animate = (timestamp: number) => {
			const showSubsolarLayer = showSubsolarRef.current
			const showSolarTermLayer = showSolarTermsRef.current

			if (timestamp >= nextSolarUpdate) {
				setThreeVector(sunDirection, getSubsolarPoint(new Date())).normalize()
				earthMaterial.uniforms.sunDirection.value.copy(sunDirection)
				sunMarker.position.copy(sunDirection).multiplyScalar(EARTH_RADIUS + 0.045)
				nextSolarUpdate = timestamp + 1000
			}

			if (showSubsolarLayer !== lastShowSubsolar) {
				sunMarker.visible = showSubsolarLayer
				annualTrackLine.visible = showSubsolarLayer
				annualTrackMarker.visible = showSubsolarLayer
				lastShowSubsolar = showSubsolarLayer
			}
			if (showSolarTermLayer !== lastShowSolarTerms) {
				solarTermGroup.visible = showSolarTermLayer
				lastShowSolarTerms = showSolarTermLayer
			}

			if (selectedRef.current !== lastSelected) {
				lastSelected = selectedRef.current
				placeSurfaceMarker(selectedMarker, lastSelected, undefined, markerNormal)
			}
			if (trackCursorRef.current !== lastTrackCursor) {
				lastTrackCursor = trackCursorRef.current
				const trackPoint = annualTrack[lastTrackCursor]
				if (trackPoint) placeSurfaceMarker(annualTrackMarker, trackPoint, EARTH_RADIUS + SUBSOLAR_TRACK_OFFSET, markerNormal)
			}

			const activeTermName = activeSolarTermRef.current?.name
			if (activeTermName !== lastActiveTermName) {
				if (lastActiveTermName) markerByTerm.get(lastActiveTermName)?.scale.setScalar(1)
				lastActiveTermName = activeTermName
			}
			if (activeTermName) markerByTerm.get(activeTermName)?.scale.setScalar(1.32 * (1 + Math.sin(Date.now() / 160) * 0.08))
			controls.update()
			updateSolarTermLabels()
			renderer.render(scene, camera)
		}
		animate(performance.now())
		const animationLoop = startAnimationLoop(({ timestamp }) => animate(timestamp), { element: container })

		return () => {
			disposed = true
			window.clearTimeout(textureLoadTimer)
			animationLoop.destroy()
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
			renderer.forceContextLoss()
			renderer.domElement.remove()
		}
	}, [annualTrack, currentBaseMap.src, sceneReady, solarTerms])

	const resetView = () => {
		const camera = cameraRef.current
		if (!camera) return
		camera.position.copy(toThreeVector(INITIAL_VIEW, CAMERA_DISTANCE))
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
		<div className={`${styles.page} ${scenePalette.root}`} data-theme={theme.name}>
			<div className={`pointer-events-none absolute inset-0 -z-10 ${scenePalette.vignette}`} />
			<div className={`pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 ${scenePalette.topShade}`} />
			<div className={`pointer-events-none absolute top-0 left-0 -z-10 h-36 w-[580px] max-w-full ${scenePalette.navBackplate}`} />

			<header className={styles.header}>
				<div>
					<div className={styles.titleRow}>
						<h1>世界时钟</h1>
						<p className={styles.subtitle}>标准时间 / 真太阳时</p>
					</div>
				</div>
				<div className={styles.actions}>
					<Link href='/' title='返回首页' aria-label='返回首页' className={styles.iconButton}>
						<ChevronLeft className='h-4 w-4' />
					</Link>
					<button type='button' title='重置视角' aria-label='重置视角' onClick={resetView} className={styles.iconButton}>
						<RotateCcw className='h-4 w-4' />
					</button>
				</div>
			</header>

			<div className={styles.workspace}>
				<section className={styles.stage} aria-label='交互式地球'>
					<div className={styles.mapPicker} role='group' aria-label='地球底图'>
						{BASE_MAPS.map(item => (
							<button
								key={item.key}
								type='button'
								aria-pressed={baseMapKey === item.key}
								onClick={() => {
									baseMapTouchedRef.current = true
									setBaseMapKey(item.key)
								}}>
								{item.label}
							</button>
						))}
					</div>
					<div className={styles.globe}>
						<div ref={containerRef} className={styles.canvas} />
						<div className={styles.labels}>
							{solarTerms.filter(term => visibleSolarTermLabels.has(term.name)).map(term => (
								<div
									key={term.name}
									ref={node => {
										solarTermLabelRefs.current[term.name] = node
									}}
									className={`absolute top-0 left-0 rounded-md border px-2 py-1 text-[10px] font-medium whitespace-nowrap backdrop-blur-md ${
										activeSolarTerm?.name === term.name
											? 'border-[#ffd36a]/50 bg-[#25303a]/90 text-[#ffe2a3]'
											: term.kind === 'season-start'
												? 'border-[#8ff6d2]/24 bg-[#071623]/75 text-[#bffbe9]'
												: 'border-[#ffd36a]/24 bg-[#071623]/75 text-[#ffe2a3]'
									}`}
									style={{ opacity: 0 }}>
									{term.name}
								</div>
							))}
						</div>
					</div>
					<p className={styles.hint}>拖动旋转 · 滚轮或双指缩放 · 点击地表查看时间</p>
				</section>

				<aside className={`${styles.panel} ${styles.reading}`} aria-label='选中位置的时间'>
					<div className={styles.panelHeading}>
						<h2 className={styles.label}><MapPin className='h-3.5 w-3.5 text-[#ff87a8]' />选中位置</h2>
						{sceneReady && <span className={styles.live}>实时</span>}
					</div>
					<div className={styles.coordinate}>
						<span>{formatCoordinate(reading.coordinates.lat, 'N', 'S')}</span>
						<span>{formatCoordinate(reading.coordinates.lon, 'E', 'W')}</span>
					</div>
					<p className={styles.zone}>{reading.timeZone} · {reading.utcOffset}</p>

					<div className={styles.clocks}>
						<div className={styles.clock}>
							<h3 className={styles.label}><Clock3 className='h-3.5 w-3.5 text-[#86d7ff]' />标准时间</h3>
							<time className={styles.time}>{reading.standardTime}</time>
							<p className={styles.date}>{reading.standardDate}</p>
						</div>
						<div className={styles.clock}>
							<h3 className={styles.label}><SunMedium className='h-3.5 w-3.5 text-[#f3cf91]' />真太阳时</h3>
							<time className={`${styles.time} ${styles.solar}`}>{reading.solarTime}</time>
							<p className={styles.date}>{reading.solarDate}<br />均时差 {formatSignedMinutes(reading.equationOfTimeMinutes)}</p>
						</div>
					</div>

					<dl className={styles.facts}>
						<div className={styles.fact}>
							<dt><span className={styles.label}><LocateFixed className='h-3.5 w-3.5' />日照状态</span></dt>
							<dd>{reading.daylightLabel}<br /><small>太阳高度 {reading.sunAltitude.toFixed(1)}°</small></dd>
						</div>
						<div className={styles.fact}>
							<dt>当前太阳直射点</dt>
							<dd>{formatCoordinate(reading.subsolar.lat, 'N', 'S')}<br />{formatCoordinate(reading.subsolar.lon, 'E', 'W')}</dd>
						</div>
					</dl>
					<p className={styles.note}>无国界自然影像 · 夜侧城市灯光</p>
				</aside>

				<section className={`${styles.panel} ${styles.track}`} aria-labelledby='solar-track-title'>
					<div className={styles.panelHeading}>
						<h2 id='solar-track-title' className={styles.trackTitle}>太阳直射 · 年度轨迹</h2>
						<div className={styles.legend} role='group' aria-label='地表标注图层'>
							<button type='button' aria-pressed={showSubsolar} onClick={() => setShowSubsolar(value => !value)} className={styles.toggle}>
								<span className={styles.swatch} />直射轨迹
							</button>
							<button type='button' aria-pressed={showSolarTerms} onClick={() => setShowSolarTerms(value => !value)} className={styles.toggle}>
								<span className={`${styles.swatch} ${styles.seasonSwatch}`} />节气
							</button>
						</div>
					</div>
					<div className={styles.trackControls}>
						<button
							type='button'
							title={trackPlaying ? '暂停' : '播放'}
							aria-label={trackPlaying ? '暂停太阳直射点年度动画' : '播放太阳直射点年度动画'}
							aria-pressed={trackPlaying}
							onClick={() => setTrackPlaying(value => !value)}
							className={`${styles.iconButton} ${styles.solar}`}>
							{trackPlaying ? <Pause className='h-3.5 w-3.5' /> : <Play className='h-3.5 w-3.5' />}
						</button>
						<span className={styles.trackDate}>{activeTrackPoint ? formatTrackDate(activeTrackPoint.date) : ''}</span>
						<input
							type='range'
							min={0}
							max={Math.max(annualTrack.length - 1, 0)}
							value={trackCursor}
							aria-label='选择太阳直射点年度轨迹日期'
							aria-valuetext={activeTrackPoint ? formatTrackDate(activeTrackPoint.date) : undefined}
							onChange={event => handleTrackCursorChange(Number(event.currentTarget.value))}
							className={styles.slider}
						/>
					</div>
					{activeTrackPoint && (
						<div className={styles.trackMeta}>
							<span>轨迹点 <span className='text-[#86d7ff]'>○</span> {formatCoordinate(activeTrackPoint.lat, 'N', 'S')} · {formatCoordinate(activeTrackPoint.lon, 'E', 'W')}</span>
							{activeSolarTerm && <span>最近节气 <strong>{activeSolarTerm.name}</strong> · {formatSolarTermDate(activeSolarTerm.date)}</span>}
						</div>
					)}
				</section>
			</div>
		</div>
	)
}
