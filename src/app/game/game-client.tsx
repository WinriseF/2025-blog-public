'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { startAnimationLoop } from '@/lib/animation-loop'
import { GameSurface, type GameSurfaceHud } from './game-surface'

type GamePhase = GameSurfaceHud['phase']
type BrickKind = 'core' | 'white' | 'steel' | 'charge'

type Arena = {
	width: number
	height: number
	left: number
	top: number
	right: number
	bottom: number
}

type Ball = {
	id: number
	x: number
	y: number
	vx: number
	vy: number
	radius: number
	color: string
	trail: Array<{ x: number; y: number }>
	trailCursor: number
}

type Paddle = {
	x: number
	y: number
	width: number
	height: number
	targetX: number
	vx: number
}

type Brick = {
	id: number
	x: number
	y: number
	w: number
	h: number
	hits: number
	maxHits: number
	kind: BrickKind
	alive: boolean
}

type BallDrop = {
	id: number
	x: number
	y: number
	vy: number
	radius: number
	count: number
	color: string
	rotation: number
}

type Particle = {
	id: number
	x: number
	y: number
	vx: number
	vy: number
	life: number
	maxLife: number
	size: number
	color: string
}

type Controls = {
	pointerX: number | null
	left: boolean
	right: boolean
}

type GameState = {
	phase: GamePhase
	level: number
	mapSeed: number
	score: number
	lives: number
	combo: number
	maxCombo: number
	arena: Arena
	paddle: Paddle
	balls: Ball[]
	bricks: Brick[]
	drops: BallDrop[]
	particles: Particle[]
	nextId: number
	message: string
}

type HudState = GameSurfaceHud

const MAX_BALLS = 180
const BASE_BALL_SPEED = 270
const LEVEL_SPEED_STEP = 24
const BALL_COLORS = ['#ffffff', '#7df9ff', '#ff7cf2', '#ffe875', '#77ff9b']
const INITIAL_HUD: HudState = {
	phase: 'ready',
	score: 0,
	lives: 3,
	level: 1,
	combo: 0,
	balls: 1,
	bricks: 0,
	message: '点击或按空格发射'
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value))
}

function rand(min: number, max: number) {
	return min + Math.random() * (max - min)
}

function createSeededRandom(seed: number) {
	let value = Math.floor(seed) % 2147483647
	if (value <= 0) value += 2147483646
	return () => {
		value = (value * 16807) % 2147483647
		return (value - 1) / 2147483646
	}
}

function seededInt(rng: () => number, min: number, max: number) {
	return Math.floor(min + rng() * (max - min + 1))
}

function seededFloat(rng: () => number, min: number, max: number) {
	return min + rng() * (max - min)
}

function cellNoise(seed: number, x: number, y: number, salt: number) {
	let value = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1442695041, 224682251) ^ Math.imul(seed + salt * 1013904223, 326648991)
	value = Math.imul(value ^ (value >>> 13), 1274126177)
	return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function ballSpeedForLevel(level: number) {
	return Math.min(660, BASE_BALL_SPEED + (level - 1) * LEVEL_SPEED_STEP)
}

function createArena(width: number, height: number): Arena {
	const compact = width < 720
	const side = compact ? 14 : clamp(width * 0.035, 28, 56)
	const top = compact ? 76 : clamp(height * 0.085, 82, 104)
	const bottomInset = compact ? 12 : clamp(height * 0.02, 18, 30)

	return {
		width,
		height,
		left: side,
		top,
		right: width - side,
		bottom: height - bottomInset
	}
}

function createPaddle(arena: Arena): Paddle {
	const playWidth = arena.right - arena.left
	const width = clamp(playWidth * 0.16, 104, 190)
	const height = arena.width < 720 ? 13 : 16
	const x = arena.left + playWidth / 2 - width / 2
	const y = arena.bottom - Math.max(42, arena.height * 0.062)

	return {
		x,
		y,
		width,
		height,
		targetX: x,
		vx: 0
	}
}

function makeBall(state: GameState, x: number, y: number, vx: number, vy: number): Ball {
	const id = state.nextId++
	const radius = state.arena.width < 720 ? 5.5 : 7
	return {
		id,
		x,
		y,
		vx,
		vy,
		radius,
		color: BALL_COLORS[id % BALL_COLORS.length],
		trail: [],
		trailCursor: 0
	}
}

