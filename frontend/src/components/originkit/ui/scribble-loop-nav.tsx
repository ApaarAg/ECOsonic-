/* eslint-disable */
// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

// Delivered by Originkit · stack: framer
// Paste into a Framer code component. Property controls included.
import * as React from "react"
import { useEffect, useRef, useState } from "react"
/** Tuning values. Stripped at publish; the tuned values are baked in here. */
const ADVANCED_DEFAULTS = {
    hover: 50,
    grain: 0,
    vignette: 0,
    rowY: 50,
    loopPadX: 130,
    loopHeight: 264,
    loopOffsetY: 0,
    startAngle: 240,
    sweep: 310,
    spiral: 4,
    leadIn: 130,
    curl: 75,
    topFlatten: 8,
    bottomBulge: 6,
    tilt: -2,
    seed: 7,
    detail: 140,
    connectorSag: 15,
    moveMs: 850,
    skipExtra: 30,
    drawMs: 650,
    demoFirstMs: 1400,
    demoEveryMs: 2400,
    demoHideMs: 900,
    leanPx: 6,
    pressSquash: 6,
    strokeOpacity: 100,
    glow: 0,
    textOpacity: 100,
}

// ── moved controls (builder) ──
/**
 * Controls moved in the builder: into Advanced, out of it, or into groups of
 * their own. The code reads each one where it was first written, so the props
 * are put back in that shape before anything reads them.
 */
const MOVED_CONTROLS: { into: Record<string, string>; out: Record<string, string> } = {"into":{},"out":{"hover":"advanced"}}
const GROUP_FALLBACKS: Record<string, any> = { advanced: ADVANCED_DEFAULTS }
function withMovedControls(props: any): any {
    const out = { ...props }
    for (const [k, g] of Object.entries(MOVED_CONTROLS.into)) out[k] = props?.[g]?.[k] ?? GROUP_FALLBACKS[g]?.[k]
    for (const [k, g] of Object.entries(MOVED_CONTROLS.out)) {
        if (out[k] !== undefined) out[g] = { ...(out[g] ?? {}), [k]: out[k] }
    }
    return out
}
// ── /moved controls ──

const DEFAULT_ITEMS = ["Home", "About", "Services", "Portfolio", "Contact"]
const TAU = Math.PI * 2
const DEG = Math.PI / 180

type Pt = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }
type Loop = { cx: number; cy: number; rx: number; ry: number }
type Chain = {
    xs: Float32Array
    ys: Float32Array
    cum: Float32Array
    bounds: number[]
    loops: Loop[]
}
/** One end of the visible stroke: a Hermite tween in arc length, endpoints kept in chain units. */
type End = { fromU: number; toU: number; t0: number; dur: number; v0: number }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const num = (v: any, d: number) => (typeof v === "number" && isFinite(v) ? v : d)

function itemList(v: any): string[] {
    if (!Array.isArray(v)) return DEFAULT_ITEMS
    const out = v.map((s: any) => (typeof s === "string" ? s : String(s ?? ""))).filter((s: string) => s.length > 0)
    return out.length ? out.slice(0, 16) : DEFAULT_ITEMS
}

function rng(seed: number) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function norm(x: number, y: number): Pt {
    const l = Math.hypot(x, y) || 1
    return { x: x / l, y: y / l }
}

function quad(a: Pt, c: Pt, b: Pt, steps: number): Pt[] {
    const out: Pt[] = []
    for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const u = 1 - t
        out.push({
            x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
            y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        })
    }
    return out
}

function cubic(a: Pt, b: Pt, c: Pt, d: Pt, steps: number): Pt[] {
    const out: Pt[] = []
    for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const u = 1 - t
        const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
        out.push({
            x: w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x,
            y: w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y,
        })
    }
    return out
}

/**
 * One continuous stroke: for each item a lead-in rising from inside the loop, the loop drawn
 * clockwise, and a short curl flicking right; between items a smooth, nearly straight
 * connector at text height running from one curl into the next lead-in.
 * Item i spans chain units [2i, 2i + 1]; the connector after it spans [2i + 1, 2i + 2].
 */
