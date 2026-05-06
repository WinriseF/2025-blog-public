'use client'

import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface AnimatedCoreProps {
	className?: string
}

export default function AnimatedCore({ className }: AnimatedCoreProps) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const hoverRef = useRef(false)
	const pointerRef = useRef({ x: 0, y: 0 })
	const activationRef = useRef(0)

	const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		pointerRef.current = {
			x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
			y: ((event.clientY - rect.top) / rect.height - 0.5) * -2
		}
	}, [])

	const handlePointerLeave = useCallback(() => {
		hoverRef.current = false
		pointerRef.current = { x: 0, y: 0 }
	}, [])

	const handleActivate = useCallback(() => {
		activationRef.current = 1
	}, [])

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		let disposed = false
		let frame = 0
		let cleanupScene: (() => void) | undefined

		const setup = async () => {
			const THREE = await import('three')
			if (disposed) return

			const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
			const scene = new THREE.Scene()
			const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
			camera.position.set(0, 0, 4.9)

			const renderer = new THREE.WebGLRenderer({
				alpha: true,
				antialias: true,
				powerPreference: 'high-performance'
			})
			renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
			renderer.outputColorSpace = THREE.SRGBColorSpace
			renderer.domElement.style.display = 'block'
			renderer.domElement.style.height = '100%'
			renderer.domElement.style.width = '100%'
			renderer.domElement.setAttribute('aria-hidden', 'true')
			container.appendChild(renderer.domElement)

			scene.add(new THREE.AmbientLight(0x87dcff, 1.65))

			const keyLight = new THREE.PointLight(0x9df4ff, 8.2, 8)
			keyLight.position.set(1.9, 1.8, 3.1)
			scene.add(keyLight)

			const rimLight = new THREE.PointLight(0x9f78ff, 5.2, 7)
			rimLight.position.set(-2.1, -1.4, 2.2)
			scene.add(rimLight)

			const root = new THREE.Group()
			scene.add(root)

			const createGlowTexture = () => {
				const canvas = document.createElement('canvas')
				canvas.width = 128
				canvas.height = 128
				const context = canvas.getContext('2d')
				if (!context) return new THREE.CanvasTexture(canvas)
				const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64)
				gradient.addColorStop(0, 'rgba(210, 253, 255, 0.95)')
				gradient.addColorStop(0.32, 'rgba(105, 235, 255, 0.42)')
				gradient.addColorStop(0.66, 'rgba(143, 116, 255, 0.18)')
				gradient.addColorStop(1, 'rgba(105, 235, 255, 0)')
				context.fillStyle = gradient
				context.fillRect(0, 0, 128, 128)
				const texture = new THREE.CanvasTexture(canvas)
				texture.colorSpace = THREE.SRGBColorSpace
				return texture
			}

			const glowTexture = createGlowTexture()
			const halo = new THREE.Sprite(
				new THREE.SpriteMaterial({
					map: glowTexture,
					color: 0x8cf5ff,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
					opacity: 0.46,
					transparent: true
				})
			)
			halo.scale.set(4.25, 4.25, 1)
			halo.position.z = -0.2
			root.add(halo)

			const beam = new THREE.Mesh(
				new THREE.CylinderGeometry(0.22, 0.42, 3.05, 48, 1, true),
				new THREE.MeshBasicMaterial({
					color: 0x72f3ff,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
					opacity: 0.09,
					side: THREE.DoubleSide,
					transparent: true
				})
			)
			beam.position.y = -0.02
			root.add(beam)

			const coreMaterial = new THREE.MeshStandardMaterial({
				color: 0x65e7ff,
				emissive: 0x123c64,
				emissiveIntensity: 1.15,
				metalness: 0.18,
				opacity: 0.72,
				roughness: 0.18,
				transparent: true
			})
			const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.98, 2), coreMaterial)
			root.add(core)

			const shell = new THREE.Mesh(
				new THREE.IcosahedronGeometry(1.18, 1),
				new THREE.MeshBasicMaterial({
					color: 0xb7f8ff,
					opacity: 0.22,
					transparent: true,
					wireframe: true
				})
			)
			root.add(shell)

			const innerMaterial = new THREE.MeshStandardMaterial({
				color: 0xffffff,
				emissive: 0x78f0ff,
				emissiveIntensity: 1.8,
				metalness: 0.08,
				opacity: 0.54,
				roughness: 0.08,
				transparent: true
			})
			const innerCore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48, 1), innerMaterial)
			root.add(innerCore)

			const edgeMaterial = new THREE.LineBasicMaterial({
				color: 0xd6fbff,
				opacity: 0.54,
				transparent: true
			})
			const edges = new THREE.LineSegments(new THREE.EdgesGeometry(core.geometry), edgeMaterial)
			root.add(edges)

			const ringMaterial = new THREE.MeshBasicMaterial({
				color: 0x76e8ff,
				opacity: 0.34,
				transparent: true
			})
			const accentRingMaterial = new THREE.MeshBasicMaterial({
				color: 0xb48cff,
				opacity: 0.28,
				transparent: true
			})
			const rings = [
				new THREE.Mesh(new THREE.TorusGeometry(1.54, 0.01, 8, 128), ringMaterial),
				new THREE.Mesh(new THREE.TorusGeometry(1.34, 0.008, 8, 128), accentRingMaterial),
				new THREE.Mesh(new THREE.TorusGeometry(1.78, 0.006, 8, 128), ringMaterial.clone())
			]
			rings[0].rotation.x = Math.PI / 2.6
			rings[1].rotation.y = Math.PI / 2.3
			rings[2].rotation.set(Math.PI / 2.2, 0.7, 0.2)
			rings.forEach(ring => root.add(ring))

			const baseGroup = new THREE.Group()
			baseGroup.position.y = -1.22
			baseGroup.position.z = -0.18
			root.add(baseGroup)

			const baseDisc = new THREE.Mesh(
				new THREE.CircleGeometry(1.32, 96),
				new THREE.MeshBasicMaterial({
					color: 0x5df0ff,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
					opacity: 0.1,
					side: THREE.DoubleSide,
					transparent: true
				})
			)
			baseDisc.scale.y = 0.2
			baseGroup.add(baseDisc)

			const baseRing = new THREE.Mesh(
				new THREE.TorusGeometry(1, 0.01, 8, 128),
				new THREE.MeshBasicMaterial({
					color: 0x8ff6ff,
					blending: THREE.AdditiveBlending,
					opacity: 0.42,
					transparent: true
				})
			)
			baseRing.scale.y = 0.22
			baseGroup.add(baseRing)

			const basePulse = new THREE.Mesh(
				new THREE.TorusGeometry(1.24, 0.006, 8, 128),
				new THREE.MeshBasicMaterial({
					color: 0xb58cff,
					blending: THREE.AdditiveBlending,
					opacity: 0.24,
					transparent: true
				})
			)
			basePulse.scale.y = 0.2
			baseGroup.add(basePulse)

			const particleCount = 118
			const particlePositions = new Float32Array(particleCount * 3)
			for (let index = 0; index < particleCount; index++) {
				const seed = index + 1
				const radius = 1.7 + ((seed * 17) % 70) / 100
				const theta = seed * 2.399963
				const y = (((seed * 29) % 100) / 100 - 0.5) * 2.2
				const ringRadius = Math.sqrt(Math.max(radius * radius - y * y * 0.45, 0.2))
				particlePositions[index * 3] = Math.cos(theta) * ringRadius
				particlePositions[index * 3 + 1] = y
				particlePositions[index * 3 + 2] = Math.sin(theta) * ringRadius
			}
			const particleGeometry = new THREE.BufferGeometry()
			particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
			const particles = new THREE.Points(
				particleGeometry,
				new THREE.PointsMaterial({
					color: 0xcaf9ff,
					opacity: 0.48,
					size: 0.022,
					transparent: true
				})
			)
			root.add(particles)

			const nodes = [0.2, 2.35, 4.45].map((angle, index) => {
				const node = new THREE.Mesh(
					new THREE.SphereGeometry(index === 1 ? 0.058 : 0.047, 18, 12),
					new THREE.MeshBasicMaterial({
						color: index === 1 ? 0xffc76f : 0x91f7ff,
						opacity: 0.92,
						transparent: true
					})
				)
				node.userData.angle = angle
				root.add(node)
				return node
			})

			const shardMaterial = new THREE.MeshStandardMaterial({
				color: 0x95f6ff,
				emissive: 0x227b93,
				emissiveIntensity: 1.1,
				metalness: 0.22,
				opacity: 0.74,
				roughness: 0.2,
				transparent: true
			})
			const shards = Array.from({ length: 7 }, (_, index) => {
				const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09 + (index % 3) * 0.025, 0), shardMaterial.clone())
				shard.userData.angle = index * 0.88
				shard.userData.radius = 1.36 + (index % 3) * 0.22
				shard.userData.speed = 0.74 + index * 0.045
				root.add(shard)
				return shard
			})

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

			const clock = new THREE.Clock()
			const animate = () => {
				const time = clock.getElapsedTime()
				const hover = hoverRef.current ? 1 : 0
				const pointer = pointerRef.current
				const activation = activationRef.current
				const pulse = reduceMotion ? 1 : 1 + Math.sin(time * 2.2) * 0.035
				const lift = hover * 0.12 + activation * 0.18
				const scale = pulse + hover * 0.045 + activation * 0.14

				root.position.x += (pointer.x * 0.16 - root.position.x) * 0.08
				root.position.y += (pointer.y * 0.12 + lift - root.position.y) * 0.08
				root.scale.setScalar(scale)

				core.rotation.x += (pointer.y * 0.24 + time * 0.18 - core.rotation.x) * 0.03
				core.rotation.y += reduceMotion ? 0.003 : 0.012 + hover * 0.006
				shell.rotation.x -= reduceMotion ? 0.002 : 0.006
				shell.rotation.y += reduceMotion ? 0.002 : 0.007
				beam.rotation.y += reduceMotion ? 0.002 : 0.006
				beam.scale.set(1 + hover * 0.08 + activation * 0.24, 1 + activation * 0.18, 1 + hover * 0.08 + activation * 0.24)
				innerCore.rotation.y -= reduceMotion ? 0.005 : 0.022
				edges.rotation.copy(core.rotation)
				edges.scale.setScalar(1.015 + activation * 0.08)

				rings[0].rotation.z += reduceMotion ? 0.003 : 0.012 + hover * 0.006
				rings[1].rotation.x += reduceMotion ? 0.002 : 0.009
				rings[2].rotation.y -= reduceMotion ? 0.002 : 0.007
				rings.forEach((ring, index) => {
					ring.scale.setScalar(1 + activation * (0.18 + index * 0.08))
				})

				baseRing.rotation.z -= reduceMotion ? 0.003 : 0.01
				basePulse.rotation.z += reduceMotion ? 0.002 : 0.007
				basePulse.scale.set(1 + Math.sin(time * 2.6) * 0.06 + activation * 0.34, 0.2 + hover * 0.025, 1)
				baseDisc.scale.set(1 + hover * 0.08 + activation * 0.22, 0.2 + hover * 0.02, 1)
				halo.scale.setScalar(3.25 + hover * 0.32 + activation * 0.58 + Math.sin(time * 1.9) * 0.08)
				halo.material.opacity = 0.42 + hover * 0.16 + activation * 0.22

				particles.rotation.y -= reduceMotion ? 0.001 : 0.0035
				particles.rotation.x = pointer.y * 0.06

				nodes.forEach((node, index) => {
					const angle = node.userData.angle + time * (0.7 + index * 0.16)
					node.position.set(Math.cos(angle) * 1.52, Math.sin(angle * 0.74) * 0.56, Math.sin(angle) * 0.72)
					node.scale.setScalar(1 + hover * 0.15 + activation * 0.35)
				})

				shards.forEach((shard, index) => {
					const angle = shard.userData.angle + time * shard.userData.speed
					const radius = shard.userData.radius + activation * 0.34
					shard.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.7 + index) * 0.58, Math.sin(angle) * 0.72)
					shard.rotation.x += reduceMotion ? 0.004 : 0.026 + index * 0.002
					shard.rotation.y -= reduceMotion ? 0.003 : 0.018
					shard.scale.setScalar(1 + hover * 0.12 + activation * 0.55)
				})

				coreMaterial.emissiveIntensity = 1.15 + hover * 0.45 + activation * 1.25
				innerMaterial.emissiveIntensity = 1.8 + hover * 0.6 + activation * 1.5
				edgeMaterial.opacity = 0.54 + hover * 0.16 + activation * 0.22
				shell.material.opacity = 0.2 + hover * 0.12 + activation * 0.22
				beam.material.opacity = 0.08 + hover * 0.08 + activation * 0.18
				activationRef.current = Math.max(activation * 0.9 - 0.01, 0)

				renderer.render(scene, camera)
				frame = window.requestAnimationFrame(animate)
			}
			animate()

			cleanupScene = () => {
				window.cancelAnimationFrame(frame)
				resizeObserver.disconnect()
				scene.traverse(object => {
					if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
						object.geometry.dispose()
						const material = object.material
						if (Array.isArray(material)) material.forEach(item => item.dispose())
						else material.dispose()
					} else if (object instanceof THREE.Sprite) {
						object.material.dispose()
					}
				})
				glowTexture.dispose()
				renderer.dispose()
				renderer.domElement.remove()
			}
		}

		setup()

		return () => {
			disposed = true
			cleanupScene?.()
		}
	}, [])

	return (
		<button
			type='button'
			aria-label='激活 WinriseF Core'
			onPointerEnter={() => {
				hoverRef.current = true
			}}
			onPointerMove={handlePointerMove}
			onPointerLeave={handlePointerLeave}
			onClick={handleActivate}
			className={cn('group/core relative mx-auto block h-[154px] w-[206px] overflow-hidden rounded-[28px] border border-[#8ff6ff]/12 bg-[radial-gradient(circle_at_50%_42%,rgba(112,235,255,0.12),transparent_48%)] focus:ring-2 focus:ring-[#79eaff]/70 focus:ring-offset-2 focus:ring-offset-transparent focus:outline-none', className)}>
			<div ref={containerRef} className='absolute inset-0 z-10' />
			<div className='absolute inset-3 rounded-full bg-[#6de7ff]/12 blur-2xl transition-opacity duration-300 group-hover/core:opacity-100' />
			<div className='pointer-events-none absolute top-3 left-3 h-4 w-4 border-t border-l border-[#b7f8ff]/42' />
			<div className='pointer-events-none absolute top-3 right-3 h-4 w-4 border-t border-r border-[#b7f8ff]/42' />
			<div className='pointer-events-none absolute bottom-3 left-3 h-4 w-4 border-b border-l border-[#b58cff]/36' />
			<div className='pointer-events-none absolute right-3 bottom-3 h-4 w-4 border-r border-b border-[#b58cff]/36' />
			<div className='pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/core:opacity-100'>
				<div className='absolute top-7 right-7 left-7 h-px bg-linear-to-r from-transparent via-[#d9fbff]/60 to-transparent animate-pulse' />
				<div className='absolute top-14 right-5 left-5 h-px bg-linear-to-r from-transparent via-[#9b8cff]/46 to-transparent animate-pulse' />
				<div className='absolute right-10 bottom-8 left-10 h-px bg-linear-to-r from-transparent via-[#71efff]/44 to-transparent animate-pulse' />
			</div>
			<div className='pointer-events-none absolute inset-x-10 bottom-4 h-px bg-linear-to-r from-transparent via-[#9df4ff]/50 to-transparent' />
			<div className='pointer-events-none absolute bottom-6 left-1/2 h-3 w-20 -translate-x-1/2 rounded-full bg-[#61edff]/16 blur-md' />
		</button>
	)
}