function gridWidth(cols: number, cell: number, gap: number) {
	return cols * cell + Math.max(0, cols - 1) * gap
}

function buildBricks(arena: Arena, level: number, mapSeed: number): Brick[] {
	const bricks: Brick[] = []
	const rng = createSeededRandom(mapSeed + level * 7919)
	const compact = arena.width < 720
	const playWidth = arena.right - arena.left
	const playHeight = arena.bottom - arena.top
	const cell = compact ? clamp(Math.floor(playWidth / 48), 6, 10) : clamp(Math.floor(playWidth / 84), 10, 16)
	const gap = compact ? 2 : clamp(Math.floor(cell * 0.22), 2, 4)
	const pitch = cell + gap
	const topY = arena.top + clamp(playHeight * 0.028, 8, 22)
	const usableTopY = topY + pitch * (compact ? 2 : 3)
	const cols = Math.max(12, Math.floor(playWidth / pitch))
	const rows = compact ? clamp(Math.floor(playHeight * 0.44 / pitch), 14, 22) : clamp(Math.floor(playHeight * 0.5 / pitch), 18, 31)
	const startX = arena.left + (playWidth - gridWidth(cols, cell, gap)) / 2
	const grid: Array<Array<BrickKind | null>> = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null))
	const chargeChance = Math.min(0.13, 0.04 + level * 0.006)
	const symmetry = seededInt(rng, 0, 3)
	const density = compact ? seededFloat(rng, 0.42, 0.55) : seededFloat(rng, 0.45, 0.62)
	const blobCount = seededInt(rng, compact ? 4 : 5, compact ? 7 : 10)
	const tunnelCount = seededInt(rng, 1, compact ? 2 : 3)
	const coreBias = rng()
	let id = 1

	const blobs = Array.from({ length: blobCount }, () => ({
		x: rng(),
		y: seededFloat(rng, 0.1, 0.78),
		rx: seededFloat(rng, 0.1, compact ? 0.26 : 0.2),
		ry: seededFloat(rng, 0.12, 0.36),
		weight: seededFloat(rng, 0.35, 0.82),
		core: rng()
	}))

	const tunnels = Array.from({ length: tunnelCount }, () => ({
		vertical: rng() > 0.45,
		offset: seededFloat(rng, 0.18, 0.82),
		amp: seededFloat(rng, 0.03, 0.16),
		freq: seededFloat(rng, 1.4, 3.6),
		width: seededFloat(rng, 0.035, 0.085),
		phase: seededFloat(rng, 0, Math.PI * 2)
	}))

	const mirrorCol = (col: number) => (symmetry === 1 || symmetry === 3 ? cols - 1 - col : col)
	const mirrorRow = (row: number) => (symmetry === 2 || symmetry === 3 ? rows - 1 - row : row)
	const setCell = (col: number, row: number, kind: BrickKind | null) => {
		if (row < 0 || row >= rows || col < 0 || col >= cols) return
		grid[row][col] = kind
		const mirroredCol = mirrorCol(col)
		const mirroredRow = mirrorRow(row)
		if (mirroredCol !== col || mirroredRow !== row) grid[mirroredRow][mirroredCol] = kind
	}

	for (let col = 0; col < cols; col++) {
		if (cellNoise(mapSeed, col, 0, 12) > 0.08) setCell(col, 0, 'steel')
		if (!compact && cellNoise(mapSeed, col, 1, 13) > 0.84) setCell(col, 1, 'steel')
	}

	for (let row = 1; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const nx = cols <= 1 ? 0 : col / (cols - 1)
			const ny = rows <= 1 ? 0 : row / (rows - 1)
			const edgeDistance = Math.min(nx, 1 - nx, ny, 1 - ny)
			const centerPull = 1 - Math.abs(nx - 0.5) * 1.25
			const upperBias = 1 - ny * 0.58
			let score = density * 0.62 + centerPull * 0.2 + upperBias * 0.18 + cellNoise(mapSeed, col, row, 21) * 0.3

			for (const blob of blobs) {
				const dx = (nx - blob.x) / blob.rx
				const dy = (ny - blob.y) / blob.ry
				const influence = Math.max(0, 1 - (dx * dx + dy * dy))
				score += influence * blob.weight
			}

			for (const tunnel of tunnels) {
				const curve = tunnel.offset + Math.sin((tunnel.vertical ? ny : nx) * Math.PI * 2 * tunnel.freq + tunnel.phase) * tunnel.amp
				const distance = Math.abs((tunnel.vertical ? nx : ny) - curve)
				if (distance < tunnel.width) score -= (1 - distance / tunnel.width) * 0.78
			}

			if (edgeDistance < 0.025) score += 0.32
			if (score < 0.86) continue

			const nearestCore = blobs.reduce((best, blob) => {
				const dx = (nx - blob.x) / blob.rx
				const dy = (ny - blob.y) / blob.ry
				const influence = Math.max(0, 1 - (dx * dx + dy * dy))
				return influence > best.influence ? { influence, core: blob.core } : best
			}, { influence: 0, core: coreBias })
			const isCharge = cellNoise(mapSeed, col, row, 33) < chargeChance * (nearestCore.influence > 0.45 ? 1.45 : 0.75)
			const kind = isCharge ? 'charge' : nearestCore.core > 0.43 ? 'core' : 'white'
			setCell(col, row, kind)
		}
	}

	for (let row = 1; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const kind = grid[row][col]
			if (!kind) continue
			const exposed =
				row === 0 ||
				col === 0 ||
				col === cols - 1 ||
				row === rows - 1 ||
				!grid[row - 1]?.[col] ||
				!grid[row + 1]?.[col] ||
				!grid[row]?.[col - 1] ||
				!grid[row]?.[col + 1]
			if (exposed && kind !== 'charge') grid[row][col] = 'steel'
		}
	}

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const kind = grid[row][col]
			if (!kind) continue
			const hits = kind === 'steel' ? Math.min(3, 1 + level) : 1
			bricks.push({
				id: id++,
				x: startX + col * pitch,
				y: usableTopY + row * pitch,
				w: cell,
				h: cell,
				hits,
				maxHits: hits,
				kind,
				alive: true
			})
		}
	}

	return bricks
}