function buildChain(boxes: Box[], f: number, wob: number, adv: typeof ADVANCED_DEFAULTS): Chain {
    const loops: Loop[] = []
    const loopPts: Pt[][] = []
    const starts: Pt[] = []
    const startDirs: Pt[] = []
    const ends: Pt[] = []
    const endDirs: Pt[] = []
    const detail = Math.max(24, Math.round(adv.detail))

    boxes.forEach((b, i) => {
        const rnd = rng(Math.round(adv.seed) * 977 + i * 131 + 1)
        const p1 = rnd() * TAU, p2 = rnd() * TAU, tj = rnd() - 0.5
        const cx = b.x + b.w / 2
        const cy = b.y + b.h / 2 + (f * adv.loopOffsetY) / 100
        const rx = b.w / 2 + (f * adv.loopPadX) / 100
        const ry = (f * adv.loopHeight) / 200
        const th0 = adv.startAngle * DEG
        const th1 = th0 + Math.max(90, adv.sweep) * DEG
        const tiltR = (adv.tilt + tj * 4 * wob) * DEG
        const ct = Math.cos(tiltR), st = Math.sin(tiltR)
        const at = (th: number, t: number): Pt => {
            const r = 1 + wob * (0.035 * Math.sin(2 * th + p1) + 0.022 * Math.sin(3 * th + p2)) + (adv.spiral / 100) * (t - 0.5)
            const s = Math.sin(th), c = Math.cos(th)
            const dx = rx * r * c
            let dy = ry * r * s
            if (s < 0) dy *= 1 - (adv.topFlatten / 100) * -s
            // s·c² lands flat at the bottom of the loop, where 2·s·c left a corner; 2.6 keeps its peak.
            if (s > 0 && c > 0) dy += ry * (adv.bottomBulge / 100) * 2.6 * s * c * c
            return { x: cx + dx * ct - dy * st, y: cy + dx * st + dy * ct }
        }

        // lead-in: from inside, left of the label, rising into the top arc's tangent
        const J = at(th0, 0)
        const J2 = at(th0 + 0.01, 0)
        const T0 = norm(J2.x - J.x, J2.y - J.y)
        const li = (f * adv.leadIn) / 100
        const L0 = { x: J.x - 0.6 * li, y: J.y + 0.8 * li }
        const C0 = { x: J.x - T0.x * li * 0.45, y: J.y - T0.y * li * 0.45 }
        const lead = quad(L0, C0, J, 12)

        const body: Pt[] = []
        for (let k = 1; k <= detail; k++) {
            const t = k / detail
            body.push(at(th0 + (th1 - th0) * t, t))
        }

        // end curl: up the left side, then a short flick to the right
        const E = at(th1, 1)
        const E0 = at(th1 - 0.01, 1)
        const T1 = norm(E.x - E0.x, E.y - E0.y)
        const cl = (f * adv.curl) / 100
        const C2 = { x: E.x + T1.x * cl * 0.45, y: E.y + T1.y * cl * 0.45 }
        const TE = { x: E.x + cl * 0.95, y: E.y - cl * 0.45 }
        const curl = quad(E, C2, TE, 10).slice(1)

        loops.push({ cx, cy, rx, ry })
        loopPts.push([...lead, ...body, ...curl])
        starts.push(L0)
        startDirs.push(norm(C0.x - L0.x, C0.y - L0.y))
        ends.push(TE)
        endDirs.push(norm(TE.x - C2.x, TE.y - C2.y))
    })

    const segs: Pt[][] = []
    const sag = (f * adv.connectorSag) / 100
    for (let i = 0; i < boxes.length; i++) {
        segs.push(loopPts[i])
        if (i < boxes.length - 1) {
            const A = ends[i]
            const B = starts[i + 1]
            const D = Math.hypot(B.x - A.x, B.y - A.y)
            const c1 = { x: A.x + endDirs[i].x * D * 0.35, y: A.y + endDirs[i].y * D * 0.35 + sag }
            const c2 = { x: B.x - startDirs[i + 1].x * D * 0.1, y: B.y - startDirs[i + 1].y * D * 0.1 + sag }
            segs.push(cubic(A, c1, c2, B, 32))
        }
    }

    const all: Pt[] = []
    const startIdx: number[] = []
    for (const s of segs) {
        if (all.length === 0) {
            startIdx.push(0)
            all.push(...s)
        } else {
            startIdx.push(all.length - 1)
            for (let k = 1; k < s.length; k++) all.push(s[k])
        }
    }
    startIdx.push(all.length - 1)

    const xs = new Float32Array(all.length)
    const ys = new Float32Array(all.length)
    const cum = new Float32Array(all.length)
    for (let i = 0; i < all.length; i++) {
        xs[i] = all[i].x
        ys[i] = all[i].y
        cum[i] = i === 0 ? 0 : cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
    }
    const bounds = startIdx.map((k) => cum[k])
    return { xs, ys, cum, bounds, loops }
}

