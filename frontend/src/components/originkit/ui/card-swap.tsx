/* eslint-disable */
// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

// Delivered by Originkit · stack: framer
// Paste into a Framer code component. Property controls included.
import * as React from "react"
import { useEffect, useRef, useState } from "react"
/**
 * Card Swap: a stack of photo cards in depth, each a step further back and up
 * to the right, slanted. Press the front card and it flies off toward the side
 * you pressed, or drag and fling it and it flies on the way you threw;
 * then it tucks in at the back while the rest step forward. With Auto on it also
 * swaps by itself every few seconds, pausing while a pointer is on the stack.
 * Enter, Space or the right arrow swap from the keyboard.
 *
 * A card is its slot: the order is the only state, and a slot is a fixed
 * transform, so moving a card means changing its slot and letting the CSS
 * transition carry it. The card sent back takes the back slot's paint order at
 * once and travels there behind the others. That needs paint order to be the
 * z-index rather than depth, so the stage is flat (no preserve-3d) and the
 * perspective sits on the stage itself.
 *
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight fixed
 * @framerIntrinsicWidth 480
 * @framerIntrinsicHeight 320
 */

interface Photo {
    title: string
    image: string
    /** Which band of the photo's crop shows: −250 shows its bottom, 250 its top, 0 the centre. */
    offsetY?: number
}

type Interaction = "both" | "all" | "tap" | "press" | "drag" | "none"

interface CardSwapProps {
    items: Photo[]
    auto: boolean
    every: number
    /** Card width and height, in stage px at Scale 100. */
    cardWidth?: number
    cardHeight?: number
    radius: number
    /** How a hand swaps the front card: press it, drag and fling it, either, or not at all (display only). */
    interaction?: Interaction
    /** Typeface of the title tags. */
    font?: React.CSSProperties
    /** Size of the whole stack, in % of the size that fits the frame. */
    scale?: number
    /** Slant of every card, in degrees; the title capsules and their text slant with it. */
    tilt?: number
    showTitles: boolean
    background: string
    sound: boolean
    soundVolume: number
    style?: React.CSSProperties
}