function createGameState(width: number, height: number, level = 1, carry?: { score?: number; lives?: number; message?: string; mapSeed?: number }): GameState {
	const arena = createArena(width, height)
	const paddle = createPaddle(arena)
	const mapSeed = carry?.mapSeed ?? Math.floor(rand(1, 1_000_000_000))
	const state: GameState = {
		phase: 'ready',
		level,
		mapSeed,
		score: carry?.score ?? 0,
		lives: carry?.lives ?? 3,
		combo: 0,
		maxCombo: 0,
		arena,
		paddle,
		balls: [],
		bricks: buildBricks(arena, level, mapSeed),
		drops: [],
		particles: [],
		nextId: 1000,
		message: carry?.message ?? '点击或按空格发射'
	}
	state.balls = [makeBall(state, paddle.x + paddle.width / 2, paddle.y - 12, 0, 0)]
	return state
}

function snapshotHud(state: GameState): HudState {
	return {
		phase: state.phase,
		score: state.score,
		lives: state.lives,
		level: state.level,
		combo: state.combo,
		balls: state.balls.length,
		bricks: state.bricks.reduce((count, brick) => count + Number(brick.alive), 0),
		message: state.message
	}
}

function launchReadyBall(state: GameState) {
	if (!state.balls.length) {
		state.balls.push(makeBall(state, state.paddle.x + state.paddle.width / 2, state.paddle.y - 12, 0, 0))
	}

	const speed = ballSpeedForLevel(state.level)
	for (const ball of state.balls) {
		const angle = rand(-0.42, 0.42)
		ball.x = state.paddle.x + state.paddle.width / 2
		ball.y = state.paddle.y - ball.radius - 2
		ball.vx = Math.sin(angle) * speed
		ball.vy = -Math.cos(angle) * speed
		ball.trail = []
		ball.trailCursor = 0
	}

	state.phase = 'running'
	state.message = '增殖球会从砖块里掉下来'
}

function spawnBurstBalls(state: GameState, x: number, y: number, count: number) {
	const available = Math.max(0, MAX_BALLS - state.balls.length)
	const amount = Math.min(count, available)
	if (amount <= 0) return

	const baseSpeed = ballSpeedForLevel(state.level) * 0.96
	for (let index = 0; index < amount; index++) {
		const spread = amount === 1 ? 0 : (index / (amount - 1) - 0.5) * 1.35
		const angle = -Math.PI / 2 + spread + rand(-0.12, 0.12)
		const speed = baseSpeed + rand(-24, 58 + state.level * 2)
		state.balls.push(makeBall(state, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed))
	}
}