function search(cum: Float32Array, s: number) {
    let lo = 0, hi = cum.length - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (cum[mid] <= s) lo = mid
        else hi = mid - 1
    }
    return lo
}

function pointAt(ch: Chain, s: number): Pt {
    const n = ch.cum.length
    const i = search(ch.cum, s)
    if (i >= n - 1) return { x: ch.xs[n - 1], y: ch.ys[n - 1] }
    const span = ch.cum[i + 1] - ch.cum[i] || 1
    const t = clamp((s - ch.cum[i]) / span, 0, 1)
    return { x: ch.xs[i] + (ch.xs[i + 1] - ch.xs[i]) * t, y: ch.ys[i] + (ch.ys[i + 1] - ch.ys[i]) * t }
}

function uToS(ch: Chain, u: number) {
    const last = ch.bounds.length - 1
    const uu = clamp(u, 0, last)
    const m = Math.min(Math.floor(uu), last - 1)
    const fr = uu - m
    return ch.bounds[m] + fr * (ch.bounds[m + 1] - ch.bounds[m])
}

function sToU(ch: Chain, s: number) {
    const b = ch.bounds
    if (s <= b[0]) return 0
    for (let m = 0; m < b.length - 1; m++) {
        if (s < b[m + 1]) return m + (s - b[m]) / (b[m + 1] - b[m] || 1)
    }
    return b.length - 1
}

const fix = (v: number) => v.toFixed(2)

/**
 * The stretch of the chain from a to b as SVG path data: quadratics through the midpoints
 * of its segments, so the line is a true curve with no facets however far it is zoomed.
 */
function tracePath(ch: Chain, a: number, b: number) {
    const total = ch.cum[ch.cum.length - 1]
    const lo = clamp(a, 0, total), hi = clamp(b, 0, total)
    const p0 = pointAt(ch, lo)
    const p1 = pointAt(ch, hi)
    let d = `M${fix(p0.x)} ${fix(p0.y)}`
    let j = search(ch.cum, lo) + 1
    while (j < ch.cum.length && ch.cum[j] < hi) {
        const inside = j + 1 < ch.cum.length && ch.cum[j + 1] < hi
        const nx = inside ? ch.xs[j + 1] : p1.x
        const ny = inside ? ch.ys[j + 1] : p1.y
        d += `Q${fix(ch.xs[j])} ${fix(ch.ys[j])} ${fix((ch.xs[j] + nx) / 2)} ${fix((ch.ys[j] + ny) / 2)}`
        j++
    }
    return `${d}L${fix(p1.x)} ${fix(p1.y)}`
}

function makeEnd(): End {
    return { fromU: 0, toU: 0, t0: 0, dur: 0, v0: 0 }
}

/** Arc length of an end at time t: cubic Hermite from the start point and velocity to rest at the goal. */
function endS(ch: Chain, e: End, t: number) {
    const to = uToS(ch, e.toU)
    if (e.dur <= 0 || t >= e.t0 + e.dur) return to
    const from = uToS(ch, e.fromU)
    if (t <= e.t0) return from
    const s = (t - e.t0) / e.dur
    const s2 = s * s, s3 = s2 * s
    return from * (2 * s3 - 3 * s2 + 1) + to * (-2 * s3 + 3 * s2) + e.v0 * e.dur * (s3 - 2 * s2 + s)
}

function themed(value: string | undefined, darkDefault: string, fallback: string) {
    return !value || value.toUpperCase() === darkDefault ? fallback : value
}

/**
 * Scribble Loop Nav — a hand-drawn loop circles the hovered menu item and travels
 * along one continuous stroke (loop → line through the labels → next loop) when the item changes.
 *
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 800
 */
