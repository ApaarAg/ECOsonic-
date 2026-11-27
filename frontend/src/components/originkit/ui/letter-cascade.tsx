/* eslint-disable */
// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

// Delivered by Originkit · stack: framer
// Paste into a Framer code component. Property controls included.
import * as React from "react"
import { useCallback, useEffect, useRef } from "react"
import { motion, stagger, useAnimate, useReducedMotion } from "framer-motion"
import type { AnimationOptions } from "framer-motion"

/**
 * Letter Cascade: a word that turns over letter by letter. On hover each
 * letter tips back and away while a fresh copy flips up from below to take
 * its place, staggered from the first letter, the last or the centre, on a
 * spring. Tap, focus or Enter play it too, and it can replay on its own.
 *
 * Based on Letter Cascade from Componentry (componentry.dev) by Harsh Jadhav, MIT licensed.
 *
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 * @framerIntrinsicWidth 1100
 * @framerIntrinsicHeight 600
 */

type From = "first" | "last" | "center"

interface LetterCascadeProps {
    text: string
    font?: (React.CSSProperties & { variant?: string; loadGoogleFont?: boolean }) | undefined
    fontSize?: number | string
    weight?: number | string
    color?: string
    background?: string
    stagger?: number
    from?: From
    stiffness?: number
    damping?: number
    trigger?: "hover" | "click" | "reveal"
    autoplay?: boolean
    interval?: number
    onComplete?: () => void
    style?: React.CSSProperties
    className?: string
    variant?: "flip" | "reveal"
    revealKey?: string | number | boolean
    align?: "left" | "center"
    inline?: boolean
}

// No `filter` in any state: the old blur(4px) smeared the letters mid-flip, and the
// blur(0px) it left at rest still put every glyph in a filter layer, which drops the
// text to soft grayscale anti-aliasing. Without it the resting word is plain text.
const FRONT_REST = { rotateX: 0, opacity: 1, y: 0 }
const FRONT_GONE = { rotateX: 90, opacity: 0, y: -6 }
const ECHO_REST = { rotateX: 0, opacity: 1, y: 0, scale: 1 }
const ECHO_HIDDEN = { rotateX: -90, opacity: 0, y: 6, scale: 0.8 }

const DEFAULT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