function spawnDrop(state: GameState, brick: Brick) {
	if (state.drops.length > 32 || state.balls.length >= MAX_BALLS) return

	const count = brick.kind === 'charge' ? 6 : brick.kind === 'core' ? Math.floor(rand(2, 5)) : Math.floor(rand(2, 4))
	state.drops.push({
		id: state.nextId++,
		x: brick.x + brick.w / 2,
		y: brick.y + brick.h / 2,
		vy: rand(120, 170) + state.level * 16,
		radius: state.arena.width < 720 ? 8 : 10,
		count,
		color: brick.kind === 'charge' ? '#ff7cf2' : '#7df9ff',
		rotation: rand(0, Math.PI * 2)
	})
}

function spawnParticles(state: GameState, x: number, y: number, color: string, count: number) {
	for (let index = 0; index < count; index++) {
		const life = rand(0.32, 0.72)
		state.particles.push({
			id: state.nextId++,
			x,
			y,
			vx: rand(-190, 190),
			vy: rand(-210, 130),
			life,
			maxLife: life,
			size: rand(2, 5),
			color
		})
	}
	if (state.particles.length > 720) {
		state.particles.splice(0, state.particles.length - 720)
	}
}

function brickColor(brick: Brick) {
	if (brick.kind === 'core') return '#ff1636'
	if (brick.kind === 'white') return '#f7fbff'
	if (brick.kind === 'charge') return '#ff4fe4'
	return brick.hits < brick.maxHits ? '#b4bdc8' : '#7d8793'
}

function hitBrick(state: GameState, brick: Brick) {
	brick.hits -= 1
	const color = brickColor(brick)

	if (brick.hits > 0) {
		state.score += 10
		spawnParticles(state, brick.x + brick.w / 2, brick.y + brick.h / 2, color, 3)
		return
	}

	brick.alive = false
	state.combo += 1
	state.maxCombo = Math.max(state.maxCombo, state.combo)
	state.score += brick.kind === 'charge' ? 85 + state.combo * 3 : brick.kind === 'steel' ? 45 : 30 + state.combo * 2
	spawnParticles(state, brick.x + brick.w / 2, brick.y + brick.h / 2, color, brick.kind === 'charge' ? 14 : 7)

	const dropChance = brick.kind === 'charge' ? 1 : brick.kind === 'core' ? 0.28 : brick.kind === 'white' ? 0.18 : 0.04
	if (Math.random() < dropChance + Math.min(0.16, state.combo * 0.003)) {
		spawnDrop(state, brick)
	}

	if (brick.kind === 'charge') {
		spawnBurstBalls(state, brick.x + brick.w / 2, brick.y + brick.h / 2, 2)
	}
}

function keepBallSpeed(ball: Ball, level: number) {
	const levelSpeed = ballSpeedForLevel(level)
	const minSpeed = Math.max(220, levelSpeed * 0.78)
	const maxSpeed = Math.min(900, levelSpeed * 1.72 + level * 18)
	let speed = Math.hypot(ball.vx, ball.vy)
	if (speed === 0) return

	const target = clamp(speed, minSpeed, maxSpeed)
	ball.vx = (ball.vx / speed) * target
	ball.vy = (ball.vy / speed) * target
	speed = target

	const minVertical = speed * 0.28
	if (Math.abs(ball.vy) < minVertical) {
		const sign = ball.vy < 0 ? -1 : 1
		ball.vy = sign * minVertical
		ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(Math.max(speed * speed - ball.vy * ball.vy, minSpeed * minSpeed * 0.25))
	}
}

function collideBallWithPaddle(ball: Ball, paddle: Paddle) {
	const closestX = clamp(ball.x, paddle.x, paddle.x + paddle.width)
	const closestY = clamp(ball.y, paddle.y, paddle.y + paddle.height)
	const dx = ball.x - closestX
	const dy = ball.y - closestY

	if (dx * dx + dy * dy > ball.radius * ball.radius || ball.vy <= 0) return false

	const relative = clamp((ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2), -1, 1)
	const speed = Math.max(ballSpeedForLevel(1) * 0.82, Math.hypot(ball.vx, ball.vy) + Math.min(7, 2.5 + paddle.width / 80))
	const angle = relative * 1.15
	ball.vx = Math.sin(angle) * speed + paddle.vx * 0.16
	ball.vy = -Math.cos(angle) * speed
	ball.y = paddle.y - ball.radius - 0.5
	return true
}

