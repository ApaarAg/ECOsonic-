/* eslint-disable */
// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

// Delivered by Originkit · stack: framer
// Paste into a Framer code component. Property controls included.
import * as React from "react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
/**
 * Carousel: photo cards on a turntable that drift at rest, give under the
 * pointer, and can be swiped round. Nothing ever leaves the frame: the cards
 * go round, out to one side, back and small, round to the other side and
 * forward again, so there is no edge to treat and no box to clip them. It is
 * therefore endless; the swipe never runs out and never rubber-bands.
 *
 * The ring position is not taken modulo anything: wrapping it would send a
 * card the long way round as it crossed the seam. Three motions, three nested
 * elements, one transform each: the slot carries the place on the ring (the
 * drag), the floater the drift (a CSS animation), the card the press (a pair
 * of springs). A flick looks ahead of the release, and can carry two cards.
 * Arrow keys step when it has focus.
 *
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight fixed
 * @framerIntrinsicWidth 480
 * @framerIntrinsicHeight 320
 */

export interface CarouselCardItem {
    id?: string
    image: string
    /** Which band of the photo's crop shows: −250 shows its bottom, 250 its top, 0 the centre. */
    offsetY?: number
    /** CSS object-position focal anchor (e.g. "50% 24%"). */
    focalPosition?: string
    alt?: string
    plateLabel?: string
    commonName?: string
    scientificName?: string
    statusText?: "DETECTED" | "NOT DETECTED"
    statusVariant?: "detected" | "not_detected" | "unexpected_detected"
    statusMeta?: string
    isHabitatFallback?: boolean
}

export type Shot = CarouselCardItem

export interface CarouselProps {
    items: CarouselCardItem[]
    start?: number
    /** Card size in stage px at the reference frame; scales with the frame like everything else. */
    cardWidth?: number
    cardHeight?: number
    /** Space between neighbouring cards at the front, in stage px. 0 is the designed ring. */
    gap?: number
    depth?: number
    corner?: number
    sink?: number
    /** Float (idle drift), Spin (seconds per self-turn, 0 off) and Settle (snap speed after a swipe). */
    motion?: Partial<typeof DEFAULT_MOTION>
    background?: string
    sound?: boolean
    soundVolume?: number
    reducedMotion?: boolean
    jumpNonce?: number
    onChange?: (index: number) => void
    onInspect?: (index: number) => void
    style?: React.CSSProperties
}

const FALLBACK_SPECIMEN_IMAGE = "/assets/canonical/rainforest_branch_overcast.jpg"

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/* The card is near the photographs' own 2:3, so `cover` trims only a little. */
const CARD_W = 206
const CARD_H = 292
/* Ring radius in stage px at Gap 0: the designed spacing. Gap widens or tucks it. */
const SPREAD = 138
const DEFAULT_MOTION = { float: 15, spin: 0, settle: 50 }
/* The stage is sized for the shipping ring plus a small margin, and scaled to
   the frame. Air inside the box is the block drawn smaller, so it is not sized
   for the knobs' extremes; at those the ring paints a little past it. */
const STAGE_W = 476
const STAGE_H = 340
const DEPTH_MAX = 150
/* A card at the back rides up as well as shrinking: a ring seen from slightly
   above, which is most of what makes the depth read. */
const LEAN = 38
/* px of drag to turn the ring one position */
const PULL = 140
/* how far ahead of the release a throw looks, in ms, and how many cards it may skip */
const TOSS = 150
const MOST = 2
const BASE = 620

/* Every card at its own angle, no pattern to spot; and the drift periods are
   deliberately awkward so no two cards ever move together. */
const ANGLE = [-4.2, 2.6, -1.4, 3.8, 1.7, -2.9, 0.9, -3.4]
const PERIOD = [4.7, 5.9, 6.7, 5.3, 7.1, 6.1, 5.6, 6.4]

/* How long it takes, as a multiplier on the tuned duration: 50 is exactly 1. */
const rate = (speed: number) => 1.6 - (speed / 100) * 1.2
const out = (t: number) => 1 - (1 - t) ** 4

type Spot = { x: number; y: number; s: number; z: number }