export default function ScribbleLoopNav(props: any) {
    props = withMovedControls(props)
    const {
        theme = "dark",
        strokeColor = "#EEC12A",
        font,
        items = ["Home","About","Services","Portfolio","Contact"],
        active = 4,
        size = 24,
        gap = 72,
        strokeWidth = 3,
        speed = 32,
        stretch = 35,
        wobble = 50,
        leave = "hide",
        demo = true,
        onSelect,
        itemAriaLabels,
        style,
    } = props
    // Light theme swaps the dark defaults for their light pair; a colour someone picked stays as picked.
    const light = theme === "light"
    const background = themed(props.background, "#000000", light ? "#FFFFFF" : "transparent")
    const textColor = themed(props.textColor, "#F2F2F2", light ? "#141413" : "#E8E4DC")

    const propsRef = useRef<any>(props)
    propsRef.current = { ...props, background, textColor, strokeColor, items, active, size, gap, strokeWidth, speed, stretch, wobble, leave, demo, onSelect }

    const rootRef = useRef<HTMLDivElement>(null)
    const pathRef = useRef<SVGPathElement>(null)
    const rowRef = useRef<HTMLDivElement>(null)
    const hitRef = useRef<HTMLDivElement>(null)
    const labelRefs = useRef<(HTMLElement | null)[]>([])
    const [grainUrl, setGrainUrl] = useState("")

    const adv = { ...ADVANCED_DEFAULTS, ...(props.advanced ?? {}) }
    const glow = clamp(num(adv.glow, 0), 0, 100)
    const list = itemList(items)
    labelRefs.current.length = list.length

    useEffect(() => {
        if (adv.grain <= 0) return
        try {
            const c = document.createElement("canvas")
            c.width = c.height = 128
            const g = c.getContext("2d")
            if (!g) return
            const img = g.createImageData(128, 128)
            const d = img.data
            for (let i = 0; i < d.length; i += 4) {
                const v = Math.random() * 255
                d[i] = d[i + 1] = d[i + 2] = v
                d[i + 3] = 255
            }
            g.putImageData(img, 0, 0)
            setGrainUrl(c.toDataURL())
        } catch (e) {}
    }, [])

    useEffect(() => {
        const root = rootRef.current
        const path = pathRef.current
        const row = rowRef.current
        const hit = hitRef.current
        if (!root || !path || !row || !hit) return

        const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null

        const ptr = { x: 0, y: 0, inside: false, down: false }
        const updatePtr = (e: PointerEvent) => {
            const rr = root.getBoundingClientRect()
            ptr.x = e.clientX - rr.left
            ptr.y = e.clientY - rr.top
            ptr.inside = true
        }
        const onMove = (e: PointerEvent) => {
            updatePtr(e)
        }
        const onLeave = () => {
            ptr.inside = false
            ptr.down = false
        }
        let hovered = -1
        let chosen = -1
        const onDown = (e: PointerEvent) => {
            updatePtr(e)
            ptr.down = true
            if (hovered >= 0) {
                chosen = hovered
            }
        }
        const onUp = () => {
            ptr.down = false
        }
        row.addEventListener("pointermove", onMove)
        row.addEventListener("pointerenter", onMove)
        row.addEventListener("pointerleave", onLeave)
        row.addEventListener("pointerdown", onDown)
        window.addEventListener("pointerup", onUp)
        window.addEventListener("pointercancel", onUp)

        let chain: Chain | null = null
        let sig = ""
        let clock = 0
        let last = -1
        let raf = 0
        // Pause the loop while offscreen; resume when it scrolls back in.
        let visible = true
        const head = makeEnd()
        const tail = makeEnd()
        let target = -1
        let hidden = false
        let wasIn = false
        let prevAct = -1
        let demoDir = -1
        let nextDemo = -1
        let curMove = 850, curDraw = 650, curSkip = 30, curStretch = 0.35
        let over = 0, press = 0, leanX = 0, leanY = 0
        let lastCursor = ""
        let drawnChain: Chain | null = null
        let drawnLo = -1, drawnHi = -1
        let drawnPose = ""

        const setEnd = (e: End, u: number) => {
            e.fromU = u
            e.toU = u
            e.dur = 0
            e.v0 = 0
            e.t0 = clock
        }
        // retarget from wherever the end is now, carrying its velocity so the stroke never kinks
        const aim = (e: End, u: number, dur: number, delay: number) => {
            if (!chain) return
            const ch = chain
            const cur = endS(ch, e, clock)
            const v = (cur - endS(ch, e, clock - 8)) / 8
            e.fromU = sToU(ch, cur)
            e.toU = u
            e.dur = Math.max(0, dur)
            e.v0 = e.dur > 0 ? v : 0
            e.t0 = clock + (Math.abs(v) > 0.001 ? 0 : delay)
            if (e.dur <= 0) e.fromU = u
        }
        const go = (k: number) => {
            if (!chain) return
            if (hidden) {
                setEnd(tail, 2 * k)
                setEnd(head, 2 * k)
                aim(head, 2 * k + 1, curDraw, 0)
                hidden = false
                target = k
                return
            }
            if (k === target) return
            const steps = Math.max(1, Math.abs(k - target))
            const D = curMove * (1 + (curSkip / 100) * (steps - 1))
            const lag = D * curStretch
            const curU = sToU(chain, endS(chain, tail, clock))
            if (2 * k > curU) {
                aim(head, 2 * k + 1, D, 0)
                aim(tail, 2 * k, D, lag)
            } else {
                aim(tail, 2 * k, D, 0)
                aim(head, 2 * k + 1, D, lag)
            }
            target = k
        }
        const hide = () => {
            if (hidden) return
            hidden = true
            aim(tail, head.toU, curDraw, 0)
        }

        const frame = (t: number) => {
            if (!visible) {
                raf = 0
                return
            }
            raf = requestAnimationFrame(frame)
            const p = propsRef.current
            const a = { ...ADVANCED_DEFAULTS, ...(p.advanced ?? {}) }
            const dt = last < 0 ? 0 : Math.min((t - last) / 1000, 1 / 20)
            last = t
            const spd = clamp(num(p.speed, 50), 0, 100) / 50
            clock += dt * 1000 * spd
            const reduce = !!(mq && mq.matches)
            const hk = clamp(num(a.hover, 50), 0, 100) / 50

            const names = itemList(p.items)
            const n = names.length
            const rootRect = root.getBoundingClientRect()
            const boxes: Box[] = []
            for (let i = 0; i < n; i++) {
                const el = labelRefs.current[i]
                if (!el) break
                const er = el.getBoundingClientRect()
                boxes.push({
                    x: er.left - rootRect.left,
                    y: er.top - rootRect.top,
                    w: er.width,
                    h: er.height,
                })
            }
            if (boxes.length !== n || n === 0) return

            const f = Math.max(4, num(p.size, 24))
            const wob = clamp(num(p.wobble, 50), 0, 100) / 50
            const nextSig = JSON.stringify([
                boxes.map((b) => [Math.round(b.x * 2), Math.round(b.y * 2), Math.round(b.w * 2), Math.round(b.h * 2)]),
                f, wob, a.loopPadX, a.loopHeight, a.loopOffsetY, a.startAngle, a.sweep, a.spiral,
                a.leadIn, a.curl, a.topFlatten, a.bottomBulge, a.tilt, a.seed, a.detail, a.connectorSag,
            ])
            if (nextSig !== sig) {
                chain = buildChain(boxes, f, wob, a)
                sig = nextSig
            }
            const ch = chain as Chain

            curMove = reduce ? 0 : Math.max(0, num(a.moveMs, 850))
            curDraw = reduce ? 0 : Math.max(0, num(a.drawMs, 650))
            curSkip = Math.max(0, num(a.skipExtra, 30))
            curStretch = clamp(num(p.stretch, 35), 0, 100) / 100
            const demoFirst = Math.max(0, num(a.demoFirstMs, 1400))
            const demoEvery = Math.max(200, num(a.demoEveryMs, 2400))
            const demoHide = Math.max(0, num(a.demoHideMs, 900))

            const act = clamp(Math.round(num(p.active, 4)) - 1, 0, n - 1)
            if (target < 0 || target >= n) {
                target = act
                hidden = false
                setEnd(tail, 2 * act)
                setEnd(head, 2 * act + 1)
                demoDir = act > 0 ? -1 : 1
                nextDemo = clock + demoFirst
                prevAct = act
            }
            if (prevAct !== act) {
                prevAct = act
                if (!ptr.inside) {
                    chosen = -1
                    go(act)
                    demoDir = act > 0 ? -1 : 1
                    nextDemo = clock + demoEvery
                }
            }

            // which item is under the pointer
            hovered = -1
            if (ptr.inside) {
                const gp = Math.max(0, num(p.gap, 72))
                let best = Infinity
                ch.loops.forEach((L, i) => {
                    if (Math.abs(ptr.y - L.cy) > L.ry * 1.3) return
                    const dx = Math.abs(ptr.x - L.cx)
                    if (dx <= L.rx + gp / 2 && dx < best) {
                        best = dx
                        hovered = i
                    }
                })
            }
            const cursor = hovered >= 0 ? "pointer" : "default"
            if (cursor !== lastCursor) {
                hit.style.cursor = cursor
                lastCursor = cursor
            }
            if (hovered >= 0 && (hidden || hovered !== target)) go(hovered)

            if (ptr.inside) {
                wasIn = true
                nextDemo = clock + demoEvery
            } else if (wasIn) {
                wasIn = false
                if (p.leave === "return") go(chosen >= 0 ? clamp(chosen, 0, n - 1) : act)
                else if (p.leave === "hide") hide()
                nextDemo = clock + demoEvery
            }

            // demo: walk item by item toward one end, wipe the loop away, redraw it on the active item
            if (p.demo && !reduce && !ptr.inside && clock >= nextDemo) {
                if (hidden) {
                    demoDir = act > 0 ? -1 : 1
                    go(act)
                    nextDemo = clock + demoFirst
                } else {
                    const i = target + demoDir
                    if (n > 1 && i >= 0 && i < n) {
                        go(i)
                        nextDemo = clock + demoEvery
                    } else {
                        hide()
                        nextDemo = clock + curDraw + demoHide
                    }
                }
            }

            // pointer response: the stroke leans toward the pointer and squashes on press
            const kk = 1 - Math.exp(-dt * 8)
            over += ((ptr.inside ? 1 : 0) - over) * kk
            press += ((ptr.down ? 1 : 0) - press) * (1 - Math.exp(-dt * 14))
            const L = ch.loops[clamp(target, 0, n - 1)]
            const lp = Math.max(0, num(a.leanPx, 6)) * hk * over
            const tx = ptr.inside ? clamp((ptr.x - L.cx) / Math.max(1, L.rx * 2), -1, 1) * lp : 0
            const ty = ptr.inside ? clamp((ptr.y - L.cy) / Math.max(1, L.ry * 2), -1, 1) * lp * 0.6 : 0
            leanX += (tx - leanX) * kk
            leanY += (ty - leanY) * kk
            const sq = press * (clamp(num(a.pressSquash, 6), 0, 100) / 100) * hk

            const sT = endS(ch, tail, clock)
            const sH = endS(ch, head, clock)
            const lo = Math.min(sT, sH)
            const hi = Math.max(sT, sH)
            // The path is only rewritten when the stroke moved, so a resting loop paints nothing.
            if (ch !== drawnChain || lo !== drawnLo || hi !== drawnHi) {
                path.setAttribute("d", hi - lo > 0.5 ? tracePath(ch, lo, hi) : "")
                drawnChain = ch
                drawnLo = lo
                drawnHi = hi
            }
            const pose = sq > 0.0005
                ? `translate(${fix(leanX + L.cx)} ${fix(leanY + L.cy)}) scale(${(1 + sq * 0.5).toFixed(4)} ${(1 - sq).toFixed(4)}) translate(${fix(-L.cx)} ${fix(-L.cy)})`
                : `translate(${fix(leanX)} ${fix(leanY)})`
            if (pose !== drawnPose) {
                path.setAttribute("transform", pose)
                drawnPose = pose
            }
        }
        const io = typeof IntersectionObserver === "function"
            ? new IntersectionObserver(([e]) => {
                visible = e.isIntersecting
                if (visible && !raf) {
                    last = -1
                    raf = requestAnimationFrame(frame)
                }
            })
            : null
        io?.observe(root)
        raf = requestAnimationFrame(frame)

        return () => {
            cancelAnimationFrame(raf)
            io?.disconnect()
            row.removeEventListener("pointermove", onMove)
            row.removeEventListener("pointerenter", onMove)
            row.removeEventListener("pointerleave", onLeave)
            row.removeEventListener("pointerdown", onDown)
            window.removeEventListener("pointerup", onUp)
            window.removeEventListener("pointercancel", onUp)
        }
    }, [])

    const fontCss: React.CSSProperties = {}
    if (font && typeof font === "object") {
        if (font.fontFamily) fontCss.fontFamily = font.fontFamily
        if (font.fontWeight) fontCss.fontWeight = font.fontWeight
        if (font.fontStyle) fontCss.fontStyle = font.fontStyle
        if (font.letterSpacing !== undefined) fontCss.letterSpacing = font.letterSpacing
        if (font.lineHeight !== undefined) fontCss.lineHeight = font.lineHeight
    }

        const activeIndex = clamp(Math.round(num(active, 1)) - 1, 0, list.length - 1)

        return (
        <div
            ref={rootRef}
            data-testid={props["data-testid"] ?? "scribble-loop-nav"}
            style={{
                width: "100%",
                height: "100%",
                minHeight: 40,
                ...style,
                position: "relative",
                overflow: "visible",
                background,
                isolation: "isolate",
            }}
        >
            <div
                ref={rowRef}
                role="navigation"
                aria-label={props.ariaLabel ?? "Scene navigation"}
                style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexWrap: props.wrap ? "wrap" : "nowrap",
                    justifyContent: "center",
                    alignItems: "center",
                    gap,
                    rowGap: props.wrap ? 2 : undefined,
                    whiteSpace: "nowrap",
                    userSelect: "none",
                }}
            >
                {list.map((label, i) => {
                    const isActive = i === activeIndex
                    const a11yLabel = Array.isArray(itemAriaLabels) && itemAriaLabels[i] ? itemAriaLabels[i] : label
                    return (
                        <button
                            key={i}
                            type="button"
                            ref={(el) => {
                                labelRefs.current[i] = el
                            }}
                            aria-label={a11yLabel}
                            aria-current={isActive ? "step" : undefined}
                            onClick={() => onSelect?.(i)}
                            onMouseEnter={() => {
                                // Hint loop target smoothly when focusing/hovering actual accessible button
                            }}
                            style={{
                                position: "relative",
                                zIndex: 2,
                                display: "inline-flex",
                                alignItems: "center",
                                background: "transparent",
                                border: 0,
                                padding: "4px 6px",
                                cursor: "pointer",
                                fontFamily: '"Inter Tight", ui-sans-serif, system-ui, -apple-system, sans-serif',
                                fontWeight: 500,
                                letterSpacing: "0.14em",
                                lineHeight: 1.2,
                                ...fontCss,
                                fontSize: size,
                                color: isActive ? "#F2F0EA" : textColor,
                                opacity: isActive ? 1 : clamp(adv.textOpacity, 0, 100) / 100,
                                transition: "color 180ms ease, opacity 180ms ease",
                            }}
                        >
                            {label}
                        </button>
                    )
                })}
            </div>
            {/*
              * Vector, not a canvas: the browser rasterises it at the size it is really shown,
              * in the same pass as the labels. A canvas bitmap goes soft the moment a stage,
              * page or Framer zoom scales it, and the labels beside it stay sharp.
              */}
            <svg
                aria-hidden
                style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    overflow: "visible",
                    display: "block",
                    pointerEvents: "none",
                    filter: glow > 0 ? `drop-shadow(0 0 ${glow * 0.15}px ${strokeColor})` : undefined,
                }}
            >
                <path
                    ref={pathRef}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                        stroke: strokeColor,
                        strokeWidth: Math.max(0.5, num(strokeWidth, 3)),
                        strokeOpacity: clamp(num(adv.strokeOpacity, 100), 0, 100) / 100,
                    }}
                />
            </svg>
            {adv.grain > 0 && grainUrl ? (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `url(${grainUrl})`,
                        backgroundSize: "128px 128px",
                        opacity: (clamp(adv.grain, 0, 100) / 100) * 0.35,
                        mixBlendMode: "overlay",
                        pointerEvents: "none",
                    }}
                />
            ) : null}
            {adv.vignette > 0 ? (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${clamp(adv.vignette, 0, 100) / 100}) 100%)`,
                        pointerEvents: "none",
                    }}
                />
            ) : null}
            {/*
              * Hit layer remains behind interactive buttons (pointerEvents: none when buttons handle clicks,
              * wait — track hover across whole strip using pointermove on root/row and hitRef pointer-events none
              * so real <button> clicks & keyboard focus always fire natively!).
              */}
            <div ref={hitRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
        </div>
    )
}

// Control order arranged in the builder.