function collideBallWithBrick(ball: Ball, brick: Brick) {
	if (!brick.alive) return false
	if (ball.x + ball.radius < brick.x || ball.x - ball.radius > brick.x + brick.w || ball.y + ball.radius < brick.y || ball.y - ball.radius > brick.y + brick.h) return false

	const closestX = clamp(ball.x, brick.x, brick.x + brick.w)
	const closestY = clamp(ball.y, brick.y, brick.y + brick.h)
	const dx = ball.x - closestX
	const dy = ball.y - closestY
	if (dx * dx + dy * dy > ball.radius * ball.radius) return false

	const overlapLeft = ball.x + ball.radius - brick.x
	const overlapRight = brick.x + brick.w - (ball.x - ball.radius)
	const overlapTop = ball.y + ball.radius - brick.y
	const overlapBottom = brick.y + brick.h - (ball.y - ball.radius)
	const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom)

	if (minOverlap === overlapLeft) {
		ball.x = brick.x - ball.radius - 0.5
		ball.vx = -Math.abs(ball.vx)
	} else if (minOverlap === overlapRight) {
		ball.x = brick.x + brick.w + ball.radius + 0.5
		ball.vx = Math.abs(ball.vx)
	} else if (minOverlap === overlapTop) {
		ball.y = brick.y - ball.radius - 0.5
		ball.vy = -Math.abs(ball.vy)
	} else {
		ball.y = brick.y + brick.h + ball.radius + 0.5
		ball.vy = Math.abs(ball.vy)
	}

	return true
}

function circleRectCollision(x: number, y: number, radius: number, paddle: Paddle) {
	const closestX = clamp(x, paddle.x, paddle.x + paddle.width)
	const closestY = clamp(y, paddle.y, paddle.y + paddle.height)
	const dx = x - closestX
	const dy = y - closestY
	return dx * dx + dy * dy <= radius * radius
}

function retainInPlace<T>(items: T[], keep: (item: T) => boolean) {
	let writeIndex = 0
	for (const item of items) if (keep(item)) items[writeIndex++] = item
	items.length = writeIndex
}