/* Where a card sits, given where the ring is. One function, read by the first
   paint and by the drag both. `f` is 1 at the front and 0 at the back, and it
   drives size, lean and paint order together. Everything is 2D, so paint
   order is a z-index by hand. No opacity: dimming with distance made the
   whole block pulse on a gesture that should only move things round. */
const spotOf = (i: number, n: number, turn: number, orbit: number, depth: number): Spot => {
    if (n <= 1) {
        return { x: 0, y: 0, s: 1, z: 100 }
    }
    const th = (i - turn) * ((Math.PI * 2) / n)
    const f = (Math.cos(th) + 1) / 2
    const x = n === 2 ? (1 - f) * (i === 0 ? -orbit * 0.72 : orbit * 0.72) : Math.sin(th) * orbit
    return {
        x,
        y: -(1 - f) * LEAN,
        s: mix(1 - clamp(depth, 0, DEPTH_MAX) / 200, 1, f),
        z: Math.round(f * 100),
    }
}

// `k` is screen px per stage px: the ring is laid out at the size it is shown (see `fit` below).
const write = (el: HTMLElement, sp: Spot, angle: number, k: number) => {
    el.style.transform = `translate(-50%, -50%) translate(${(sp.x * k).toFixed(2)}px, ${(sp.y * k).toFixed(2)}px) rotate(${angle}deg) scale(${sp.s.toFixed(4)})`
    el.style.zIndex = String(sp.z)
}

/** Y Offset −250…250 as the photo's vertical position, a share of its crop (0 = top, 1 = bottom). */
const offsetShare = (v: unknown) => {
    const o = clamp(typeof v === "number" && Number.isFinite(v) ? v : 0, -250, 250)
    return 0.5 - (o / 250) * 0.5
}

/* The resting shadow lives here, not inline on the card: an inline shadow outranked the focus rule,
   so the keyboard focus ring never showed.
   No will-change on the slot: it froze the card bitmaps at the size first drawn, softening them. */
const css = `
.car-track { position: absolute; inset: 0; outline: none; cursor: grab; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.car-track[data-held="true"] { cursor: grabbing; }
.car-track:focus-visible .car-slot[data-front="true"] .car-card { box-shadow: 0 0 0 1px rgba(216, 212, 200, 0.72), 0 0 0 3px rgba(200, 155, 98, 0.24), var(--car-sh); }
.car-slot { position: absolute; left: 50%; top: 50%; }
.car-float { width: 100%; height: 100%; animation: car-drift 6s ease-in-out infinite; }
.car-slot[data-front="true"] .car-float { animation: none; }
.car-track[data-reduced="true"] .car-float { animation: none; }
.car-card { position: relative; width: 100%; height: 100%; overflow: hidden; background-color: #050606; border: 1px solid rgba(216, 212, 200, 0.16); box-shadow: var(--car-sh); transition: border-color 300ms cubic-bezier(0.22, 1, 0.36, 1), filter 300ms cubic-bezier(0.22, 1, 0.36, 1); }
.car-slot[data-front="true"] .car-card { border-color: rgba(216, 212, 200, 0.34); filter: brightness(1) saturate(1); }
.car-slot[data-front="false"] .car-card { border-color: rgba(216, 212, 200, 0.13); filter: brightness(0.68) contrast(0.95) saturate(0.72); }
.car-card-img { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; transition: filter 340ms cubic-bezier(0.22, 1, 0.36, 1), opacity 340ms cubic-bezier(0.22, 1, 0.36, 1); }
.car-idle-chrome { transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1); }
.car-idle-footer { transition: opacity 200ms cubic-bezier(0.22, 1, 0.36, 1); }
.car-reveal-layer { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; padding: 11px 13px; opacity: 0; pointer-events: none; background: linear-gradient(180deg, rgba(4, 5, 5, 0.72) 0%, rgba(4, 5, 5, 0.16) 40%, rgba(3, 4, 4, 0.92) 100%); transition: opacity 260ms cubic-bezier(0.22, 1, 0.36, 1); }
.car-card:focus-within .car-reveal-layer,
.car-card[data-revealed="true"] .car-reveal-layer { opacity: 1; }
.car-card:focus-within .car-idle-footer,
.car-card[data-revealed="true"] .car-idle-footer { opacity: 0; }
.car-card:focus-within .car-reveal-actions,
.car-card[data-revealed="true"] .car-reveal-actions { pointer-events: auto; }
.car-slot[data-front="true"] .car-card[data-status-variant="not_detected"]:focus-within .car-card-img,
.car-slot[data-front="true"] .car-card[data-status-variant="not_detected"][data-revealed="true"] .car-card-img { filter: brightness(0.56) saturate(0.45); }
.car-slot[data-front="true"] .car-card[data-status-variant="detected"]:focus-within .car-card-img,
.car-slot[data-front="true"] .car-card[data-status-variant="detected"][data-revealed="true"] .car-card-img,
.car-slot[data-front="true"] .car-card[data-status-variant="unexpected_detected"]:focus-within .car-card-img,
.car-slot[data-front="true"] .car-card[data-status-variant="unexpected_detected"][data-revealed="true"] .car-card-img { filter: brightness(0.78) saturate(0.95); }
@media (hover: hover) and (pointer: fine) {
  .car-card:hover .car-reveal-layer { opacity: 1; }
  .car-card:hover .car-idle-footer { opacity: 0; }
  .car-card:hover .car-reveal-actions { pointer-events: auto; }
  .car-slot[data-front="true"] .car-card[data-status-variant="not_detected"]:hover .car-card-img { filter: brightness(0.56) saturate(0.45); }
  .car-slot[data-front="true"] .car-card[data-status-variant="detected"]:hover .car-card-img,
  .car-slot[data-front="true"] .car-card[data-status-variant="unexpected_detected"]:hover .car-card-img { filter: brightness(0.78) saturate(0.95); }
}
.car-sheen { position: absolute; inset: 0; pointer-events: none; }
@keyframes car-drift {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(calc(-1 * var(--lift))) rotate(var(--sway)); }
}
@media (prefers-reduced-motion: reduce) { .car-float { animation: none; } .car-card, .car-card-img, .car-idle-footer, .car-reveal-layer { transition-duration: 100ms; } }
`

