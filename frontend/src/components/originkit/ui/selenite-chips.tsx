/* eslint-disable */
// Delivered by Originkit · stack: nextjs · styling: tailwind
// Delivered by Originkit · stack: framer
// Paste into a Framer code component. Property controls included.
"use client"
import { animate, cancelFrame, frame, motionValue, useReducedMotion } from "framer-motion"
import type { MotionValue, Transition, ValueAnimationTransition } from "framer-motion"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type { CSSProperties, FocusEvent as ReactFocusEvent, PointerEvent as ReactPointerEvent } from "react"

/*
 * SeleniteChips — a row of choice chips on near-black, each turning to glass
 * when picked: the glass fades in with a check at its left while the chip
 * widens to make room, nudging its label over, and the chalk dots behind it
 * show through as they are; the row stays centred as it grows. Pick it again
 * and the glass drains out first, then the chip narrows back. Several can be
 * on at once. Active Style → Solid picks a chip in one plain colour instead.
 *
 * The glass sibling of AnthraciteTags (same port, same motion), styled as
 * ChalkRung: a picked chip is glass, as ChalkRung's keys are.
 *
 * Built after the choice chips in "Recording 2026-10-29 113321.mp4" (a
 * 922×288 screen recording of a design-tool control sheet), measured frame
 * by frame at 30 fps (13.4–15.9 s):
 * - Chips 20 pt tall, radius 4, 7 pt apart, at the sheet's 3.5 px per pt.
 *   Labels 10.5 pt Inter Medium (cap 7.7 pt, as the stepper's numeral),
 *   8.2 pt of padding each side ("Motion" 50.3 pt, "Code" 41.4 pt wide).
 * - Picked, a check (two strokes, 8 × 6.3 pt, 1.4 pt round stroke) sits
 *   6.3 pt from the left, 4.9 pt before the label, so the chip is 10.7 pt
 *   wider ("Motion" 61 pt); the label slides right by exactly that.
 * - #E1E1E1 chips with #747474 labels; picked, #0DBD40 with white.
 * - Picking: the colour comes in front-loaded (0.69 → 0.88 → 0.96 a frame;
 *   cubic-bezier(0.1, 1, 0.2, 1) over 0.27 s, 0.7 % rms) with the check, and
 *   the chip widens alongside ((0.7, 1, 0.3, 0.8) over 0.21 s, 1 % rms);
 *   mid-way the check crowds the label ("✓Code") until the width catches up.
 *   The neighbours slide by half the change, so the row stays centred.
 * - Unpicking: a press darkens the chip; on release the colour drains in a
 *   frame (76 %; (0.3, 1, 0.2, 1) over 0.14 s) and the chip narrows on a
 *   slower ease-out ((0.6, 0.8, 0.4, 1) over 0.32 s).
 *
 * Styled as ChalkRung: the sheet's #FAFAFA page, #E1E1E1 chips and grey
 * labels become a black page and #121214 chips with chalk dots edge to
 * edge, every gap the same, a hairline edge and muted labels. The sheet's
 * green becomes clear glass, the same glass as the three other glass blocks
 * (VitreousBrim, HyalineLevel, CharcoalShuttle), drawn rather than
 * filtered: the chip and its dots show through as they are, under a tint
 * strongest at the top, a band of light across the top, a darker foot and
 * a rim bright along the top; the label and check turn white. Its
 * gradients run top to bottom in the chip's own space, so widening never
 * rebuilds them.
 *
 * How it is built: each chip is its own small SVG (its dots one baked
 * image), laid out by hand each frame from two motion values per chip (how
 * far it has widened, how far its colour has come in) and moved by a 2D
 * transform, so a frame repaints only the chips that change, each just its
 * own box. A click starts two animations and writes aria-pressed to its
 * button: no React render, however fast the clicks come; a new click takes
 * over from wherever the last one had got to. The hit areas are real toggle
 * buttons of a fixed laid-out size, stretched to their chips by a
 * transform, so nothing is laid out per frame. Label widths come from the
 * browser's own layout. Nothing runs at rest.
 */

// ---------------------------------------------------------------- constants

// The clip's frame. Lengths below are in pt, the clip's own spec unit.
const REF_W = 922
const REF_H = 288
const REF_ASPECT = REF_W / REF_H
const PT = 3.5 // clip px per pt at Scale 100 %
// Share of the frame's width the row may take at its widest (every chip
// picked): more chips than fit at Scale shrink the whole row to fit rather
// than run off the frame.
const FIT = 1
const MEASURE_PX = 100 // labels are measured at this size, off screen, so the fit never feeds back into the measure
const CHECK_W = 8 // pt, the check's box
const CHECK_H = 6.3
const CHECK_STROKE = 1.4
const PRESS_FADE = 0.06 // s, the press darkening coming and going
const HOVER_SHADE = 0.45 // share of the press darkening a hovered chip shows
const HIT_BASE = 100 // px: each hit box's laid-out width, stretched to its chip by a transform
// Hidden, yet still drawn: a layer kept at opacity 0 is never drawn, so its
// first show pays for its first raster (and on the glass sibling, the GPU
// setting up its gradients) — a 24–30 ms frame on the first pick. Just over
// 1/255, so it is never rounded away (0.001 was, and still cost the frame),
// and at most one level off the chip below: invisible.
const HIDDEN = 0.0045
// Fitted to the clip; see the header. The Transition control drives the
// widening; these are its partners.
const TINT_EASE: [number, number, number, number] = [0.1, 1, 0.2, 1]
const RELEASE_EASE: [number, number, number, number] = [0.6, 0.8, 0.4, 1]
const RELEASE_TINT_EASE: [number, number, number, number] = [0.3, 1, 0.2, 1]