function updateGame(state: GameState, controls: Controls, dt: number) {
	const { arena, paddle } = state
	const previousX = paddle.x

	if (controls.left || controls.right) {
		controls.pointerX = null
	} else if (controls.pointerX !== null) {
		paddle.targetX = clamp(controls.pointerX - paddle.width / 2, arena.left, arena.right - paddle.width)
	}
	if (controls.left) paddle.targetX -= 760 * dt
	if (controls.right) paddle.targetX += 760 * dt
	paddle.targetX = clamp(paddle.targetX, arena.left, arena.right - paddle.width)
	paddle.x += (paddle.targetX - paddle.x) * Math.min(1, dt * 18)
	paddle.vx = (paddle.x - previousX) / Math.max(dt, 0.001)

	if (state.phase === 'ready') {
		const ball = state.balls[0]
		if (ball) {
			ball.x = paddle.x + paddle.width / 2
			ball.y = paddle.y - ball.radius - 2
		}
	}

	if (state.phase !== 'running') {
		updateParticles(state, dt)
		return
	}

	const steps = state.balls.length > 80 ? 1 : 2
	const stepDt = dt / steps
	for (let step = 0; step < steps; step++) {
		for (const ball of state.balls) {
			ball.x += ball.vx * stepDt
			ball.y += ball.vy * stepDt
			if (ball.trail.length < 5) ball.trail.push({ x: ball.x, y: ball.y })
			else {
				const point = ball.trail[ball.trailCursor]
				point.x = ball.x
				point.y = ball.y
				ball.trailCursor = (ball.trailCursor + 1) % ball.trail.length
			}

			if (ball.x - ball.radius < arena.left) {
				ball.x = arena.left + ball.radius
				ball.vx = Math.abs(ball.vx)
			}
			if (ball.x + ball.radius > arena.right) {
				ball.x = arena.right - ball.radius
				ball.vx = -Math.abs(ball.vx)
			}
			if (ball.y - ball.radius < arena.top) {
				ball.y = arena.top + ball.radius
				ball.vy = Math.abs(ball.vy)
			}

			if (collideBallWithPaddle(ball, paddle)) {
				state.combo = 0
				spawnParticles(state, ball.x, ball.y + ball.radius, '#ffffff', 3)
			}

			for (const brick of state.bricks) {
				if (!brick.alive) continue
				if (!collideBallWithBrick(ball, brick)) continue
				hitBrick(state, brick)
				keepBallSpeed(ball, state.level)
				break
			}

			keepBallSpeed(ball, state.level)
		}
	}

	retainInPlace(state.balls, ball => ball.y - ball.radius < arena.bottom + 90)

	for (const drop of state.drops) {
		drop.y += drop.vy * dt
		drop.rotation += dt * 3.2
		if (circleRectCollision(drop.x, drop.y, drop.radius, paddle)) {
			drop.y = arena.bottom + 999
			state.score += drop.count * 25
			state.message = `+${drop.count} 新球入场`
			spawnBurstBalls(state, drop.x, paddle.y - 14, drop.count)
			spawnParticles(state, drop.x, paddle.y, drop.color, 18)
		}
	}
	retainInPlace(state.drops, drop => drop.y < arena.bottom + 70)

	if (!state.balls.length) {
		state.lives -= 1
		state.combo = 0
		if (state.lives <= 0) {
			state.phase = 'lost'
			state.message = '球池耗尽，重新开局'
		} else {
			state.phase = 'ready'
			state.message = '点击或按空格继续'
			state.balls = [makeBall(state, paddle.x + paddle.width / 2, paddle.y - 12, 0, 0)]
		}
	}

	if (state.bricks.every(brick => !brick.alive)) {
		state.phase = 'cleared'
		state.message = '清屏完成，进入下一关'
	}

	updateParticles(state, dt)
}

function updateParticles(state: GameState, dt: number) {
	for (const particle of state.particles) {
		particle.life -= dt
		particle.x += particle.vx * dt
		particle.y += particle.vy * dt
		particle.vy += 260 * dt
	}
	retainInPlace(state.particles, particle => particle.life > 0)
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
	const r = Math.min(radius, width / 2, height / 2)
	ctx.beginPath()
	ctx.moveTo(x + r, y)
	ctx.lineTo(x + width - r, y)
	ctx.quadraticCurveTo(x + width, y, x + width, y + r)
	ctx.lineTo(x + width, y + height - r)
	ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
	ctx.lineTo(x + r, y + height)
	ctx.quadraticCurveTo(x, y + height, x, y + height - r)
	ctx.lineTo(x, y + r)
	ctx.quadraticCurveTo(x, y, x + r, y)
	ctx.closePath()
}