/** A picked family, backed by the default stack; a bare name is quoted. */
function fontStack(family: unknown) {
    if (typeof family !== "string" || !family.trim()) return DEFAULT_FAMILY
    const f = family.trim()
    return /[,"']/.test(f) ? `${f}, ${DEFAULT_FAMILY}` : `"${f}", ${DEFAULT_FAMILY}`
}

/**
 * Fetch a family picked in the Font row into the document this renders in. The
 * builder loads fonts into its own page only (and only 300-700), so a preview in an
 * iframe stayed in the fallback face. Same link id as the builder, so never added
 * twice; a family Google does not serve just errors and falls back.
 */
function loadFamily(doc: Document, family: unknown) {
    const fam = String(family ?? "").split(",")[0].trim().replace(/["']/g, "")
    if (!fam || /^(ui-|system-ui|-apple-system|sans-serif|serif|monospace)/i.test(fam) || !doc.head) return
    const id = `gf-${fam.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    if (doc.getElementById(id)) return
    const link = doc.createElement("link")
    link.id = id
    link.rel = "stylesheet"
    link.href = `https://fonts.googleapis.com/css?family=${encodeURIComponent(fam)}:100,200,300,400,500,600,700,800,900&display=swap`
    doc.head.appendChild(link)
}

export default function LetterCascade(props: LetterCascadeProps) {
    const {
        text,
        fontSize,
        weight,
        background = "transparent",
        from = "first",
        stiffness = 220,
        damping = 20,
        trigger = "hover",
        autoplay = false,
        interval = 3,
        onComplete,
        style,
        className = "",
        variant = "flip",
        revealKey,
        align = "center",
        inline = false,
    } = props
    const color = props.color || (variant === "reveal" ? "inherit" : "#f7f7f7")
    const step = props.stagger ?? (variant === "reveal" ? 10 : 40)
    const font = props.font || {}
    const italic = font.fontStyle === "italic" || /italic/i.test(String(font.variant ?? ""))
    const reduce = useReducedMotion()
    const [scope, animate] = useAnimate()
    const busy = useRef(false)
    const lastRevealKey = useRef<string | number | boolean | undefined>(undefined)

    const effectiveSize = fontSize ?? font.fontSize
    const effectiveWeight = weight ?? font.fontWeight

    useEffect(() => {
        const el = scope.current as HTMLElement | null
        if (el && font.loadGoogleFont) loadFamily(el.ownerDocument, font.fontFamily)
    }, [font.fontFamily, font.loadGoogleFont, scope])

    const play = useCallback(async () => {
        if (busy.current || reduce || !scope.current || variant === "reveal") return
        busy.current = true
        const opts: AnimationOptions = { type: "spring", stiffness, damping, delay: stagger(step / 1000, { from }) }
        await Promise.all([animate(".lc-front", FRONT_GONE, opts), animate(".lc-echo", ECHO_REST, opts)])
        if (!scope.current) return
        await Promise.all([animate(".lc-front", FRONT_REST, { duration: 0 }), animate(".lc-echo", ECHO_HIDDEN, { duration: 0 })])
        busy.current = false
        onComplete?.()
    }, [animate, scope, reduce, variant, stiffness, damping, step, from, onComplete])

    // Controlled once-per-act-entry stagger reveal (no replay on minor scroll increments, no layout shift)
    useEffect(() => {
        if (variant !== "reveal" || !scope.current) return
        if (lastRevealKey.current === revealKey && revealKey !== undefined) return
        lastRevealKey.current = revealKey

        if (reduce) {
            void animate(".lc-front", { opacity: 1, y: 0, rotateX: 0 }, { duration: 0 })
            return
        }

        const run = async () => {
            try {
                await animate(".lc-front", { opacity: 0, y: 10, rotateX: 20 }, { duration: 0 })
                if (!scope.current) return
                await animate(
                    ".lc-front",
                    { opacity: 1, y: 0, rotateX: 0 },
                    {
                        type: "spring",
                        stiffness: 320,
                        damping: 28,
                        delay: stagger(Math.min(step, 5) / 1000, { from }),
                    },
                )
                onComplete?.()
            } catch {
                // Ignore cancellation on fast act transition or unmount
            }
        }
        void run()
    }, [animate, from, onComplete, reduce, revealKey, scope, step, variant])

    useEffect(() => {
        const el = scope.current as HTMLElement | null
        if (!autoplay || variant === "reveal" || reduce || !el || typeof IntersectionObserver !== "function") return
        const period = Math.max(800, interval * 1000)
        let visible = true
        let alive = true
        let id: ReturnType<typeof setTimeout>
        const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
        io.observe(el)
        const tick = async () => {
            const start = performance.now()
            if (visible) await play()
            if (alive) id = setTimeout(tick, Math.max(0, start + period - performance.now()))
        }
        id = setTimeout(tick, period)
        return () => {
            alive = false
            clearTimeout(id)
            io.disconnect()
        }
    }, [autoplay, interval, reduce, play, scope, variant])

    const words = text.split(" ")

    const glyphs = (
        <span
            ref={scope}
            onMouseEnter={trigger === "hover" && variant === "flip" ? play : undefined}
            onClick={variant === "flip" ? play : undefined}
            className={variant === "reveal" || inline ? className : undefined}
            style={{
                position: "relative",
                display: "inline-flex",
                flexWrap: "wrap",
                justifyContent: align === "left" ? "flex-start" : "center",
                maxWidth: "100%",
                ...(effectiveSize !== undefined ? { fontSize: effectiveSize } : {}),
                ...(effectiveWeight !== undefined ? { fontWeight: effectiveWeight } : {}),
                ...(font.letterSpacing !== undefined ? { letterSpacing: font.letterSpacing } : {}),
                ...(font.fontFamily ? { fontFamily: fontStack(font.fontFamily) } : {}),
                ...(italic ? { fontStyle: "italic" } : {}),
                ...(color !== "inherit" ? { color } : {}),
                textRendering: "optimizeLegibility",
                cursor: variant === "flip" ? "pointer" : "inherit",
                userSelect: variant === "flip" ? "none" : "auto",
                outline: "none",
                ...(variant === "reveal" || inline ? style : {}),
            }}
        >
            <span
                style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: "hidden",
                    clipPath: "inset(50%)",
                    whiteSpace: "nowrap",
                    border: 0,
                }}
            >
                {text}
            </span>
            {words.map((word, wi) => (
                <span key={wi} aria-hidden="true" style={{ display: "inline-flex", whiteSpace: "nowrap" }}>
                    {Array.from(wi < words.length - 1 ? word + " " : word).map((ch, i) => (
                        <span
                            key={i}
                            aria-hidden="true"
                            style={{
                                position: "relative",
                                display: "inline-flex",
                                whiteSpace: "pre",
                                perspective: 500,
                            }}
                        >
                            <motion.span
                                className="lc-front"
                                style={{
                                    display: "inline-block",
                                    rotateX: 0,
                                    y: 0,
                                    opacity: 1,
                                    transformOrigin: "bottom center",
                                    willChange: variant === "reveal" ? "transform, opacity" : undefined,
                                }}
                            >
                                {ch}
                            </motion.span>
                            {variant === "flip" ? (
                                <motion.span
                                    className="lc-echo"
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        display: "inline-block",
                                        ...ECHO_HIDDEN,
                                        transformOrigin: "top center",
                                    }}
                                >
                                    {ch}
                                </motion.span>
                            ) : null}
                        </span>
                    ))}
                </span>
            ))}
        </span>
    )

    if (variant === "reveal" || inline) {
        return glyphs
    }

    return (
        <div
            className={className}
            style={{
                width: "100%",
                height: "100%",
                ...style,
                display: "flex",
                alignItems: "center",
                justifyContent: align === "left" ? "flex-start" : "center",
                boxSizing: "border-box",
                padding: "16px 24px",
                background,
            }}
        >
            {glyphs}
        </div>
    )
}

// Default prop fallbacks are handled directly inside LetterCascade destructuring.
