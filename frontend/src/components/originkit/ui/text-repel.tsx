/* eslint-disable */
// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

// Delivered by Originkit · stack: framer
    // Paste into a Framer code component. Property controls included.
    import * as React from "react"
    import { useEffect, useRef } from "react"
    import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion"
    import type { MotionValue } from "framer-motion"

    /**
     * Text Repel: big type that scatters from the pointer. Every letter inside the
     * radius is pushed away (or pulled in) with a quadratic falloff, tilts a
     * little with the push, and springs home when the pointer moves on. Until the
     * pointer arrives a ghost cursor drifts through the text so the effect reads
     * at a glance. Words never break across lines.
     *
     * Based on Text Repel from Componentry (componentry.dev) by Harsh Jadhav, MIT licensed.
     *
     * @framerSupportedLayoutWidth fixed
     * @framerSupportedLayoutHeight fixed
     * @framerIntrinsicWidth 480
     * @framerIntrinsicHeight 320
     */

    type Mode = "repel" | "attract"
    const MODES: Mode[] = ["repel", "attract"]

    interface TextRepelProps {
        text: string
        font: React.CSSProperties & { variant?: string }
        weight: number
        color: string
        background: string
        strength: number
        mode: Mode
        stiffness: number
        damping: number
        mass: number
        demo: boolean
        style?: React.CSSProperties
    }

    const FAR = -9999
    const PAD = 24

    const DEFAULT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
    // The Font control brings family, size, style and spacing; weight comes from its own control.
    const FONT = { variant: "Semibold", fontWeight: 600, fontSize: "72px", letterSpacing: "-0.03em" }
    // Pointer reach as a multiple of the font size (the original 120px reach at 72px type),
    // so the push covers the same share of each letter at any size.
    const REACH = 120 / 72

    /** A picked family, backed by the default stack; a bare name is quoted. */
    function fontStack(family: unknown) {
        if (typeof family !== "string" || !family.trim()) return DEFAULT_FAMILY
        const f = family.trim()
        return /[,"']/.test(f) ? `${f}, ${DEFAULT_FAMILY}` : `"${f}", ${DEFAULT_FAMILY}`
    }

    /**
     * A family picked from the Font dropdown must actually load in the document the
     * component renders in (the builder draws some stages in iframes, so its own link
     * on the parent page never reaches the text, which then sat in the fallback face).
     * Same link id as the builder, so the stylesheet is never added twice. A family
     * Google does not serve just errors and falls through; Framer loads its own fonts.
     */
    function loadFamily(doc: Document, family: unknown): Promise<void> {
        const fam = String(family ?? "").split(",")[0].trim().replace(/["']/g, "")
        if (!fam || /^(ui-sans-serif|system-ui|sans-serif|serif|monospace|cursive|fantasy|inherit)$/i.test(fam) || !doc.head) return Promise.resolve()
        const id = `gf-${fam.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
        let link = doc.getElementById(id) as HTMLLinkElement | null
        if (!link) {
            link = doc.createElement("link")
            link.id = id
            link.rel = "stylesheet"
            link.href = `https://fonts.googleapis.com/css?family=${encodeURIComponent(fam)}:100,200,300,400,500,600,700,800,900,100i,200i,300i,400i,500i,600i,700i,800i,900i&display=swap`
            doc.head.appendChild(link)
        }
        if (link.sheet) return Promise.resolve()
        const l = link
        return new Promise((done) => {
            l.addEventListener("load", () => done(), { once: true })
            l.addEventListener("error", () => done(), { once: true })
        })
    }

    interface LetterProps {
        letter: string
        pointerX: MotionValue<number>
        pointerY: MotionValue<number>
        radius: number
        strength: number
        mode: Mode
        stiffness: number
        damping: number
        mass: number
        /** Bumped when the layout changes so each letter re-reads its resting centre. */
        layoutKey: number
    }

    function Letter({ letter, pointerX, pointerY, radius, strength, mode, stiffness, damping, mass, layoutKey }: LetterProps) {
        const ref = useRef<HTMLSpanElement>(null)
        const origin = useRef({ x: 0, y: 0 })

        const x = useMotionValue(0)
        const y = useMotionValue(0)
        const springX = useSpring(x, { stiffness, damping, mass })
        const springY = useSpring(y, { stiffness, damping, mass })
        // A slight tilt that follows the sideways push.
        const rotate = useTransform(springX, (v) => v * 0.3)

        // offsetLeft/Top ignore transforms, so the resting centre stays true while the letter moves.
        useEffect(() => {
            let el: HTMLElement | null = ref.current
            if (!el) return
            let ox = el.offsetWidth / 2
            let oy = el.offsetHeight / 2
            while (el && !el.hasAttribute("data-tr-field")) {
                ox += el.offsetLeft
                oy += el.offsetTop
                el = el.offsetParent as HTMLElement | null
            }
            origin.current = { x: ox, y: oy }
        }, [layoutKey])

        useEffect(() => {
            const update = () => {
                const dx = origin.current.x - pointerX.get()
                const dy = origin.current.y - pointerY.get()
                const dist = Math.hypot(dx, dy)
                if (dist > 0 && dist < radius) {
                    const force = (1 - dist / radius) ** 2 * strength * (mode === "attract" ? -1 : 1)
                    const angle = Math.atan2(dy, dx)
                    x.set(Math.cos(angle) * force)
                    y.set(Math.sin(angle) * force)
                } else {
                    x.set(0)
                    y.set(0)
                }
            }
            const offX = pointerX.on("change", update)
            const offY = pointerY.on("change", update)
            return () => {
                offX()
                offY()
            }
        }, [pointerX, pointerY, radius, strength, mode, x, y])

        // No will-change: it froze each letter as its own bitmap at layout size, so under the
        // builder's / canvas's CSS scale the glyphs were resampled (hazy) and snapped to whole
        // layer pixels (uneven, dashed-looking gaps). Without it the text is rastered at the
        // scale it is shown.
        return (
            <motion.span ref={ref} aria-hidden style={{ x: springX, y: springY, rotate, display: "inline-block" }}>
                {letter}
            </motion.span>
        )
    }

    /** Font sizes arrive as "48px", a bare number, or rem/em; anything unreadable is null. */
    function pxOf(v: unknown): number | null {
        if (typeof v === "number" && isFinite(v) && v > 0) return v
        if (typeof v !== "string") return null
        const m = v.trim().match(/^([\d.]+)\s*(px|rem|em)?$/i)
        if (!m) return null
        const n = parseFloat(m[1])
        if (!isFinite(n) || n <= 0) return null
        return m[2] && m[2].toLowerCase() !== "px" ? n * 16 : n
    }

    const VARIANT_WEIGHTS: [RegExp, number][] = [
        [/thin|hairline/i, 100],
        [/extra\s*light|ultra\s*light/i, 200],
        [/light/i, 300],
        [/medium/i, 500],
        [/semi\s*bold|demi\s*bold/i, 600],
        [/extra\s*bold|ultra\s*bold/i, 800],
        [/black|heavy/i, 900],
        [/bold/i, 700],
        [/regular|normal|book|italic/i, 400],
    ]

    /** The Font row's weight: its fontWeight when readable, else the one its style name implies. */
    function weightOf(font: { fontWeight?: unknown; variant?: string }): number | null {
        const w = Number(font.fontWeight)
        if (isFinite(w) && w >= 1 && w <= 1000) return w
        const v = String(font.variant ?? "")
        for (const [re, n] of VARIANT_WEIGHTS) if (re.test(v)) return n
        return null
    }

    export default function TextRepel(props: TextRepelProps) {
        const { text, weight, color, background, strength, stiffness, damping, mass, demo, style } = props
        // An unknown or stale mode falls back to repel, the default.
        const mode: Mode = MODES.includes(props.mode) ? props.mode : "repel"
        const font = props.font || {}
        // Size comes from the Font row; px, a bare number, or rem/em (16px each); anything unreadable is 72.
        const fontSize = pxOf(font.fontSize) ?? 72
        // Two places set the weight: the Font row's style (e.g. Black) and the Weight slider.
        // Whichever was changed last wins; at first the Font row's own weight counts as picked.
        const fontWeight = weightOf(font)
        const weightRef = useRef<{ prop: number; font: number | null; value: number } | null>(null)
        if (!weightRef.current) {
            weightRef.current = { prop: weight, font: fontWeight, value: fontWeight ?? weight }
        } else if (weight !== weightRef.current.prop) {
            weightRef.current = { prop: weight, font: fontWeight, value: weight }
        } else if (fontWeight !== weightRef.current.font) {
            weightRef.current = { prop: weight, font: fontWeight, value: fontWeight ?? weight }
        }
        const shownWeight = weightRef.current.value || 600
        const lineHeight = font.lineHeight ?? 1.05
        const align = font.textAlign ?? "center"
        const radius = fontSize * REACH
        const family = fontStack(font.fontFamily)
        const italic = font.fontStyle === "italic" || /italic/i.test(String(font.variant ?? ""))
        const tracking = font.letterSpacing ?? "-0.03em"
        const reduce = useReducedMotion()
        const fieldRef = useRef<HTMLDivElement>(null)
        const pointerX = useMotionValue(FAR)
        const pointerY = useMotionValue(FAR)
        const [layoutKey, setLayoutKey] = React.useState(0)
        const touched = useRef(false)

        // Re-measure letter centres whenever the field reflows (frame resize, font load, prop change).
        useEffect(() => {
            const el = fieldRef.current
            if (!el) return
            const fonts = el.ownerDocument.fonts
            const bump = () => setLayoutKey((k) => k + 1)
            const ro = new ResizeObserver(bump)
            ro.observe(el)
            // A webfont picked later can land without resizing the field, so listen for every load too.
            fonts?.ready.then(bump)
            fonts?.addEventListener?.("loadingdone", bump)
            return () => {
                ro.disconnect()
                fonts?.removeEventListener?.("loadingdone", bump)
            }
        }, [])
        useEffect(() => setLayoutKey((k) => k + 1), [text, fontSize, shownWeight, family, italic, tracking, lineHeight, align])

        // Load the picked family into the document the text renders in, then re-measure.
        useEffect(() => {
            const el = fieldRef.current
            if (!el) return
            const doc = el.ownerDocument
            let live = true
            const face = `${italic ? "italic " : ""}${shownWeight} ${fontSize}px ${family}`
            loadFamily(doc, font.fontFamily)
                .then(() => doc.fonts?.load(face))
                .then(() => live && setLayoutKey((k) => k + 1), () => {})
            return () => {
                live = false
            }
        }, [font.fontFamily, family, shownWeight, fontSize, italic])

        // Ghost cursor: a slow figure-eight through the text until a real pointer shows up.
        useEffect(() => {
            const el = fieldRef.current
            if (!el || !demo || reduce) return
            touched.current = false
            let raf = 0
            let visible = true
            const t0 = performance.now()
            const frame = (now: number) => {
                if (touched.current) return
                const t = (now - t0) / 1000
                const w = el.offsetWidth
                const h = el.offsetHeight
                pointerX.set(w / 2 + Math.sin(t * 0.7) * w * 0.42)
                pointerY.set(h / 2 + Math.sin(t * 1.4) * h * 0.22)
                raf = visible ? requestAnimationFrame(frame) : 0
            }
            const io = new IntersectionObserver(([e]) => {
                visible = e.isIntersecting
                if (visible && !raf && !touched.current) raf = requestAnimationFrame(frame)
            })
            io.observe(el)
            raf = requestAnimationFrame(frame)
            return () => {
                cancelAnimationFrame(raf)
                io.disconnect()
                pointerX.set(FAR)
                pointerY.set(FAR)
            }
        }, [demo, reduce, pointerX, pointerY])

        const onPointerMove = (e: React.PointerEvent) => {
            const el = fieldRef.current
            if (!el || reduce) return
            touched.current = true
            // Pointer coordinates are on screen; letter centres are in layout pixels. Undo any outer scale.
            const r = el.getBoundingClientRect()
            const k = r.width ? el.offsetWidth / r.width : 1
            pointerX.set((e.clientX - r.left) * k)
            pointerY.set((e.clientY - r.top) * k)
        }

        const leave = () => {
            pointerX.set(FAR)
            pointerY.set(FAR)
        }

        const words = text.split(" ")

        return (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    ...style,
                    position: "relative",
                    overflow: "hidden",
                    background,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxSizing: "border-box",
                    padding: PAD,
                }}
            >
                <div
                    ref={fieldRef}
                    data-tr-field
                    aria-label={text}
                    role="img"
                    onPointerMove={onPointerMove}
                    onPointerLeave={leave}
                    onPointerCancel={leave}
                    style={{
                        position: "relative",
                        maxWidth: "100%",
                        textAlign: align,
                        fontSize,
                        fontWeight: shownWeight,
                        lineHeight,
                        letterSpacing: tracking,
                        color,
                        fontFamily: family,
                        fontStyle: italic ? "italic" : "normal",
                        cursor: "default",
                        userSelect: "none",
                        WebkitUserSelect: "none",
                        touchAction: "pan-y",
                        // Pad the field by a radius' worth so the push starts before the pointer reaches a letter.
                        margin: -PAD,
                        padding: PAD,
                    }}
                >
                    {words.map((word, wi) => (
                        <React.Fragment key={wi}>
                            <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>
                                {reduce
                                    ? word
                                    : Array.from(word).map((ch, ci) => (
                                        <Letter
                                            key={ci}
                                            letter={ch}
                                            pointerX={pointerX}
                                            pointerY={pointerY}
                                            radius={radius}
                                            strength={strength}
                                            mode={mode}
                                            stiffness={stiffness}
                                            damping={damping}
                                            mass={mass}
                                            layoutKey={layoutKey}
                                        />
                                    ))}
                            </span>
                            {wi < words.length - 1 ? " " : null}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        )
    }

    TextRepel.defaultProps = {
        text: "Push me away",
        font: FONT,
        weight: 600,
        color: "#141413",
        background: "transparent",
        strength: 45,
        mode: "repel",
        stiffness: 180,
        damping: 14,
        mass: 0.4,
        demo: true,
    }

    // Control order arranged in the builder.
    