function drawGame(ctx: CanvasRenderingContext2D, state: GameState) {
	const { arena } = state
	ctx.clearRect(0, 0, arena.width, arena.height)

	const background = ctx.createLinearGradient(0, 0, 0, arena.height)
	background.addColorStop(0, '#1a1d72')
	background.addColorStop(0.48, '#11145c')
	background.addColorStop(1, '#090d3f')
	ctx.fillStyle = background
	ctx.fillRect(0, 0, arena.width, arena.height)

	const glow = ctx.createRadialGradient(arena.width * 0.5, arena.height * 0.18, 0, arena.width * 0.5, arena.height * 0.18, arena.width * 0.68)
	glow.addColorStop(0, 'rgba(99, 121, 255, 0.2)')
	glow.addColorStop(0.45, 'rgba(39, 230, 255, 0.08)')
	glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
	ctx.fillStyle = glow
	ctx.fillRect(0, 0, arena.width, arena.height)

	ctx.save()

	roundedRect(ctx, arena.left - 12, arena.top - 14, arena.right - arena.left + 24, arena.bottom - arena.top + 28, 28)
	ctx.fillStyle = 'rgba(9, 12, 58, 0.66)'
	ctx.fill()
	ctx.strokeStyle = 'rgba(157, 174, 255, 0.18)'
	ctx.lineWidth = 2
	ctx.stroke()

	for (const brick of state.bricks) {
		if (!brick.alive) continue
		const color = brickColor(brick)
		ctx.save()
		ctx.globalAlpha = brick.hits < brick.maxHits ? 0.72 : 1
		roundedRect(ctx, brick.x, brick.y, brick.w, brick.h, Math.max(2, brick.w * 0.14))
		ctx.fillStyle = color
		ctx.shadowColor = brick.kind === 'charge' ? 'rgba(255, 79, 228, 0.6)' : brick.kind === 'core' ? 'rgba(255, 22, 54, 0.35)' : 'transparent'
		ctx.shadowBlur = brick.kind === 'charge' ? 12 : brick.kind === 'core' ? 5 : 0
		ctx.fill()
		ctx.restore()
	}

	for (const particle of state.particles) {
		const alpha = clamp(particle.life / particle.maxLife, 0, 1)
		ctx.globalAlpha = alpha
		ctx.fillStyle = particle.color
		ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size)
	}
	ctx.globalAlpha = 1

	for (const drop of state.drops) {
		ctx.save()
		ctx.translate(drop.x, drop.y)
		ctx.rotate(drop.rotation)
		ctx.shadowColor = drop.color
		ctx.shadowBlur = 18
		ctx.fillStyle = 'rgba(255,255,255,0.9)'
		ctx.beginPath()
		ctx.arc(0, 0, drop.radius, 0, Math.PI * 2)
		ctx.fill()
		ctx.strokeStyle = drop.color
		ctx.lineWidth = 3
		ctx.beginPath()
		ctx.arc(0, 0, drop.radius + 3, 0, Math.PI * 2)
		ctx.stroke()
		ctx.restore()

		ctx.font = `700 ${drop.radius + 4}px system-ui, sans-serif`
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.fillStyle = '#11145c'
		ctx.fillText(String(drop.count), drop.x, drop.y + 0.5)
	}

	ctx.save()
	ctx.shadowColor = 'rgba(255, 255, 255, 0.5)'
	ctx.shadowBlur = 16
	roundedRect(ctx, state.paddle.x, state.paddle.y, state.paddle.width, state.paddle.height, state.paddle.height / 2)
	ctx.fillStyle = '#ffffff'
	ctx.fill()
	ctx.restore()

	for (const ball of state.balls) {
		for (let index = 0; index < ball.trail.length; index++) {
			const point = ball.trail[ball.trail.length === 5 ? (ball.trailCursor + index) % ball.trail.length : index]
			const alpha = (index + 1) / ball.trail.length
			ctx.globalAlpha = alpha * 0.18
			ctx.fillStyle = ball.color
			ctx.beginPath()
			ctx.arc(point.x, point.y, ball.radius * alpha, 0, Math.PI * 2)
			ctx.fill()
		}
		ctx.globalAlpha = 1
		ctx.save()
		ctx.shadowColor = ball.color
		ctx.shadowBlur = 18
		ctx.fillStyle = ball.color
		ctx.beginPath()
		ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2)
		ctx.fill()
		ctx.restore()
	}

	ctx.restore()

	ctx.globalAlpha = 0.12
	ctx.fillStyle = '#ffffff'
	for (let y = 0; y < arena.height; y += 6) {
		ctx.fillRect(0, y, arena.width, 1)
	}
	ctx.globalAlpha = 1
}