const WEB_FONT = "Inter"
const WEB_FONT_CSS = "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap"
const FALLBACK_STACK = '"Inter", "SF Pro Text", system-ui, sans-serif'

// ---------------------------------------------------------------- types

interface FontValue {
    fontFamily?: string
    fontWeight?: number | string
    fontStyle?: string
    fontSize?: string | number
    letterSpacing?: string | number
}

export interface Chip {
    label: string
    /** Whether it starts picked. (Was `selected`; renamed so instances saved
     *  with the old defaults, two chips on, start unpicked.) */
    picked: boolean
}

export interface Colors {
    chip: string
    /** Hairline round each chip, so it holds its edge on a black page. */
    edge: string
    /** A picked chip's glass tint. Keep it translucent; the dots show through. */
    glass: string
    /** A picked chip when Active Style is Solid. */
    solid: string
    /** The label and check on a picked chip. */
    onAccent: string
    /** The chalk dots, seen through the glass as they are; transparent hides them. */
    dots: string
}

export interface Placement {
    x: number
    y: number
}

export interface Advanced {
    height: number
    padding: number
    checkLeft: number
    checkGap: number
    gap: number
    textSize: number
    dotPitch: number
    dotSize: number
    press: number
    sheen: number
    rim: number
    rimWidth: number
    tint: number
    release: number
    releaseTint: number
}

export interface SeleniteChipsProps {
    /** The chips, left to right, and which start picked. */
    items?: Chip[]
    background?: string
    font?: FontValue
    /** Labels on chips that are not picked. */
    textColor?: string
    /** How big the row draws in its frame. 100 % is the clip's framing. */
    scale?: number
    /** Chip corner radius in pt. */
    radius?: number
    /** A picked chip: clear glass over its dots, or one solid colour (Active Fill). */
    cover?: "glass" | "solid"
    /** Chip fill. */
    chipColor?: string
    /** Hairline round each chip. */
    borderColor?: string
    /** The dots on every chip; transparent hides them. */
    dotColor?: string
    /** A picked chip's glass tint (Active Style → Glass). */
    glassColor?: string
    /** A picked chip's fill (Active Style → Solid). */
    solidColor?: string
    /** Label and tick on a picked chip. */
    activeTextColor?: string
    /** Earlier grouped colours, still read so saved instances keep them. */
    colors?: Partial<Colors>
    placement?: Partial<Placement>
    /** Drives a chip widening as it is picked (the clip's 0.21 s). */
    transition?: Transition
    advanced?: Partial<Advanced>
    /** Called with the picked labels (code use). */
    onChange?: (picked: string[]) => void
    style?: CSSProperties
}

// ---------------------------------------------------------------- defaults

// The clip's three chips, the first picked to start, so the glass shows at rest.
const DEFAULT_ITEMS: Chip[] = [
    { label: "Design", picked: true },
    { label: "Motion", picked: false },
    { label: "Code", picked: false },
]
const DEFAULT_FONT: FontValue = { fontFamily: WEB_FONT, fontWeight: 500 }
// ChalkRung's ground, chalk and glass, so the two sit together on a page.
const DEFAULT_COLORS: Colors = {
    chip: "#121214",
    edge: "rgba(255, 255, 255, 0.08)",
    glass: "rgba(255, 255, 255, 0.14)",
    solid: "#3A3A3C",
    onAccent: "#F4F4F5",
    dots: "rgba(255, 255, 255, 0.12)",
}
const DEFAULT_PLACEMENT: Placement = { x: 0, y: 0 }

// Matches the Advanced controls' defaults, which is what Framer renders.
const DEFAULT_ADVANCED: Advanced = {
    height: 20,
    padding: 9.2,
    checkLeft: 6.3,
    checkGap: 4.9,
    gap: 7,
    textSize: 10.5,
    dotPitch: 2,
    dotSize: 0.3,
    press: 10,
    sheen: 30,
    rim: 70,
    rimWidth: 0.35,
    tint: 270,
    release: 320,
    releaseTint: 140,
}

const DEFAULT_TRANSITION: Transition = { type: "tween", ease: [0.7, 1, 0.3, 0.8], duration: 0.21 }

// ---------------------------------------------------------------- helpers

// An empty colour field falls back to its default.
const orDefault = (value: string | undefined, fallback: string) => (value === undefined || value === "" ? fallback : value)
const sameColor = (a: string, b: string) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase()
// A panel row left at its default defers to the old grouped colour, so
// instances saved before the Colors group was split keep their colours.
const flatOr = (flat: string | undefined, old: string | undefined, fallback: string) =>
    flat && !sameColor(flat, fallback) ? flat : orDefault(old, fallback)
// Each flat colour prop and the Colors key it replaced.
const FLAT_COLORS: [keyof Colors, "chipColor" | "borderColor" | "dotColor" | "glassColor" | "solidColor" | "activeTextColor"][] = [
    ["chip", "chipColor"],
    ["edge", "borderColor"],
    ["dots", "dotColor"],
    ["glass", "glassColor"],
    ["solid", "solidColor"],
    ["onAccent", "activeTextColor"],
]
// The Font control's size, relative to its 16 px default: 16 px is the clip's
// label size (Advanced → Text Size), 24 px draws the labels 1.5× as big.
const FONT_SIZE_BASE = 16
const fontSizeRatio = (v: string | number | undefined) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""))
    return Number.isFinite(n) && n > 0 ? n / FONT_SIZE_BASE : 1
}
// A chip is never shorter than this many times its text, so a larger Font size
// grows the chip rather than spilling out of it (the clip's 20 pt over 10.5 pt).
const MIN_HEIGHT_PER_TEXT = 1.9