const IMG = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=600&h=760&q=80`

const SAMPLE: Photo[] = [
    { title: "Siesta", image: IMG("1618599919511-c0cd9e3625cd") },
    { title: "Bloom", image: IMG("1728306901183-013f72ec0866") },
    { title: "Harvest", image: IMG("1690982961324-2c7f03336e63") },
    { title: "Shore", image: IMG("1692992257090-11ab872a6afa") },
]

// The stack is laid out on a logical stage and scaled to the frame.
const W = 360
const H = 350
const CW = 196
const CH = 246
const STEP_X = 34
const STEP_Y = 26
const STEP_Z = 70
const SKEW = 6
const PERSPECTIVE = 1000
// How far a pressed or flung card flies (stage px) before it tucks in at the back, and how long that takes.
const TOSS = 150
const TOSS_MS = 200
const TAG_INSET = 12
// The slot transition (.6s in the stylesheet) plus a frame or two: by then a let-go card has landed.
const SETTLE_MS = 650

const RADIUS = 18

// The title tag's original look: 12px semibold, tight tracking. The system stack stays behind
// the picked family, so an unloaded web font falls back to what the tag always used.
const DEFAULT_FONT: React.CSSProperties = { fontFamily: "Inter", fontWeight: 600, fontSize: 12, letterSpacing: "-0.005em", lineHeight: "1em" }
const SYSTEM_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

const clampN = (v: unknown, lo: number, hi: number, d: number) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : d
    return Math.min(hi, Math.max(lo, n))
}

// Slot i, in screen px for a stack drawn at k screen px per stage px, every card slanted by `tilt`°.
const slot = (i: number, k: number, tilt: number) =>
    `translate3d(${(i * STEP_X * k).toFixed(2)}px, ${(-i * STEP_Y * k).toFixed(2)}px, ${(-i * STEP_Z * k).toFixed(2)}px) skewY(${tilt}deg)`

/* The stack leans up and to the right, so centring the front card leaves the
   whole thing sitting high and right. Project every slot's corners through the
   stage perspective and shift the stage so the union of them is centred. */
function stackOffset(count: number, CW: number, CH: number, tilt: number) {
    const tan = Math.tan((tilt * Math.PI) / 180)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let k = 0; k < count; k++) {
        const s = PERSPECTIVE / (PERSPECTIVE + k * STEP_Z)
        for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const x = (cx * CW) / 2
            const y = (cy * CH) / 2 + x * tan
            const px = (x + k * STEP_X) * s
            const py = (y - k * STEP_Y) * s
            minX = Math.min(minX, px); maxX = Math.max(maxX, px)
            minY = Math.min(minY, py); maxY = Math.max(maxY, py)
        }
    }
    return { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2 }
}

const css = `
.csw { outline: none; }
.csw:focus-visible .csw-card[data-front] { box-shadow: 0 0 0 2px #fff, var(--csw-sh); }
.csw-card { position: absolute; inset: 0; overflow: hidden; cursor: default; touch-action: none; user-select: none; -webkit-user-select: none;
  transform: var(--t); transition: transform .6s cubic-bezier(.22,.9,.24,1), filter .6s ease;
  box-shadow: var(--csw-sh); background: #1c1c1e; }
.csw-card[data-front] { cursor: grab; }
.csw-card[data-front]:active { cursor: grabbing; }
.csw[data-ix=press] .csw-card[data-front] { cursor: pointer; }
.csw[data-ix=tap] .csw-card:not([data-front]), .csw[data-ix=all] .csw-card:not([data-front]) { cursor: pointer; }
.csw[data-ix=none] .csw-card[data-front], .csw[data-ix=tap] .csw-card[data-front] { cursor: default; }
.csw-photo { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.csw-tag { position: absolute; border-radius: 999px; line-height: 1; color: #fff; white-space: nowrap;
  background: rgba(0,0,0,0.38); pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .csw-card { transition: none; } }
`

/* ---- Sound ---------------------------------------------------------------
 * Tiny synthesized cues, no files and no network. Silent unless the `sound`
 * prop is on, and only ever played from a real user action (pointer or key),
 * never from autoplay. One shared AudioContext lives on window so many
 * components do not each open their own. */
type Cue = "whoosh" | "tick"
const cueAt: Record<string, number> = {}

function playCue(cue: Cue, volume = 0.5, minGap = 45) {
    if (typeof window === "undefined" || volume <= 0) return
    const stamp = Date.now()
    if (stamp - (cueAt[cue] || 0) < minGap) return
    cueAt[cue] = stamp
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
        if (cue === "tick") {
            const o = ctx.createOscillator()
            const g = ctx.createGain()
            o.type = "triangle"
            o.frequency.setValueAtTime(2300, t0)
            o.frequency.exponentialRampToValueAtTime(1900, t0 + 0.035)
            g.gain.setValueAtTime(0.0001, t0)
            g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.006)
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035)
            o.connect(g)
            g.connect(out)
            o.start(t0)
            o.stop(t0 + 0.06)
        } else {
            const dur = 0.24
            const n = Math.max(1, Math.floor(ctx.sampleRate * dur))
            const buf = ctx.createBuffer(1, n, ctx.sampleRate)
            const d = buf.getChannelData(0)
            for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
            const src = ctx.createBufferSource()
            const f = ctx.createBiquadFilter()
            const g = ctx.createGain()
            src.buffer = buf
            f.type = "bandpass"
            f.Q.value = 0.9
            f.frequency.setValueAtTime(500, t0)
            f.frequency.exponentialRampToValueAtTime(2600, t0 + dur)
            g.gain.setValueAtTime(0.0001, t0)
            g.gain.exponentialRampToValueAtTime(0.8, t0 + 0.01)
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
            src.connect(f)
            f.connect(g)
            g.connect(out)
            src.start(t0)
        }
    } catch {
        /* audio blocked or unsupported: stay silent */
    }
}

type Drag = { id: number; real: boolean; pid: number; x: number; y: number; dx: number; dy: number; t: number }

export default function CardSwap(props: CardSwapProps) {
    const { items, auto, every, showTitles, background, sound, soundVolume, font, scale = 100, tilt = 6, style } = props
    const ix: Interaction = props.interaction ?? "both"
    // Tap to Front only fetches a card from behind; "all" is Press + Drag on the front card plus that.
    const canPress = ix === "both" || ix === "all" || ix === "press"
    const canDrag = ix === "both" || ix === "all" || ix === "drag"
    const canFetch = ix === "tap" || ix === "all"
    const tiltDeg = clampN(tilt, -20, 20, SKEW)
    const list = items && items.length ? items : SAMPLE
    const n = list.length
    const radius = clampN(props.radius, 0, 40, RADIUS)
    const cw = clampN(props.cardWidth, 80, 400, CW)
    const ch = clampN(props.cardHeight, 80, 480, CH)
    // The stage grows with the card, so the whole stack still fits the frame at Scale 100.
    const SW = W + (cw - CW)
    const SH = H + (ch - CH)

    const rootRef = useRef<HTMLDivElement>(null)
    const [frame, setFrame] = useState({ w: 480, h: 320 })
    const [order, setOrder] = useState(() => list.map((_, i) => i))
    const els = useRef<Record<number, HTMLDivElement | null>>({})
    const st = useRef({ hover: false, visible: true, drag: null as Drag | null, toss: 0 })

    // Keep the order in step with the item count when the list is edited. Until the effect lands,
    // render in list order, so a card added or removed never leaves two cards in the front slot.
    useEffect(() => setOrder(list.map((_, i) => i)), [n])
    const ord = order.length === n ? order : list.map((_, i) => i)

    useEffect(() => {
        const el = rootRef.current
        if (!el) return
        const ro = new ResizeObserver(() => el.clientWidth && el.clientHeight && setFrame({ w: el.clientWidth, h: el.clientHeight }))
        ro.observe(el)
        const io = new IntersectionObserver(([e]) => (st.current.visible = e.isIntersecting))
        io.observe(el)
        return () => {
            ro.disconnect()
            io.disconnect()
        }
    }, [])

    /* While the front card rests, its title is drawn as a level tag outside the card's transform
       (see the "rest tag" below); while it moves, the title travels inside the card. `rest` says
       which. A card in motion lands SETTLE_MS after it is let go into its slot. */
    const [rest, setRest] = useState(true)
    const restTimer = useRef(0)
    const moving = (landMs: number | null) => {
        window.clearTimeout(restTimer.current)
        setRest(false)
        if (landMs !== null) restTimer.current = window.setTimeout(() => setRest(true), landMs)
    }
    useEffect(() => () => window.clearTimeout(restTimer.current), [])

    /* Every card goes back to its slot: no drag survives a swap, so a card can
       never be left holding where a hand once put it. */
    const settle = () => {
        for (const el of Object.values(els.current)) {
            if (el) {
                el.style.transition = ""
                el.style.transform = ""
            }
        }
        const still = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        moving(still ? 0 : SETTLE_MS)
    }

    // Send the front card to the back. It takes the back slot now, from
    // wherever it is: the front slot, or where a drag left it.
    const swap = (byHand: boolean) => {
        settle()
        if (byHand && sound) playCue("whoosh", soundVolume)
        setOrder((o) => [...o.slice(1), o[0]])
    }

    // Tap to Front: a tap on a card further back brings it straight to the front; the rest keep their
    // order and each step back one slot. It takes the front paint order at once and travels forward over them.
    const bringFront = (id: number) => {
        const s = st.current
        if (!canFetch || s.drag || s.toss) return
        settle()
        if (sound) playCue("whoosh", soundVolume)
        setOrder([id, ...ord.filter((x) => x !== id)])
    }

    /* A hand sends the card away along (ux, uy) first, from wherever it is, and
       only then to the back: the card answers the push before it tucks in. */
    const toss = (id: number, ux: number, uy: number, x = 0, y = 0) => {
        const el = els.current[id]
        const s = st.current
        const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        if (!el || still) return swap(true)
        moving(null)
        if (sound) playCue("whoosh", soundVolume)
        const tx = (x + ux * TOSS) * k
        const ty = (y + uy * TOSS) * k
        el.style.transition = `transform ${TOSS_MS}ms cubic-bezier(.2,.7,.3,1)`
        el.style.transform = `${slot(0, k, tiltDeg)} translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${(ux * 10).toFixed(2)}deg)`
        window.clearTimeout(s.toss)
        s.toss = window.setTimeout(() => {
            s.toss = 0
            swap(false)
        }, TOSS_MS)
    }
    useEffect(() => () => window.clearTimeout(st.current.toss), [])

    /* The drag: only the grabbed card moves, and the window hears the gesture,
       so it can't be lost off the edge of the block or picked up by a card the
       pointer passes over. Past a little way the card is on a rubber band, so a
       long drag can't carry it out of the block. Pointer travel is divided by
       the stage scale so the card stays under the finger. */
    const unhook = useRef(() => {})
    useEffect(() => () => unhook.current(), [])

    /* Screen px per stage px: the fit to the frame, then Scale. Every length is multiplied by k and
       laid out at that size, rather than laying the stage out small and scaling it with a
       transform: a scaled-up box is drawn at its small size and magnified, which softened the
       photos and the titles (the fit alone is ×1.7 in the builder) and would blur them further at
       any Scale above 100. At Scale 100 and the default card the stack is the same shape as before. */
    const fit = Math.min(frame.w / SW, frame.h / SH)
    const grow = clampN(scale, 10, 200, 100) / 100
    const k = fit * grow

    const grab = (e: React.PointerEvent<HTMLDivElement>, id: number, front: boolean) => {
        const s = st.current
        if (s.drag && e.nativeEvent.isTrusted && !s.drag.real) {
            unhook.current()
            s.drag = null
            settle()
        }
        if ((!canPress && !canDrag) || !front || s.drag || s.toss || e.button !== 0) return
        const el = e.currentTarget
        // Screen px per stage px: our own fit scale times any scale an outer frame applies.
        const root = rootRef.current
        const outer = root && root.clientWidth ? root.getBoundingClientRect().width / root.clientWidth : 1
        const kScreen = (k || 1) * outer
        s.drag = { id, real: e.nativeEvent.isTrusted, pid: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, t: performance.now() }
        moving(null)
        el.style.transition = "none"
        const rub = (d: number) => 160 * Math.tanh(d / 160)
        const mine = (ev: PointerEvent) => !!s.drag && ev.pointerId === s.drag.pid && ev.isTrusted === s.drag.real
        const mv = (ev: PointerEvent) => {
            if (!mine(ev) || !s.drag) return
            const d = s.drag
            d.dx = (ev.clientX - d.x) / kScreen
            d.dy = (ev.clientY - d.y) / kScreen
            // Press only: the card stays put under the hand and answers on release.
            if (!canDrag) return
            const x = rub(d.dx)
            const y = rub(d.dy)
            el.style.transform = `${slot(0, k, tiltDeg)} translate(${(x * k).toFixed(1)}px, ${(y * k).toFixed(1)}px) rotate(${(x * 0.05).toFixed(2)}deg)`
        }
        const up = (ev: PointerEvent) => {
            if (!mine(ev) || !s.drag) return
            const d = s.drag
            s.drag = null
            unhook.current()
            const far = Math.hypot(d.dx, d.dy)
            const quick = far / Math.max(1, performance.now() - d.t) > 0.6
            // A press: sent toward the point pressed, so a press on the left sends it left.
            // With press only, a hand that wandered while held still counts as a press.
            if (ev.type !== "pointercancel" && canPress && (far < 6 || !canDrag)) {
                const r = el.getBoundingClientRect()
                const vx = d.x - (r.left + r.width / 2)
                const vy = d.y - (r.top + r.height / 2)
                const len = Math.hypot(vx, vy)
                // Dead centre has no side; it goes right, where the stack leans.
                toss(id, len > 4 ? vx / len : 1, len > 4 ? vy / len : 0)
                return
            }
            // A drag far or quick enough: on the way it was thrown, from where the hand let go.
            if (ev.type !== "pointercancel" && canDrag && (far > 70 || (quick && far > 24))) {
                toss(id, d.dx / far, d.dy / far, rub(d.dx), rub(d.dy))
                return
            }
            // Not far enough: it springs back into the front slot.
            if (sound && far >= 6) playCue("tick", soundVolume * 0.6)
            settle()
        }
        window.addEventListener("pointermove", mv)
        window.addEventListener("pointerup", up)
        window.addEventListener("pointercancel", up)
        unhook.current = () => {
            window.removeEventListener("pointermove", mv)
            window.removeEventListener("pointerup", up)
            window.removeEventListener("pointercancel", up)
            unhook.current = () => {}
        }
    }

    // The timer: one swap every few seconds, unless a hand is on it or it's out of sight.
    useEffect(() => {
        if (!auto) return
        const id = window.setInterval(() => {
            const s = st.current
            if (!s.hover && !s.drag && !s.toss && s.visible && !document.hidden) swap(false)
        }, Math.max(1.5, every) * 1000)
        return () => window.clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auto, every, order])

    const off = stackOffset(n, cw, ch, tiltDeg)
    const f = { ...DEFAULT_FONT, ...(font ?? {}) }
    const fontPx = clampN(typeof f.fontSize === "string" ? parseFloat(f.fontSize) : f.fontSize, 4, 96, 12)
    const tagStyle: React.CSSProperties = {
        padding: `${(6 * k).toFixed(2)}px ${(10 * k).toFixed(2)}px`,
        fontFamily: f.fontFamily ? `${f.fontFamily}, ${SYSTEM_SANS}` : SYSTEM_SANS,
        fontWeight: f.fontWeight,
        fontStyle: f.fontStyle,
        fontSize: fontPx * k,
        letterSpacing: f.letterSpacing,
        backdropFilter: `blur(${(10 * k).toFixed(2)}px)`,
        WebkitBackdropFilter: `blur(${(10 * k).toFixed(2)}px)`,
    }

    /* The rest tag: the resting front card's title, drawn outside the card's 3D layer, exactly over
       the card's own tag and slanted the same Tilt. Inside the card the title is drawn into the
       layer and resampled again when the layer is put on screen, which softened it; outside, the
       slant is drawn straight onto the page, as crisp as slanted text gets. Where it goes: slot 0 is
       a skewY about the card centre (its translate3d is zero, so no perspective), applied to the
       tag's bottom-left corner; the rest tag skews by the same angle about that corner. */
    const frontItem = list[ord[0]]
    const tan = Math.tan((tiltDeg * Math.PI) / 180)
    const cardL = ((SW - cw) / 2 + off.x) * k
    const cardT = ((SH - ch) / 2 + off.y) * k
    const tagX = TAG_INSET * k
    const tagBottomY = cardT + ch * k - TAG_INSET * k + (tagX - (cw * k) / 2) * tan
    const restTag = showTitles && rest && !!frontItem?.title

    return (
        <div
            ref={rootRef}
            className="csw"
            data-ix={ix}
            // Interaction None is display only: no focus stop, no keys.
            tabIndex={ix === "none" ? undefined : 0}
            role="group"
            aria-roledescription="card stack"
            aria-label={`Photo stack, ${frontItem?.title || "card"} in front`}
            onKeyDown={(e) => {
                if (ix !== "none" && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) {
                    e.preventDefault()
                    if (!st.current.toss) swap(true)
                }
            }}
            onPointerEnter={() => (st.current.hover = true)}
            onPointerLeave={() => (st.current.hover = false)}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                ...style,
                // Above 100 % the stack may outgrow the frame; it is then let past the edge rather than cut off.
                overflow: grow > 1 ? "visible" : "hidden",
                background,
                ["--csw-sh" as string]: `0 ${(18 * k).toFixed(2)}px ${(40 * k).toFixed(2)}px ${(-12 * k).toFixed(2)}px rgba(0,0,0,0.55)`,
            }}
        >
            <style>{css}</style>
            <div
                style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: SW * k,
                    height: SH * k,
                    marginLeft: (-SW * k) / 2,
                    marginTop: (-SH * k) / 2,
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        left: cardL,
                        top: cardT,
                        width: cw * k,
                        height: ch * k,
                        perspective: PERSPECTIVE * k,
                        perspectiveOrigin: "50% 50%",
                    }}
                >
                    {list.map((c, id) => {
                        const pos = ord.indexOf(id)
                        const front = pos === 0
                        return (
                            <div
                                key={id}
                                ref={(el) => {
                                    els.current[id] = el
                                }}
                                className="csw-card"
                                data-front={front || undefined}
                                aria-hidden={!front}
                                /* The slot is a variable the stylesheet turns into the transform;
                                   the drag writes the transform itself, which wins until cleared. */
                                style={{
                                    zIndex: n - pos,
                                    borderRadius: radius * k,
                                    // Without drag the card needs no gesture of its own, so a touch may scroll the page.
                                    touchAction: canDrag ? undefined : "pan-y",
                                    ["--t" as string]: slot(Math.max(0, pos), k, tiltDeg),
                                }}
                                onPointerDown={(e) => grab(e, id, front)}
                                onClick={front ? undefined : () => bringFront(id)}
                            >
                                {c.image && (
                                    <img
                                        className="csw-photo"
                                        src={c.image}
                                        alt={front ? c.title : ""}
                                        draggable={false}
                                        style={{
                                            // `cover` already overflows the card on one axis; this picks which part
                                            // of that overflow shows, as a share of it, never as pixels. The ends of
                                            // the slider are the ends of the photo: −250 its bottom edge flush with
                                            // the card, 250 its top. Read here at render, so dragging the slider
                                            // re-frames every card already on screen.
                                            objectPosition: `50% ${50 - (clampN(c.offsetY, -250, 250, 0) / 250) * 50}%`,
                                        }}
                                    />
                                )}
                                {showTitles && c.title && (
                                    <div
                                        className="csw-tag"
                                        style={{
                                            ...tagStyle,
                                            left: tagX,
                                            bottom: TAG_INSET * k,
                                            // Slants with its card, by the card's own transform.
                                            // The resting front card shows the rest tag instead.
                                            visibility: front && restTag ? "hidden" : undefined,
                                        }}
                                    >
                                        {c.title}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
                {restTag && (
                    <div
                        className="csw-tag"
                        aria-hidden="true"
                        style={{ ...tagStyle, left: cardL + tagX, bottom: SH * k - tagBottomY, transform: `skewY(${tiltDeg}deg)`, transformOrigin: "0 100%" }}
                    >
                        {frontItem.title}
                    </div>
                )}
            </div>
        </div>
    )
}

CardSwap.defaultProps = {
    items: SAMPLE,
    // Off by default: a stack that reshuffles itself is a thing that keeps moving while you read.
    auto: false,
    every: 4,
    cardWidth: CW,
    cardHeight: CH,
    radius: RADIUS,
    interaction: "both",
    font: DEFAULT_FONT,
    scale: 100,
    tilt: SKEW,
    showTitles: true,
    background: "transparent",
    sound: false,
    soundVolume: 0.5,
}

// Control order arranged in the builder.