export default function GameClient() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const gameRef = useRef<GameState | null>(null)
	const controlsRef = useRef<Controls>({ pointerX: null, left: false, right: false })
	const lastHudUpdateRef = useRef(0)
	const [hud, setHud] = useState<HudState>(INITIAL_HUD)

	const syncHud = useCallback((force = false) => {
		const state = gameRef.current
		if (!state) return
		const now = performance.now()
		if (!force && now - lastHudUpdateRef.current < 80) return
		lastHudUpdateRef.current = now
		setHud(snapshotHud(state))
	}, [])

	const resetGame = useCallback(
		(level = 1) => {
			const canvas = canvasRef.current
			if (!canvas) return
			const width = canvas.clientWidth || window.innerWidth
			const height = canvas.clientHeight || window.innerHeight
			gameRef.current = createGameState(width, height, level)
			controlsRef.current.pointerX = null
			syncHud(true)
		},
		[syncHud]
	)

	const startOrResume = useCallback(() => {
		const state = gameRef.current
		if (!state) return
		if (state.phase === 'ready') launchReadyBall(state)
		else if (state.phase === 'paused') {
			state.phase = 'running'
			state.message = '继续清屏'
		} else if (state.phase === 'lost') resetGame(1)
		else if (state.phase === 'cleared') {
			const canvas = canvasRef.current
			const width = canvas?.clientWidth || window.innerWidth
			const height = canvas?.clientHeight || window.innerHeight
			gameRef.current = createGameState(width, height, state.level + 1, {
				score: state.score + 500,
				lives: Math.min(5, state.lives + 1),
				message: '下一关已装填，继续发射'
			})
		}
		syncHud(true)
	}, [resetGame, syncHud])

	const togglePause = useCallback(() => {
		const state = gameRef.current
		if (!state) return
		if (state.phase === 'running') {
			state.phase = 'paused'
			state.message = '已暂停'
		} else if (state.phase === 'paused') {
			state.phase = 'running'
			state.message = '继续清屏'
		}
		syncHud(true)
	}, [syncHud])

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const ctx = canvas.getContext('2d')
		if (!ctx) return

		let renderedWidth = 0
		let renderedHeight = 0
		let renderedDpr = 0
		let resizeFrame = 0
		const resize = () => {
			const width = canvas.clientWidth || window.innerWidth
			const height = canvas.clientHeight || window.innerHeight
			const dpr = Math.min(window.devicePixelRatio || 1, 2)
			if (width === renderedWidth && height === renderedHeight && dpr === renderedDpr) return
			renderedWidth = width
			renderedHeight = height
			renderedDpr = dpr
			canvas.width = Math.max(1, Math.floor(width * dpr))
			canvas.height = Math.max(1, Math.floor(height * dpr))
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			const previous = gameRef.current
			gameRef.current = createGameState(
				width,
				height,
				previous?.level ?? 1,
				previous
					? {
							score: previous.score,
							lives: previous.lives,
							message: previous.message,
							mapSeed: previous.mapSeed
						}
					: undefined
			)
			syncHud(true)
		}

		const scheduleResize = () => {
			if (resizeFrame) return
			resizeFrame = window.requestAnimationFrame(() => {
				resizeFrame = 0
				resize()
			})
		}

		const frame = (deltaMs: number) => {
			const state = gameRef.current
			if (state) {
				const dt = Math.min(deltaMs / 1000, 0.032)
				updateGame(state, controlsRef.current, dt)
				drawGame(ctx, state)
				syncHud()
			}
		}

		resize()
		const animationLoop = startAnimationLoop(({ deltaMs }) => frame(deltaMs), { element: canvas, maxDeltaMs: 32 })
		window.addEventListener('resize', scheduleResize)

		return () => {
			animationLoop.destroy()
			if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
			window.removeEventListener('resize', scheduleResize)
			canvas.width = 1
			canvas.height = 1
		}
	}, [syncHud])

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
				controlsRef.current.left = true
				event.preventDefault()
			}
			if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
				controlsRef.current.right = true
				event.preventDefault()
			}
			if (event.code === 'Space' || event.key === 'Enter') {
				startOrResume()
				event.preventDefault()
			}
			if (event.key === 'p' || event.key === 'P') {
				togglePause()
				event.preventDefault()
			}
			if (event.key === 'r' || event.key === 'R') {
				resetGame(1)
				event.preventDefault()
			}
		}

		const handleKeyUp = (event: KeyboardEvent) => {
			if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') controlsRef.current.left = false
			if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') controlsRef.current.right = false
		}

		window.addEventListener('keydown', handleKeyDown)
		window.addEventListener('keyup', handleKeyUp)
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('keyup', handleKeyUp)
		}
	}, [resetGame, startOrResume, togglePause])

	const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
		controlsRef.current.pointerX = event.clientX
	}, [])

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLElement>) => {
			controlsRef.current.pointerX = event.clientX
			startOrResume()
		},
		[startOrResume]
	)

	return (
		<GameSurface
			canvasRef={canvasRef}
			hud={hud}
			maxBalls={MAX_BALLS}
			onPointerMove={handlePointerMove}
			onPointerDown={handlePointerDown}
			onReset={resetGame}
			onStart={startOrResume}
			onTogglePause={togglePause}
		/>
	)
}