/** The glyph colour that reads on a fill: near-black on fills brighter than `cut` (relative luminance), white otherwise. */
function inkOn(fill: string, fallback: string, cut = 0.4) {
    const s = String(fill || "").trim()
    let rgb: number[] | null = null
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1]
        rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
    } else {
        const m = /^rgba?\(([^)]+)\)/i.exec(s)
        if (m) rgb = m[1].split(",").slice(0, 3).map((v) => parseFloat(v))
    }
    if (!rgb || rgb.some((v) => !Number.isFinite(v))) return fallback
    const [r, g, b] = rgb.map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > cut ? "#141415" : "#FFFFFF"
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

// The Font control may hand over a ready-made stack ("Inter", "Inter
// Placeholder", sans-serif); a bare name gets quoted.
function familyStack(family: string): string {
    if (family === WEB_FONT) return FALLBACK_STACK
    return /[",]/.test(family) ? `${family}, ${FALLBACK_STACK}` : `"${family}", ${FALLBACK_STACK}`
}

// The grid over a chip w wide, no padding: a square lattice whose pitch is a
// whole number of device pixels, so every gap is the same, centred on the
// chip (half a gap to a gap at each end) and carried on to `to` px, so a
// chip widening past w still has dots under it. Dots the rounded corners of
// the w-wide chip cut off are left out. Each dot's top left, in px.
function gridDots(w: number, h: number, r: number, pitch: number, side: number, dev: number, to = w): [number, number][] {
    const p = Math.max(1, Math.round(pitch * dev))
    const s = Math.max(1, Math.round(side * dev))
    const W = Math.round(w * dev)
    const H = Math.round(h * dev)
    const T = Math.round(to * dev)
    const nx = Math.floor((W - s) / p)
    const ny = Math.floor((H - s) / p)
    if (nx < 1 || ny < 1) return []
    const ox = Math.floor((W - (nx - 1) * p - s) / 2)
    const oy = Math.floor((H - (ny - 1) * p - s) / 2)
    const out: [number, number][] = []
    for (let j = 0; j < ny; j++) {
        for (let i = 0; ox + i * p + s <= T; i++) {
            const x = (ox + i * p) / dev
            const y = (oy + j * p) / dev
            if (i < nx) {
                const ex = Math.max(0, r - Math.min(x + side / 2, w - x - side / 2))
                const ey = Math.max(0, r - Math.min(y + side / 2, h - y - side / 2))
                if (ex > 0 && ey > 0 && Math.hypot(ex, ey) > r - side) continue
            }
            out.push([x, y])
        }
    }
    return out
}

interface ChipMotion {
    grow: MotionValue<number> // 0 → 1 as it widens for the check
    tint: MotionValue<number> // 0 → 1 as its colour and check come in
    press: MotionValue<number> // 0 → 1 while pressed
}

// ---------------------------------------------------------------- component

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 * @framerIntrinsicWidth 922
 * @framerIntrinsicHeight 288
 */
export default function SeleniteChips(props: SeleniteChipsProps) {
    const {
        items: itemsProp = DEFAULT_ITEMS,
        font,
        scale = 125,
        radius = 4,
        cover = "glass",
        colors,
        placement,
        transition = DEFAULT_TRANSITION,
        advanced,
        onChange,
        style,
    } = props
    const named = (itemsProp ?? []).filter((c) => c && typeof c.label === "string" && c.label.trim())
    const items = named.length ? named : DEFAULT_ITEMS
    const n = items.length
    const background = orDefault(props.background, "#000000")
    const textColor = orDefault(props.textColor, "#8E8E93")
    const col = { ...DEFAULT_COLORS } as Colors
    for (const [key, flat] of FLAT_COLORS) col[key] = flatOr(props[flat], colors?.[key], DEFAULT_COLORS[key])
    // A solid picked chip in a colour someone chose: its label and check follow the fill unless set too.
    if (cover === "solid" && sameColor(col.onAccent, DEFAULT_COLORS.onAccent)) col.onAccent = inkOn(col.solid, col.onAccent)
    const pl = { ...DEFAULT_PLACEMENT, ...placement }
    const adv = { ...DEFAULT_ADVANCED, ...advanced }
    const f = { ...DEFAULT_FONT, ...font }
    // Label size in pt: Advanced → Text Size, times the Font control's size.
    const textPt = Math.max(1, adv.textSize * fontSizeRatio(f.fontSize))
    const glass = cover !== "solid"
    const reduced = !!useReducedMotion()
    const family =
        f.fontFamily && !/^(sans-serif|system-ui)$/i.test(String(f.fontFamily).trim()) ? String(f.fontFamily) : WEB_FONT
    // Prefixed, so another component on the page can never lend this one its clips.
    const uid = "selenite" + useId().replace(/[^a-zA-Z0-9_-]/g, "")

    const rootRef = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ w: REF_W, h: REF_H })
    const [dpr, setDpr] = useState(1)
    const [shown, setShown] = useState(1)

    // ---------------------------------------------------------- frame

    const measureShown = () => {
        const root = rootRef.current
        if (!root || !root.offsetWidth) return
        const s = root.getBoundingClientRect().width / root.offsetWidth
        if (s > 0.05 && s < 20) setShown((q) => (Math.abs(q - s) > 0.004 ? s : q))
    }
    useIsoLayoutEffect(() => {
        const root = rootRef.current
        if (!root) return
        // Measure before the first paint. The host remounts the component
        // when some controls change (Cover); waiting for the observer drew
        // one or two frames at the 922×288 reference size, zoomed and
        // cropped, before it snapped back.
        const cs = getComputedStyle(root)
        const w0 = parseFloat(cs.width)
        const h0 = parseFloat(cs.height)
        if (w0 > 0 && h0 > 0) setSize((s) => (s.w === w0 && s.h === h0 ? s : { w: w0, h: h0 }))
        measureShown()
        const ro = new ResizeObserver((es) => {
            const r = es[0].contentRect
            if (r.width > 0 && r.height > 0) setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }))
            measureShown()
        })
        ro.observe(root)
        return () => ro.disconnect()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    useIsoLayoutEffect(() => {
        const upd = () => setDpr(Math.min(4, Math.max(1, window.devicePixelRatio || 1)))
        upd()
        window.addEventListener("resize", upd)
        return () => window.removeEventListener("resize", upd)
    }, [])
    // The default face comes from Google Fonts; Framer loads any other itself.
    useEffect(() => {
        if (family !== WEB_FONT || document.querySelector("link[data-selenite-chips-font]")) return
        const l = document.createElement("link")
        l.rel = "stylesheet"
        l.href = WEB_FONT_CSS
        l.dataset.seleniteChipsFont = "1"
        document.head.appendChild(l)
    }, [family])

    // ---------------------------------------------------------- geometry

    // One unit for the whole composition: the clip's frame, contained.
    const u = Math.min(size.h, size.w / REF_ASPECT) / REF_H
    const kScale = u * PT * Math.max(0.05, scale / 100) // layout px per pt at Scale

    // Label widths at MEASURE_PX, from hidden twins of the labels: independent
    // of size, so fitting the row to the frame cannot feed back into itself.
    const labelEls = useRef<(HTMLSpanElement | null)[]>([])
    const [label100, setLabel100] = useState<number[]>(() => items.map((c) => c.label.length * 0.6 * MEASURE_PX))
    useIsoLayoutEffect(() => {
        const els = labelEls.current.slice(0, n)
        const measure = () => {
            const next = els.map((el) => (el ? el.offsetWidth : 0))
            setLabel100((w) => (w.length === next.length && w.every((v, i) => v === next[i]) ? w : next))
        }
        measure()
        const ro = new ResizeObserver(measure)
        for (const el of els) if (el) ro.observe(el)
        document.fonts?.ready.then(measure).catch(() => {})
        return () => ro.disconnect()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [n, family, f.fontWeight, f.fontStyle, f.letterSpacing, items.map((c) => c.label).join("\n")])

    // The row at its widest (every chip picked), in pt; more chips than the
    // frame holds at Scale shrink the whole row so every one stays in view.
    const growPt = Math.max(0, Math.max(0, adv.checkLeft) + CHECK_W + Math.max(0, adv.checkGap) - Math.max(0, adv.padding))
    const rowPt =
        label100.slice(0, n).reduce((s, w) => s + 2 * Math.max(0, adv.padding) + (w / MEASURE_PX) * textPt + growPt, 0) +
        Math.max(0, adv.gap) * Math.max(0, n - 1)
    const k = rowPt > 0 ? Math.min(kScale, (FIT * size.w) / rowPt) : kScale // layout px per pt
    const dev = dpr * shown // device px per layout px
    const snap = (v: number) => Math.round(v * dev) / dev
    const hair = (pt: number) => Math.max(1, Math.round(pt * k * dev)) / dev // never under one device px
    const px = (v: number) => `${(v * k).toFixed(3)}px`

    const H = snap(Math.max(8, adv.height, textPt * MIN_HEIGHT_PER_TEXT) * k)
    const rad = Math.min(H / 2, Math.max(0, radius) * k)
    const pad = Math.max(0, adv.padding) * k
    const checkL = Math.max(0, adv.checkLeft) * k
    // How much a picked chip widens: the check and its gap, less the padding it replaces.
    const grow = Math.max(0, checkL + CHECK_W * k + Math.max(0, adv.checkGap) * k - pad)
    const gap = Math.max(0, adv.gap) * k
    const edgeW = hair(0.25)
    const ringW = hair(0.6)

    // Label widths in layout px, from the browser's own layout of the labels as drawn.
    const shownEls = useRef<(HTMLSpanElement | null)[]>([])
    const [labelW, setLabelW] = useState<number[]>(() => items.map((c) => c.label.length * 0.6 * textPt * k))
    useIsoLayoutEffect(() => {
        const els = shownEls.current.slice(0, n)
        const measure = () => {
            const next = els.map((el) => (el ? el.offsetWidth : 0))
            setLabelW((w) => (w.length === next.length && w.every((v, i) => Math.abs(v - next[i]) < 0.01) ? w : next))
        }
        measure()
        const ro = new ResizeObserver(measure)
        for (const el of els) if (el) ro.observe(el)
        document.fonts?.ready.then(measure).catch(() => {})
        return () => ro.disconnect()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [n, k, family, f.fontWeight, f.fontStyle, f.letterSpacing, textPt, items.map((c) => c.label).join("\n")])
    // Every chip's box is the widest a chip can get; what shows is set per frame.
    const maxW = Math.ceil(Math.max(0, ...labelW.map((w) => 2 * pad + w + grow)) + 2)

    const cx = snap(size.w / 2 + (pl.x / 100) * size.w)
    const cy = snap(size.h / 2 + (pl.y / 100) * size.h)
    const turn = `translate(${cx}px, ${cy}px)`

    // ---------------------------------------------------------- state

    // Which chips are picked. Kept outside React: a click starts animations
    // and writes aria-pressed straight to its button, with no render.
    const picked = useRef<boolean[]>(items.map((c) => !!c.picked))
    const motions = useRef<ChipMotion[]>([])
    while (motions.current.length < n) {
        const on = !!items[motions.current.length]?.picked
        motions.current.push({ grow: motionValue(on ? 1 : 0), tint: motionValue(on ? 1 : 0), press: motionValue(0) })
    }
    const live = useRef({ transition, reduced, adv, onChange, items })
    live.current = { transition, reduced, adv, onChange, items }

    const play = (i: number, on: boolean) => {
        const m = motions.current[i]
        const L = live.current
        if (!m) return
        if (L.reduced) {
            m.grow.jump(on ? 1 : 0)
            m.tint.jump(on ? 1 : 0)
            return
        }
        // Each call takes over from wherever the last one had got to, so a
        // burst of clicks only ever redirects two animations per chip.
        if (on) {
            animate(m.grow, 1, L.transition as ValueAnimationTransition<number>)
            animate(m.tint, 1, { type: "tween", ease: TINT_EASE, duration: Math.max(0, L.adv.tint) / 1000 })
        } else {
            animate(m.grow, 0, { type: "tween", ease: RELEASE_EASE, duration: Math.max(0, L.adv.release) / 1000 })
            animate(m.tint, 0, { type: "tween", ease: RELEASE_TINT_EASE, duration: Math.max(0, L.adv.releaseTint) / 1000 })
        }
    }
    const btnEls = useRef<(HTMLButtonElement | null)[]>([])
    const toggle = (i: number) => {
        const next = !picked.current[i]
        picked.current[i] = next
        play(i, next)
        btnEls.current[i]?.setAttribute("aria-pressed", String(next))
        const L = live.current
        L.onChange?.(L.items.filter((_, j) => picked.current[j]).map((c) => c.label))
    }

    // The panel's picks: play to them when edited.
    const mounted = useRef(false)
    const pickKey = items.map((c) => (c.picked ? "1" : "0")).join("")
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true
            return
        }
        items.forEach((c, i) => {
            if (!!c.picked !== picked.current[i]) {
                picked.current[i] = !!c.picked
                play(i, !!c.picked)
                btnEls.current[i]?.setAttribute("aria-pressed", String(!!c.picked))
            }
        })
        picked.current.length = n
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pickKey, n])

    // ---------------------------------------------------------- per frame

    // Each chip is its own small SVG, moved by a 2D transform: a frame
    // repaints only the chips that move or change, each just its own box,
    // and its dots are one image. (All chips in one SVG repainted every
    // chip, ~770 dot rects and every clip, on each frame of any animation; a
    // burst of clicks kept that going and dropped frames: worst 79–103 ms,
    // 21–42 frames over 20 ms in a 24-click burst. No forced GPU layer: that
    // rasters the labels once and stretches them under a canvas zoom.)
    interface ChipEls {
        wrap: HTMLDivElement | null
        sized: (SVGRectElement | null)[] // full-width layers, each in a fixed slot
        edge: SVGRectElement | null
        ring: SVGRectElement | null
        accent: SVGElement | null
        press: SVGRectElement | null
        plain: HTMLSpanElement | null
        lit: HTMLSpanElement | null
        rim: SVGRectElement | null
    }
    const chipEls = useRef<ChipEls[]>([])
    const els = (i: number): ChipEls => {
        if (!chipEls.current[i])
            chipEls.current[i] = { wrap: null, sized: [], edge: null, ring: null, accent: null, press: null, plain: null, lit: null, rim: null }
        return chipEls.current[i]
    }
    const [focusIdx, setFocusIdx] = useState(-1)
    const geo = useRef({ dev, pad, grow, gap, labelW, n, edgeW, ringW, H, pressMax: 0, rimW: 0, focusIdx })
    const rimW = hair(Math.max(0, adv.rimWidth))
    geo.current = { dev, pad, grow, gap, labelW, n, edgeW, ringW, H, pressMax: Math.max(0, adv.press) / 100, rimW, focusIdx }
    const draw = useRef(() => {})
    // Last values written, per chip: a frame writes only what changed, so a
    // chip that is only fading touches one value and a still neighbour none.
    const written = useRef<{ x: string; w: string; t: string; p: string; l: string; ring: string }[]>([])
    draw.current = () => {
        const g = geo.current
        const ms = motions.current
        const widths: number[] = []
        let total = 0
        for (let i = 0; i < g.n; i++) {
            const w = 2 * g.pad + (g.labelW[i] ?? 0) + Math.min(1, Math.max(0, ms[i]?.grow.get() ?? 0)) * g.grow
            widths.push(w)
            total += w
        }
        total += g.gap * Math.max(0, g.n - 1)
        const settled = ms.every((m) => !m.grow.isAnimating())
        const sn = (v: number) => (settled ? Math.round(v * g.dev) / g.dev : v)
        let x = -total / 2
        for (let i = 0; i < g.n; i++) {
            const r = chipEls.current[i]
            const m = ms[i]
            const btn = btnEls.current[i]
            if (!r || !m) continue
            const last = written.current[i] ?? (written.current[i] = { x: "", w: "", t: "", p: "", l: "", ring: "" })
            const x0 = sn(x)
            const w = sn(x + widths[i]) - x0
            const gr = Math.min(1, Math.max(0, m.grow.get()))
            const t = Math.min(1, Math.max(0, m.tint.get()))
            const xs = x0.toFixed(2)
            const ws = w.toFixed(2)
            if (xs !== last.x || ws !== last.w) {
                if (r.wrap) r.wrap.style.transform = `translateX(${xs}px)`
                // The hit area: a fixed box stretched to the chip by a
                // transform, so nothing is laid out per frame.
                if (btn) btn.style.transform = `translateX(${xs}px) scaleX(${(w / HIT_BASE).toFixed(5)})`
            }
            if (ws !== last.w) {
                for (const el of r.sized) el?.setAttribute("width", ws)
                r.edge?.setAttribute("width", Math.max(0, w - g.edgeW).toFixed(2))
                r.ring?.setAttribute("width", Math.max(0, w - g.ringW).toFixed(2))
                r.rim?.setAttribute("width", Math.max(0, w - g.rimW).toFixed(2))
            }
            const ring = g.focusIdx === i ? "1" : "0"
            if (ring !== last.ring) r.ring?.setAttribute("opacity", ring)
            const ts = t.toFixed(3)
            if (ts !== last.t) {
                if (r.accent) r.accent.style.opacity = Math.max(HIDDEN, t).toFixed(3)
                if (r.plain) r.plain.style.opacity = (1 - t).toFixed(3)
                if (r.lit) r.lit.style.opacity = Math.max(HIDDEN, t).toFixed(3)
            }
            const ps = (Math.min(1, Math.max(0, m.press.get())) * g.pressMax).toFixed(3)
            if (ps !== last.p) r.press?.setAttribute("opacity", ps)
            const ls = (g.pad + gr * g.grow).toFixed(2)
            if (ls !== last.l) {
                const lx = `translateX(${ls}px)`
                if (r.plain) r.plain.style.transform = lx
                if (r.lit) r.lit.style.transform = lx
            }
            last.x = xs
            last.w = ws
            last.t = ts
            last.p = ps
            last.l = ls
            last.ring = ring
            x += widths[i] + g.gap
        }
    }
    useEffect(() => {
        const run = () => draw.current()
        const kick = () => frame.render(run)
        const offs = motions.current.slice(0, n).flatMap((m) => [
            m.grow.on("change", kick),
            m.grow.on("animationComplete", kick),
            m.tint.on("change", kick),
            m.press.on("change", kick),
        ])
        return () => {
            offs.forEach((off) => off())
            cancelFrame(run)
        }
    }, [n])
    useIsoLayoutEffect(() => {
        // After a render the elements may be new: write everything once.
        written.current = []
        draw.current()
    })

    // ---------------------------------------------------------- input

    // The press shade doubles as the hover cue: a pointer resting on a chip shades it a little,
    // a press shades it fully.
    const hovered = useRef(-1)
    const pressTo = (i: number, on: boolean) => {
        const m = motions.current[i]
        if (!m) return
        const to = on ? 1 : hovered.current === i ? HOVER_SHADE : 0
        if (live.current.reduced) m.press.jump(to)
        else animate(m.press, to, { type: "tween", ease: "linear", duration: PRESS_FADE })
    }
    const onDown = (i: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return
        // No focus ring from a pointer; the press darkens the chip, as in the clip.
        e.preventDefault()
        pressTo(i, true)
    }
    const onFocus = (i: number) => (e: ReactFocusEvent<HTMLButtonElement>) => {
        let visible = true
        try {
            visible = e.currentTarget.matches(":focus-visible")
        } catch {
            // older engines: treat every focus as visible
        }
        if (visible) setFocusIdx(i)
    }

    // ---------------------------------------------------------- drawing

    const pitch = Math.max(0.5, adv.dotPitch) * k
    const dotSide = hair(Math.max(0, adv.dotSize))
    const checkY = (H - CHECK_H * k) / 2
    const checkPath = (() => {
        const s = CHECK_STROKE / 2
        const p = (xx: number, yy: number) => `${(checkL + xx * k).toFixed(3)} ${(checkY + yy * k).toFixed(3)}`
        return `M${p(s, 3.4)}L${p(2.9, CHECK_H - s)}L${p(CHECK_W - s, s)}`
    })()

    // Each chip's dots, painted once into an image in its own space (the
    // widest chip's box), centred on the chip at rest and carried on to the
    // right for it to widen over; the glass is clear, so a picked chip shows
    // the same dots. One image to draw where there were hundreds of rects;
    // rebuilt on geometry or colour changes only.
    const [dotImgs, setDotImgs] = useState<string[]>([])
    // Before paint, so a switch of Cover (or a remount) never shows a chip without its dots.
    useIsoLayoutEffect(() => {
        const Wd = Math.ceil(maxW * dev)
        const Hd = Math.ceil(H * dev)
        if (Wd < 1 || Hd < 1) return
        const s = Math.max(1, Math.round(dotSide * dev))
        const next = labelW.slice(0, n).map((lw) => {
            const cv = document.createElement("canvas")
            cv.width = Wd
            cv.height = Hd
            const ctx = cv.getContext("2d")
            if (!ctx) return ""
            ctx.fillStyle = col.dots
            for (const [x, y] of gridDots(2 * pad + lw, H, rad, pitch, dotSide, dev, maxW)) ctx.fillRect(Math.round(x * dev), Math.round(y * dev), s, s)
            return cv.toDataURL()
        })
        setDotImgs(next)
    }, [labelW, n, pad, maxW, H, rad, pitch, dev, dotSide, col.dots])
    const id = (s: string) => `${uid}-${s}`

    const chipSvg = (i: number) => {
        const r = els(i)
        const clipId = `${uid}-c${i}`
        const dotsImg = dotImgs[i]
        // Each full-width layer registers itself in its own slot from its ref.
        // Nothing here may reset the lists: React can run a render and then
        // throw it away (a state set to what it already was), and a list
        // cleared in that render would never be refilled, leaving the chip
        // unable to change width.
        const sized = (slot: number) => (el: SVGRectElement | null) => {
            r.sized[slot] = el
        }
        const svgStyle: CSSProperties = { position: "absolute", left: 0, top: 0, display: "block", overflow: "visible" }
        return (
            <>
                <svg aria-hidden="true" width={maxW} height={H} style={svgStyle} shapeRendering="geometricPrecision">
                    <defs>
                        {/* The chip's own shape: its dots run to its edge. */}
                        <clipPath id={clipId}>
                            <rect ref={sized(6)} x={0} y={0} width={0} height={H} rx={rad} ry={rad} />
                        </clipPath>
                    </defs>
                    <rect ref={sized(0)} x={0} y={0} width={0} height={H} rx={rad} ry={rad} fill={col.chip} />
                    <g clipPath={`url(#${clipId})`}>
                        {dotsImg && <image href={dotsImg} x={0} y={0} width={maxW} height={H} preserveAspectRatio="none" />}
                    </g>
                </svg>
                {/* The picked layer and its check, faded as one by CSS opacity: a
                    fade repaints this chip's box once, not a group buffer per
                    layer. Deliberately not a forced GPU layer: while the chip
                    widens its layers change size every frame, and re-rastering
                    a whole layer for that dropped frames (16 over 20 ms in a
                    fast burst on a slow CPU, against 0 without). Glass is
                    clear, so the chip and its dots below show through it. */}
                <svg
                    ref={(el) => {
                        r.accent = el
                    }}
                    aria-hidden="true"
                    data-part="accent"
                    width={maxW}
                    height={H}
                    style={{ ...svgStyle, opacity: HIDDEN }}
                    shapeRendering="geometricPrecision"
                >
                    {!glass && <rect ref={sized(1)} x={0} y={0} width={0} height={H} rx={rad} ry={rad} fill={col.solid} />}
                    {glass && (
                        <>
                            {/* Gradients run top to bottom in this chip's own space,
                                so a widening chip never rebuilds them. */}
                            <rect ref={sized(3)} x={0} y={0} width={0} height={H} rx={rad} ry={rad} fill={`url(#${id("tint")})`} />
                            <rect ref={sized(4)} x={0} y={0} width={0} height={H} rx={rad} ry={rad} fill={`url(#${id("sheen")})`} />
                            <rect ref={sized(5)} x={0} y={0} width={0} height={H} rx={rad} ry={rad} fill={`url(#${id("shade")})`} />
                            {/* Glass brightens toward its edges (light bent along the
                                walls): two soft bands inside the outline, clipped to the
                                chip so only their inner halves show. */}
                            <g clipPath={`url(#${clipId})`} fill="none" stroke={`url(#${id("glow")})`}>
                                <rect ref={sized(7)} x={0} y={0} width={0} height={H} rx={rad} ry={rad} strokeWidth={2.4 * k} />
                                <rect ref={sized(8)} x={0} y={0} width={0} height={H} rx={rad} ry={rad} strokeWidth={1.1 * k} />
                            </g>
                            {/* A diagonal glint near the left end, where the light enters. */}
                            <rect ref={sized(9)} x={0} y={0} width={0} height={H} rx={rad} ry={rad} fill={`url(#${id("glint")})`} />
                            <rect
                                ref={(el) => {
                                    r.rim = el
                                }}
                                x={rimW / 2}
                                y={rimW / 2}
                                width={0}
                                height={Math.max(0, H - rimW)}
                                rx={Math.max(0, rad - rimW / 2)}
                                ry={Math.max(0, rad - rimW / 2)}
                                fill="none"
                                stroke={`url(#${id("rim")})`}
                                strokeWidth={rimW}
                            />
                        </>
                    )}
                    <path
                        d={checkPath}
                        fill="none"
                        stroke={col.onAccent}
                        strokeWidth={CHECK_STROKE * k}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
                <svg aria-hidden="true" width={maxW} height={H} style={svgStyle} shapeRendering="geometricPrecision">
                    {/* The hairline sits inside: its own width less the stroke. */}
                    <rect
                        ref={(el) => {
                            r.edge = el
                        }}
                        x={edgeW / 2}
                        y={edgeW / 2}
                        width={0}
                        height={Math.max(0, H - edgeW)}
                        rx={Math.max(0, rad - edgeW / 2)}
                        fill="none"
                        stroke={col.edge}
                        strokeWidth={edgeW}
                    />
                    <rect
                        ref={(el) => {
                            r.press = el
                            r.sized[2] = el
                        }}
                        x={0}
                        y={0}
                        width={0}
                        height={H}
                        rx={rad}
                        ry={rad}
                        fill="#000000"
                        opacity={0}
                    />
                    {/* Keyboard focus ring, drawn here so the stretched hit box cannot distort it. */}
                    <rect
                        ref={(el) => {
                            r.ring = el
                        }}
                        x={-ringW / 2}
                        y={-ringW / 2}
                        width={0}
                        height={H + ringW}
                        rx={rad + ringW / 2}
                        ry={rad + ringW / 2}
                        fill="none"
                        stroke={col.onAccent}
                        strokeWidth={ringW}
                        opacity={0}
                    />
                </svg>
            </>
        )
    }

    // ---------------------------------------------------------- render

    const typeFace: CSSProperties = {
        position: "absolute",
        left: 0,
        top: 0,
        height: H,
        display: "flex",
        alignItems: "center",
        fontFamily: familyStack(family),
        fontWeight: f.fontWeight ?? 500,
        fontStyle: f.fontStyle,
        letterSpacing: f.letterSpacing,
        fontSize: px(textPt),
        lineHeight: 1,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
    }

    return (
        <div
            ref={rootRef}
            onPointerEnter={measureShown}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                aspectRatio: `${REF_W} / ${REF_H}`,
                overflow: "hidden",
                background,
                ...style,
            }}
        >
            {/* The labels' twins at MEASURE_PX, never seen: their widths size the chips. */}
            {items.map((c, i) => (
                <span
                    key={`m${i}`}
                    aria-hidden="true"
                    ref={(el) => {
                        labelEls.current[i] = el
                    }}
                    style={{ ...typeFace, height: "auto", fontSize: MEASURE_PX, visibility: "hidden" }}
                >
                    {c.label}
                </span>
            ))}
            <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transformOrigin: "0 0", transform: turn }}>
                {/* The glass's gradients, shared by every chip's SVG: the same four
                    layers as the other glass blocks, top to bottom in a chip's
                    own space. */}
                <svg aria-hidden="true" width={0} height={0} style={{ position: "absolute", left: 0, top: 0, overflow: "hidden" }}>
                    <defs>
                        <linearGradient id={id("tint")} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
                            <stop offset="0" stopColor={col.glass} />
                            <stop offset="1" stopColor={col.glass} stopOpacity={0.5} />
                        </linearGradient>
                        <linearGradient id={id("sheen")} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
                            <stop offset="0" stopColor="#FFFFFF" stopOpacity={adv.sheen / 100} />
                            <stop offset="0.36" stopColor="#FFFFFF" stopOpacity={(adv.sheen / 100) * 0.45} />
                            <stop offset="0.52" stopColor="#FFFFFF" stopOpacity={0} />
                        </linearGradient>
                        {/* Edge glow: brightest under the top edge, a little up from the foot. */}
                        <linearGradient id={id("glow")} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
                            <stop offset="0" stopColor="#FFFFFF" stopOpacity={(adv.rim / 100) * 0.16} />
                            <stop offset="0.5" stopColor="#FFFFFF" stopOpacity={(adv.rim / 100) * 0.05} />
                            <stop offset="1" stopColor="#FFFFFF" stopOpacity={(adv.rim / 100) * 0.12} />
                        </linearGradient>
                        {/* The glint: a soft diagonal band near the left end, in the chip's own space. */}
                        <linearGradient id={id("glint")} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={H * 1.8} y2={H * 0.9}>
                            <stop offset="0.3" stopColor="#FFFFFF" stopOpacity={0} />
                            <stop offset="0.42" stopColor="#FFFFFF" stopOpacity={(adv.sheen / 100) * 0.4} />
                            <stop offset="0.5" stopColor="#FFFFFF" stopOpacity={(adv.sheen / 100) * 0.12} />
                            <stop offset="0.56" stopColor="#FFFFFF" stopOpacity={(adv.sheen / 100) * 0.22} />
                            <stop offset="0.64" stopColor="#FFFFFF" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id={id("shade")} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
                            <stop offset="0.55" stopColor="#000000" stopOpacity={0} />
                            <stop offset="1" stopColor="#000000" stopOpacity={0.22} />
                        </linearGradient>
                        <linearGradient id={id("rim")} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
                            <stop offset="0" stopColor="#FFFFFF" stopOpacity={adv.rim / 100} />
                            <stop offset="0.25" stopColor="#FFFFFF" stopOpacity={(adv.rim / 100) * 0.3} />
                            <stop offset="0.6" stopColor="#FFFFFF" stopOpacity={(adv.rim / 100) * 0.1} />
                            <stop offset="1" stopColor="#FFFFFF" stopOpacity={(adv.rim / 100) * 0.55} />
                        </linearGradient>
                    </defs>
                </svg>
                {items.map((c, i) => (
                    <div
                        key={`chip${i}`}
                        ref={(el) => {
                            els(i).wrap = el
                        }}
                        aria-hidden="true"
                        style={{
                            position: "absolute",
                            left: 0,
                            top: -H / 2,
                            width: maxW,
                            height: H,
                            pointerEvents: "none",
                        }}
                    >
                        {chipSvg(i)}
                        <span
                            ref={(el) => {
                                shownEls.current[i] = el
                                els(i).plain = el
                            }}
                            style={{ ...typeFace, color: textColor }}
                        >
                            {c.label}
                        </span>
                        <span
                            ref={(el) => {
                                els(i).lit = el
                            }}
                            style={{ ...typeFace, color: col.onAccent, opacity: HIDDEN }}
                        >
                            {c.label}
                        </span>
                    </div>
                ))}
                {items.map((c, i) => (
                    <button
                        key={`hit${i}`}
                        type="button"
                        aria-pressed={picked.current[i] ?? false}
                        aria-label={c.label}
                        ref={(el) => {
                            btnEls.current[i] = el
                        }}
                        onPointerDown={onDown(i)}
                        onPointerEnter={(e) => {
                            if (e.pointerType !== "mouse") return
                            hovered.current = i
                            pressTo(i, false)
                        }}
                        onPointerUp={() => pressTo(i, false)}
                        onPointerLeave={() => {
                            hovered.current = -1
                            pressTo(i, false)
                        }}
                        onPointerCancel={() => pressTo(i, false)}
                        onClick={() => toggle(i)}
                        onFocus={onFocus(i)}
                        onBlur={() => setFocusIdx(-1)}
                        style={{
                            position: "absolute",
                            left: 0,
                            top: -H / 2,
                            width: HIT_BASE,
                            height: H,
                            padding: 0,
                            margin: 0,
                            border: "none",
                            borderRadius: 0,
                            background: "transparent",
                            outline: "none",
                            cursor: "pointer",
                            transformOrigin: "0 0",
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                            userSelect: "none",
                            WebkitUserSelect: "none",
                        }}
                    />
                ))}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------- controls

// Control order arranged in the builder.