/* ---- Spring --------------------------------------------------------------
 * 0..100 into stiffness and per-frame decay, chosen by damping ratio. Frames,
 * not milliseconds: damping is raised to dt. The loop parks once settled. */
const springOf = (tune: number) => ({ k: 0.08 + (tune / 100) * 0.16, d: 0.62 + (tune / 100) * 0.2 })

function useSpring(target: number, tune = 50, instant = false) {
    const [at, setAt] = useState(target)
    const cur = useRef(target)
    const vel = useRef(0)
    const raf = useRef(0)

    useEffect(() => {
        if (instant) {
            cur.current = target
            vel.current = 0
            setAt(target)
            return
        }
        const { k, d } = springOf(tune)
        let prev = 0
        const tick = (t: number) => {
            const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1
            prev = t
            vel.current += (target - cur.current) * k * dt
            vel.current *= Math.pow(d, dt)
            cur.current += vel.current * dt
            if (Math.abs(target - cur.current) < 0.002 && Math.abs(vel.current) < 0.002) {
                cur.current = target
                vel.current = 0
                setAt(target)
                raf.current = 0
                return
            }
            setAt(cur.current)
            raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
        return () => {
            cancelAnimationFrame(raf.current)
            raf.current = 0
        }
    }, [target, tune, instant])

    return at
}

/* ---- Sound ---------------------------------------------------------------
 * Tiny synthesized cue, no files and no network. Silent unless the `sound`
 * prop is on, and only from a gesture: a soft tick each time a new card
 * reaches the front, never from the self-spinning ring. */
let tickAt = 0

function playTick(volume = 0.5, pitch = 1) {
    if (typeof window === "undefined" || volume <= 0) return
    const stamp = Date.now()
    if (stamp - tickAt < 45) return
    tickAt = stamp
    try {
        const w = window as any
        const AC = w.AudioContext || w.webkitAudioContext
        if (!AC) return
        const ctx: AudioContext = (w.__okAudio = w.__okAudio || new AC())
        if (ctx.state === "suspended") ctx.resume()
        const t0 = ctx.currentTime
        const out = ctx.createGain()
        out.gain.value = Math.min(1, volume) * 0.4
        out.connect(ctx.destination)
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = "triangle"
        o.frequency.setValueAtTime(1900 * pitch, t0)
        o.frequency.exponentialRampToValueAtTime(1500 * pitch, t0 + 0.04)
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.006)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04)
        o.connect(g)
        g.connect(out)
        o.start(t0)
        o.stop(t0 + 0.06)
    } catch {
        /* audio blocked or unsupported: stay silent */
    }
}

export default function Carousel(props: CarouselProps) {
    const {
        items = [],
        start = 0,
        cardWidth = 224,
        cardHeight = 312,
        gap = 0,
        depth = 42,
        corner = 3,
        sink = 14,
        motion,
        background = "transparent",
        sound = false,
        soundVolume = 0,
        reducedMotion: reducedMotionProp,
        jumpNonce = 0,
        onChange,
        onInspect,
        style,
    } = props
    const { float, spin, settle } = { ...DEFAULT_MOTION, ...motion }
    const list = items ?? []
    const n = list.length
    const opensOn = clamp(Math.round(start) - 1, 0, Math.max(0, n - 1))
    const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
    const cw = clamp(num(cardWidth, CARD_W), 60, 480)
    const ch = clamp(num(cardHeight, CARD_H), 60, 600)
    /* Gap moves each front neighbour out by exactly that many stage px: the ring widens by gap over
       sin of one step's angle (a neighbour sits at sin(step) × radius). The guard keeps two photos,
       where the neighbour is straight behind, from dividing by nothing. */
    const gapPx = clamp(num(gap, 0), -100, 200)
    const orbit = Math.max(0, SPREAD + (n > 1 ? gapPx / Math.max(0.35, Math.abs(Math.sin((Math.PI * 2) / n))) : 0))

    const root = useRef<HTMLDivElement | null>(null)
    const [frame, setFrame] = useState({ w: 480, h: 320 })
    const [systemReducedMotion, setSystemReducedMotion] = useState(false)
    useEffect(() => {
        const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)")
        setSystemReducedMotion(!!mq?.matches)
        const onMqChange = (ev: MediaQueryListEvent) => setSystemReducedMotion(ev.matches)
        mq?.addEventListener?.("change", onMqChange)
        const el = root.current
        if (!el) return () => mq?.removeEventListener?.("change", onMqChange)
        const ro = new ResizeObserver(() => el.clientWidth && el.clientHeight && setFrame({ w: el.clientWidth, h: el.clientHeight }))
        ro.observe(el)
        return () => {
            mq?.removeEventListener?.("change", onMqChange)
            ro.disconnect()
        }
    }, [])
    const still = Boolean(reducedMotionProp) || systemReducedMotion
    const scale = Math.min(frame.w / STAGE_W, frame.h / STAGE_H)
    /* Screen px per stage px. The ring is laid out at the size it is shown, every length times fit,
       rather than laid out at stage size and scaled by a transform: a scaled-up box is drawn small
       and magnified (×1.9 in the builder), which softened the photos, and more so with bigger cards. */
    const fit = Math.max(0.1, scale)

    const slots = useRef<(HTMLDivElement | null)[]>([])
    /* Where the ring is, in card steps, as a ref: it changes every frame of a
       drag. Not clamped and not wrapped; that is the number a modulo would ruin. */
    const turn = useRef(opensOn)
    const raf = useRef(0)
    const drag = useRef<{ x0: number; t0: number; last: number; t: number; vx: number; k: number; far: number; hit: number } | null>(null)
    const [held, setHeld] = useState(false)
    const [front, setFront] = useState(opensOn)
    const [revealedIndex, setRevealedIndex] = useState<number | null>(null)
    const lastUpTapAtRef = useRef(0)
    const frontRef = useRef(opensOn)
    const live = useRef({ sound, soundVolume, onChange })
    live.current = { sound, soundVolume, onChange }

    const wrapIndex = (t: number) => (n <= 0 ? 0 : ((Math.round(t) % n) + n) % n)

    const paint = useCallback(
        (byHand = false) => {
            if (n <= 0) return
            slots.current.forEach((el, i) => el && write(el, spotOf(i, n, turn.current, orbit, depth), ANGLE[i % ANGLE.length], fit))
            const f = wrapIndex(turn.current)
            if (f !== frontRef.current) {
                frontRef.current = f
                setFront(f)
                setRevealedIndex(null)
                if (byHand) {
                    const { sound: on, soundVolume: vol, onChange: cb } = live.current
                    if (on) playTick(vol, 0.9 + (f / Math.max(1, n - 1)) * 0.3)
                    cb?.(f)
                }
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [orbit, depth, n, fit]
    )

    // Placed on mount, and again whenever a knob changes the arithmetic under it.
    useLayoutEffect(() => paint(), [paint])
    useEffect(() => () => cancelAnimationFrame(raf.current), [])

    /* Opens on is live: changing it, or the number of photos, sets the ring
       back on that card, cutting short any settle. Not on a knob that only
       moves the cards, so a Gap change doesn't undo a swipe. */
    useLayoutEffect(() => {
        cancelAnimationFrame(raf.current)
        turn.current = opensOn
        frontRef.current = opensOn
        setFront(opensOn)
        setRevealedIndex(null)
        paint()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opensOn, n, jumpNonce])

    /* The ring turning itself, on its own handle so it never cancels a settle.
       It advances by time rather than stepping, so it reads as a continuous
       ring. Held pauses it. */
    useEffect(() => {
        if (!spin || still || held) return
        let id = 0
        let prev = 0
        const step = (t: number) => {
            if (prev) turn.current += ((t - prev) / 1000) * (n / spin)
            prev = t
            paint()
            id = requestAnimationFrame(step)
        }
        id = requestAnimationFrame(step)
        return () => cancelAnimationFrame(id)
    }, [spin, still, held, paint, n])

    /* The settle: quart-out from wherever the ring is now to a whole position,
       so a second swipe during one turns it further instead of snapping back. */
    const glide = (to: number) => {
        cancelAnimationFrame(raf.current)
        const from = turn.current
        if (still || from === to) {
            turn.current = to
            paint(true)
            return
        }
        const ms = BASE * rate(clamp(settle, 0, 100))
        const t0 = performance.now()
        const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / ms)
            turn.current = mix(from, to, out(p))
            paint(true)
            if (p < 1) raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
    }

    const down = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return
        if ((e.target as HTMLElement | null)?.closest?.("[data-card-action]")) return
        cancelAnimationFrame(raf.current)
        // Screen px per stage px, so PULL means the same at any scale.
        const r = root.current
        const outer = r && r.clientWidth ? r.getBoundingClientRect().width / r.clientWidth : 1
        // The card pressed, read before capture retargets the pointer to the track.
        const slot = (e.target as HTMLElement | null)?.closest?.(".car-slot")
        const hit = slot ? slots.current.indexOf(slot as HTMLDivElement) : -1
        drag.current = { x0: e.clientX, t0: turn.current, last: e.clientX, t: e.timeStamp, vx: 0, k: (scale || 1) * outer, far: 0, hit }
        setHeld(true)
        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
            /* not a live pointer */
        }
    }

    const move = (e: React.PointerEvent) => {
        const g = drag.current
        if (!g) return
        const dx = (e.clientX - g.x0) / g.k
        g.far = Math.max(g.far, Math.abs(e.clientX - g.x0))
        if (g.far >= 5) {
            setRevealedIndex(null)
        }
        // Speed from the last position, smoothed so one jittery frame can't fake a flick.
        const dt = Math.max(1, e.timeStamp - g.t)
        g.vx = (g.vx + (e.clientX - g.last) / g.k / dt) / 2
        g.last = e.clientX
        g.t = e.timeStamp
        // No rubber band, because there is no end.
        turn.current = g.t0 - dx / PULL
        paint(true)
    }

    const up = () => {
        const g = drag.current
        if (!g) return
        drag.current = null
        setHeld(false)
        // A click on a card that isn't in front turns the ring the short way round to it.
        if (g.far < 5 && n > 0) {
            const at = Math.round(turn.current)
            const currentFront = wrapIndex(at)
            let d = g.hit < 0 ? 0 : (((g.hit - currentFront) % n) + n) % n
            if (d > n / 2) d -= n
            if (d === 0 && g.hit >= 0) {
                lastUpTapAtRef.current = performance.now()
                setRevealedIndex((prev) => (prev === currentFront ? null : currentFront))
                return
            }
            setRevealedIndex(null)
            glide(at + d)
            return
        }
        // Where it would rest if it kept going, capped so a hard flick stays followable.
        const carry = clamp((-g.vx * TOSS) / PULL, -MOST, MOST)
        glide(Math.round(turn.current + carry))
    }

    const key = (e: React.KeyboardEvent) => {
        if (n <= 0) return
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
        if (!d) return
        e.preventDefault()
        setRevealedIndex(null)
        glide(Math.round(turn.current) + d)
    }

    const r = clamp(corner, 0, 40) * fit
    const lift = ((clamp(float, 0, 100) / 100) * 16 * fit).toFixed(2)
    const sway = ((clamp(float, 0, 100) / 100) * 1.4).toFixed(2)
    const cardW = cw * fit
    const cardH = ch * fit
    // Bigger cards or a wider gap may outgrow the frame; they are then let past its edge, not cut off.
    const spills = cw > CARD_W || ch > CARD_H || gapPx > 0

    if (n === 0) {
        return <div ref={root} style={{ position: "relative", width: "100%", height: "100%", ...style, background }} />
    }

    // Focus ring follows ECOsonic archival parchment + ochre tones rather than bright SaaS white.
    return (
        <div
            ref={root}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                ...style,
                overflow: spills ? "visible" : "hidden",
                background,
                // Deep obsidian shadow anchored directly beneath the card stack.
                ["--car-sh" as string]: `0 ${(14 * fit).toFixed(2)}px ${(30 * fit).toFixed(2)}px ${(-8 * fit).toFixed(2)}px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(216, 212, 200, 0.08)`,
            }}
        >
            <style>{css}</style>
            <div
                style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: STAGE_W * fit,
                    height: STAGE_H * fit,
                    marginLeft: (-STAGE_W * fit) / 2,
                    marginTop: (-STAGE_H * fit) / 2,
                }}
            >
                <div
                    className="car-track"
                    data-held={held}
                    data-reduced={still}
                    role="group"
                    aria-label={`Observation gap species stack, ${front + 1} of ${n}`}
                    aria-roledescription="carousel"
                    tabIndex={0}
                    onKeyDown={key}
                    onPointerDown={down}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={up}
                >
                    {list.map((shot, i) => (
                        <div
                            key={shot.id ?? `${shot.plateLabel ?? "card"}-${i}`}
                            ref={(el) => {
                                slots.current[i] = el
                            }}
                            className="car-slot"
                            data-front={front === i}
                            aria-hidden={front !== i}
                            style={{ width: cardW, height: cardH }}
                        >
                            <div
                                className="car-float"
                                style={
                                    {
                                        perspective: `${800 * fit}px`,
                                        // At Float 0 or reduced motion, drift keyframes come off cleanly.
                                        animationName: float <= 0 || still ? "none" : undefined,
                                        animationDuration: `${PERIOD[i % PERIOD.length]}s`,
                                        "--lift": `${lift}px`,
                                        "--sway": `${sway}deg`,
                                    } as React.CSSProperties
                                }
                            >
                                {/* A card under a finger turning the ring is being carried, not pressed. */}
                                <Card
                                    item={shot}
                                    index={i}
                                    isFront={front === i}
                                    isRevealed={revealedIndex === i}
                                    corner={r}
                                    sink={sink}
                                    k={fit}
                                    off={held || still}
                                    still={still}
                                    onToggleReveal={() => {
                                        if (performance.now() - lastUpTapAtRef.current < 400) return
                                        if (front !== i) {
                                            setRevealedIndex(null)
                                            const at = Math.round(turn.current)
                                            let d = (((i - wrapIndex(at)) % n) + n) % n
                                            if (d > n / 2) d -= n
                                            glide(at + d)
                                            return
                                        }
                                        setRevealedIndex((prev) => (prev === i ? null : i))
                                    }}
                                    onInspect={onInspect}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

/* One card, and the press is its own: the tilt is a pair of springs, and a
   hook can't be called n times from the parent. At rest it costs nothing. */
function Card(props: {
    item: CarouselCardItem
    index: number
    isFront: boolean
    isRevealed: boolean
    corner: number
    sink: number
    k: number
    off: boolean
    still: boolean
    onToggleReveal: () => void
    onInspect?: (index: number) => void
}) {
    const { item, index, isFront, isRevealed, corner, sink, k, off, still, onToggleReveal, onInspect } = props
    const skin = useRef<HTMLDivElement | null>(null)
    const [pt, setPt] = useState({ x: 0, y: 0 })
    const [on, setOn] = useState(false)
    const [imgSrc, setImgSrc] = useState(item.image || FALLBACK_SPECIMEN_IMAGE)

    useEffect(() => {
        setImgSrc(item.image || FALLBACK_SPECIMEN_IMAGE)
    }, [item.image])

    // One sprung pointer position; the tilt and both gradients are readings of it.
    const live = on && !off && isFront
    const sx = useSpring(live ? pt.x : 0, 50, still)
    const sy = useSpring(live ? pt.y : 0, 50, still)
    const lit = useSpring(live ? 1 : 0, 50, still)

    const deep = clamp(sink, 0, 100) / 100
    const max = deep * 10
    // It sinks, it does not lift: the point you are over goes away.
    const rx = -sy * max
    const ry = sx * max
    const px = ((sx + 1) / 2) * 100
    const py = ((sy + 1) / 2) * 100
    const dark = deep * 0.42 * lit
    // Subtle parchment edge sheen calibrated for dark obsidian plates.
    const rim = deep * 0.1 * lit

    const track = (e: React.PointerEvent) => {
        const el = skin.current
        if (!el) return
        const b = el.getBoundingClientRect()
        setPt({
            x: clamp(((e.clientX - b.left) / b.width) * 2 - 1, -1, 1),
            y: clamp(((e.clientY - b.top) / b.height) * 2 - 1, -1, 1),
        })
        setOn(true)
    }

    const objectPosition = item.focalPosition ?? `50% ${(offsetShare(item.offsetY) * 100).toFixed(2)}%`
    const isDetected = item.statusText === "DETECTED"
    const isUnexpected = item.statusVariant === "unexpected_detected"
    const statusDotColor = isDetected ? "#6E8272" : "#C89B62"
    const statusBorder = isDetected ? "rgba(110, 130, 114, 0.56)" : "rgba(200, 155, 98, 0.52)"
    const statusBg = isDetected ? "rgba(8, 15, 11, 0.86)" : "rgba(12, 9, 7, 0.88)"
    const statusTextColor = isDetected ? "#B5CDB9" : "#DFBE8F"

    return (
        <div
            ref={skin}
            className="car-card"
            data-card-index={index}
            data-revealed={isRevealed ? "true" : "false"}
            data-status-variant={item.statusVariant ?? "not_detected"}
            onPointerMove={track}
            // `out` with a containment test, so a scripted pointer leaving with no relatedTarget still releases it.
            onPointerOut={(e) => {
                const el = skin.current
                const to = e.relatedTarget as Node | null
                if (!el || !to || !el.contains(to)) setOn(false)
            }}
            onPointerCancel={() => setOn(false)}
            style={{
                borderRadius: corner,
                transform: `translateZ(${(-8 * deep * lit * k).toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`,
            }}
        >
            <img
                src={imgSrc}
                alt={item.alt ?? item.commonName ?? "Archival bird specimen"}
                draggable={false}
                className="car-card-img"
                style={{ objectPosition }}
                onError={() => {
                    if (imgSrc !== FALLBACK_SPECIMEN_IMAGE) {
                        setImgSrc(FALLBACK_SPECIMEN_IMAGE)
                    }
                }}
            />

            {/* Subtle archival corner registration ticks */}
            <div className="pointer-events-none absolute inset-1.5" aria-hidden="true">
                <span className="absolute left-0 top-0 h-1.5 w-1.5 border-l border-t border-[#D8D4C8]/30" />
                <span className="absolute right-0 top-0 h-1.5 w-1.5 border-r border-t border-[#D8D4C8]/30" />
                <span className="absolute bottom-0 left-0 h-1.5 w-1.5 border-b border-l border-[#D8D4C8]/30" />
                <span className="absolute bottom-0 right-0 h-1.5 w-1.5 border-b border-r border-[#D8D4C8]/30" />
            </div>

            {/* Restrained idle scrim & minimal archival identification (zero clutter on idle) */}
            <div
                className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2.5 sm:p-3.5"
                style={{
                    background:
                        "linear-gradient(180deg, rgba(4, 5, 5, 0.34) 0%, rgba(4, 5, 5, 0.0) 36%, rgba(4, 5, 5, 0.35) 70%, rgba(4, 5, 5, 0.86) 100%)",
                }}
            >
                <div className="flex items-center justify-between gap-2">
                    {item.plateLabel && (
                        <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-[0.22em] text-[#D8D4C8]/65">
                            {item.plateLabel}
                        </span>
                    )}
                    {item.isHabitatFallback && (
                        <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#C89B62]/80">
                            REF PLATE
                        </span>
                    )}
                </div>

                <div className="car-idle-footer min-w-0">
                    {item.commonName && (
                        <p className="truncate font-serif text-[13px] sm:text-[16px] leading-tight tracking-tight text-[#D8D4C8]">
                            {item.commonName}
                        </p>
                    )}
                    {item.scientificName && (
                        <p className="mt-0.5 truncate font-serif text-[10px] sm:text-[11px] italic text-[#D8D4C8]/60">
                            {item.scientificName}
                        </p>
                    )}
                </div>
            </div>

            {/* Full-card accessible tap / focus trigger */}
            <button
                type="button"
                data-card-trigger={index}
                tabIndex={isFront ? 0 : -1}
                aria-pressed={isRevealed}
                aria-label={`${item.commonName ?? "Specimen"}${item.scientificName ? ` (${item.scientificName})` : ""}${item.statusText ? `, status ${item.statusText}` : ""}`}
                onClick={onToggleReveal}
                className="absolute inset-0 z-10 cursor-pointer border-0 bg-transparent p-0 focus:outline-none"
            />

            {/* Hover / Focus / Mobile Tap Status Reveal Layer */}
            {item.statusText && (
                <div className="car-reveal-layer z-20" data-testid={`gap-card-reveal-${index}`}>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {isUnexpected && (
                            <span className="rounded-[2px] border border-[#D8D4C8]/20 bg-[#050606]/80 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.16em] text-[#D8D4C8]/75">
                                OUTSIDE BASELINE
                            </span>
                        )}
                        <span
                            className="inline-flex items-center gap-1.5 rounded-[2px] px-2 py-1 font-mono text-[9px] sm:text-[10px] font-medium uppercase tracking-[0.18em]"
                            style={{
                                border: `1px solid ${statusBorder}`,
                                backgroundColor: statusBg,
                                color: statusTextColor,
                            }}
                        >
                            <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: statusDotColor }}
                                aria-hidden="true"
                            />
                            {item.statusText}
                        </span>
                    </div>

                    <div className="space-y-1.5">
                        {item.commonName && (
                            <p className="truncate font-serif text-[13px] sm:text-[15px] leading-tight text-[#D8D4C8]">
                                {item.commonName}
                            </p>
                        )}
                        {item.statusMeta && (
                            <p className="line-clamp-2 font-mono text-[9px] sm:text-[10px] leading-snug tracking-[0.06em] text-[#D8D4C8]/82">
                                {item.statusMeta}
                            </p>
                        )}
                        {onInspect && (
                            <div className="car-reveal-actions pt-0.5">
                                <button
                                    type="button"
                                    data-card-action="inspect"
                                    tabIndex={isFront ? 0 : -1}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onInspect(index)
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#D8D4C8]/30 bg-[#080909]/90 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#D8D4C8] transition-colors hover:border-[#6E8272]/60 hover:text-white focus:outline-none focus-visible:border-[#C89B62]"
                                >
                                    Inspect Record
                                    <span aria-hidden="true">→</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <span
                className="car-sheen"
                aria-hidden="true"
                style={{
                    borderRadius: corner,
                    backgroundImage: `radial-gradient(44% 36% at ${px.toFixed(1)}% ${py.toFixed(1)}%, rgba(4, 5, 5, ${dark.toFixed(3)}) 0%, rgba(4, 5, 5, 0) 100%), radial-gradient(54% 44% at ${(100 - px).toFixed(1)}% ${(100 - py).toFixed(1)}%, rgba(216, 212, 200, ${rim.toFixed(3)}) 0%, rgba(216, 212, 200, 0) 100%)`,
                }}
            />
        </div>
    )
}
