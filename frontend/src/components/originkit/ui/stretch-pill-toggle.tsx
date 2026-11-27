/* eslint-disable */
// Delivered by Originkit · stack: nextjs · styling: tailwind
// Set these props to match the Originkit preview:
//   advanced={{"labelOn":"#1C1C1E","labelOff":"#5E6066","knobShadow":15,"trackShadow":9}}
"use client";

// Delivered by Originkit · stack: framer
// Paste into a Framer code component. Property controls included.
import * as React from "react"
import { useEffect, useRef } from "react"
/** Tuning values. Stripped at publish; the tuned values are baked in here. */
const ADVANCED_DEFAULTS = {
    trackHeight: 45,
    knobWidth: 57,
    knobInset: 38,
    travelMs: 200,
    colorMs: 300,
    stretchLead: 70,
    knobEdgeOn: "#466EB0",
    knobEdgeOff: "#9EA3AA",
    edgeWidth: 2,
    trackShadow: 9,
    knobShadow: 15,
    innerShade: 14,
    loopMs: 9140,
    resumeMs: 2500,
    grain: 0,
    vignette: 0,
}

/** Placement: moves the toggle inside its frame, as a share of the frame. */
const DEFAULT_PLACEMENT = { x: 0, y: 0 }

/** Style → Glass group. The knob turns to liquid glass, after the iOS 26 switch. */
const DEFAULT_GLASS = {
    show: "moving",
    swell: 140,
    refraction: 60,
    highlight: 70,
    dispersion: 30,
}
// The glass knob lifts on a slightly underdamped spring (the iOS switch overshoots a touch as it
// swells into glass) and settles back without one.
const GLASS_OMEGA = 26 // rad/s
const GLASS_ZETA_UP = 0.5
const GLASS_ZETA_DOWN = 0.78
const GLASS_LINGER_MS = 110 // the knob stays glass this long after it lands
const DRAG_SLOP = 4 // px of travel before a press on the glass knob becomes a drag

// Liquid glass lens, drawn in WebGL over the knob only. What sits behind the knob is known exactly
// (the page colour and the track capsule), so the refraction is computed rather than sampled from
// the page: it looks the same in every browser, where backdrop-filter lenses are Chromium-only.
const GLASS_VS = `
attribute vec2 aPos;
uniform vec4 uBox;
uniform vec2 uSize;
varying vec2 vP;
void main() {
    vec2 p = uBox.xy + aPos * uBox.zw;
    vP = p;
    vec2 c = p / uSize * 2.0 - 1.0;
    gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`
const GLASS_FS = `
precision highp float;
varying vec2 vP;
uniform float uScale;
uniform vec4 uTrack;
uniform vec4 uTrackCol;
uniform vec4 uBg;
uniform vec4 uKnob;
uniform float uAlpha;
uniform float uRefr;
uniform float uHi;
uniform float uDisp;
float sdPill(vec2 p, vec2 b) {
    float r = min(b.x, b.y);
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// What lies behind the lens, premultiplied: the track capsule over the page colour.
vec4 scene(vec2 q) {
    float d = sdPill(q - (uTrack.xy + uTrack.zw * 0.5), uTrack.zw * 0.5);
    float a = clamp(0.5 - d * uScale, 0.0, 1.0) * uTrackCol.a;
    vec4 bg = vec4(uBg.rgb * uBg.a, uBg.a);
    return vec4(uTrackCol.rgb * a, a) + bg * (1.0 - a);
}
void main() {
    vec2 p = vP - uKnob.xy;
    vec2 hb = uKnob.zw;
    float kr = min(hb.x, hb.y);
    float d = sdPill(p, hb);
    float inside = clamp(0.5 - d * uScale, 0.0, 1.0);
    float ds = sdPill(p - vec2(0.0, kr * 0.16), hb * 0.98);
    float shadow = 0.16 * (1.0 - smoothstep(-kr * 0.2, kr * 0.55, ds));
    vec4 outc = vec4(0.0, 0.0, 0.0, shadow * (1.0 - inside));
    if (inside > 0.0) {
        float e = 0.5;
        vec2 n = vec2(sdPill(p + vec2(e, 0.0), hb) - sdPill(p - vec2(e, 0.0), hb),
                      sdPill(p + vec2(0.0, e), hb) - sdPill(p - vec2(0.0, e), hb));
        n = n / max(length(n), 1e-4);
        float t = max(-d, 0.0);
        // Rounded bevel: flat in the middle, curling down over the outer part of the radius.
        float u = clamp(1.0 - t / (kr * 0.42), 0.0, 1.0);
        float bend = 1.0 - sqrt(max(0.0, 1.0 - u * u));
        // The bevel pulls in what lies just past the edge (the iOS lens look); the middle magnifies
        // a touch and is otherwise clear.
        vec2 off = n * bend * uRefr * kr * 0.5;
        vec2 base = uKnob.xy + p * (1.0 - 0.04 * uRefr) + off;
        vec2 dv = off * uDisp * 0.35;
        vec4 sg = scene(base);
        vec3 col = vec3(scene(base + dv).r, sg.g, scene(base - dv).b);
        float a = sg.a;
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = max(mix(vec3(l), col, 1.08) * 1.03 + 0.02 * a, 0.0);
        // Light on the rim: key from the top left, a weaker kick from the bottom right, a hairline
        // all the way round and a faint fresnel lift toward the edge.
        vec2 ld = normalize(vec2(-0.55, -0.83));
        float rim = pow(u, 3.0);
        float spec = (pow(max(dot(n, ld), 0.0), 2.0) + 0.55 * pow(max(dot(n, -ld), 0.0), 2.0)) * rim;
        float line = clamp(1.0 - t * uScale / 1.4, 0.0, 1.0) * 0.35;
        float w = clamp(uHi * (spec * 0.8 + line + 0.06 * u * u), 0.0, 1.0);
        col = vec3(w) + col * (1.0 - w);
        a = w + a * (1.0 - w);
        outc = vec4(min(col, vec3(a)), a) * inside + outc * (1.0 - inside);
    }
    gl_FragColor = outc * uAlpha;
}`

type GlassGL = {
    gl: WebGLRenderingContext
    u: Record<string, WebGLUniformLocation | null>
}
function createGlassGL(canvas: HTMLCanvasElement): GlassGL | null {
    let gl: WebGLRenderingContext | null = null
    try {
        gl = canvas.getContext("webgl", {
            alpha: true,
            premultipliedAlpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: "low-power",
            preserveDrawingBuffer: false,
        }) as WebGLRenderingContext | null
    } catch (e) {}
    if (!gl) return null
    const compile = (type: number, src: string) => {
        const sh = gl!.createShader(type)!
        gl!.shaderSource(sh, src)
        gl!.compileShader(sh)
        return sh
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, GLASS_VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, GLASS_FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, "aPos")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const u: Record<string, WebGLUniformLocation | null> = {}
    for (const n of ["uBox", "uSize", "uScale", "uTrack", "uTrackCol", "uBg", "uKnob", "uAlpha", "uRefr", "uHi", "uDisp"])
        u[n] = gl.getUniformLocation(prog, n)
    return { gl, u }
}

// Autoplay schedule, read from the reference clip (seconds within a 9.14 s loop).
const REF_LOOP = 9.14
const SCHEDULE: [number, string][] = [
    [0.27, "off"],
    [0.87, "on"],
    [1.47, "off"],
    [2.67, "on"],
    [3.8, "off"],
    [5.8, "on"],
    [6.38, "off"],
    [6.95, "on"],
    [7.45, "off"],
    [8.85, "on"],
]

const GRAIN_URL = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const px = (n: number) => `${n}px`

function makeBezier(x1: number, y1: number, x2: number, y2: number) {
    const sample = (u: number, a: number, b: number) =>
        3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u
    const deriv = (u: number, a: number, b: number) =>
        3 * a * (1 - u) * (1 - u) + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u * u
    return (t: number) => {
        if (t <= 0) return 0
        if (t >= 1) return 1
        let u = t
        for (let i = 0; i < 8; i++) {
            const d = deriv(u, x1, x2)
            if (Math.abs(d) < 1e-6) break
            u = clamp01(u - (sample(u, x1, x2) - t) / d)
        }
        return sample(u, y1, y2)
    }
}
const EASE = makeBezier(0.45, 0, 0.55, 1)

const colorCache = new Map<string, number[]>()
function parseColor(input: any): number[] {
    const key = String(input ?? "")
    const hit = colorCache.get(key)
    if (hit) return hit
    let s = key.trim()
    const v = s.match(/^var\([^,]+,\s*(.+)\)$/)
    if (v) s = v[1].trim()
    let out = [0, 0, 0, 1]
    if (s[0] === "#") {
        let h = s.slice(1)
        if (h.length === 3 || h.length === 4) h = h.split("").map((ch) => ch + ch).join("")
        const n = parseInt(h.slice(0, 6), 16) || 0
        const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
        out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]
    } else {
        const m = s.match(/rgba?\(([^)]+)\)/)
        if (m) {
            const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat)
            out = [p[0] || 0, p[1] || 0, p[2] || 0, p[3] ?? 1]
        }
    }
    if (colorCache.size > 200) colorCache.clear()
    colorCache.set(key, out)
    return out
}
function mixColor(a: any, b: any, t: number) {
    const A = parseColor(a)
    const B = parseColor(b)
    const k = clamp01(t)
    const r = Math.round(A[0] + (B[0] - A[0]) * k)
    const g = Math.round(A[1] + (B[1] - A[1]) * k)
    const bl = Math.round(A[2] + (B[2] - A[2]) * k)
    const al = A[3] + (B[3] - A[3]) * k
    return `rgba(${r},${g},${bl},${al.toFixed(3)})`
}
function rgbaOf(c: any, alpha: number) {
    const C = parseColor(c)
    return `rgba(${C[0]},${C[1]},${C[2]},${(C[3] * alpha).toFixed(3)})`
}

function evalTween(tw: any, now: number) {
    if (tw.dur <= 0) return tw.to
    const t = clamp01((now - tw.start) / tw.dur)
    return tw.from + (tw.to - tw.from) * EASE(t)
}

// Knob edges: plain = both edges on one ease-in-out; stretch = leading edge
// runs ahead (ease-out), trailing edge follows late (ease-in).
function evalMove(m: any, now: number, stretch: number, leadFrac: number) {
    const t = m.dur <= 0 ? 1 : clamp01((now - m.start) / m.dur)
    const e = EASE(t)
    const k = m.stretchy ? clamp01(stretch) : 0
    const a = Math.min(1, Math.max(0.3, leadFrac))
    const uL = clamp01(t / a)
    const lead = 1 - (1 - uL) * (1 - uL)
    const uT = clamp01((t - (1 - a)) / a)
    const trail = uT * uT
    const lw = e + (lead - e) * k
    const tw = e + (trail - e) * k
    const d = m.to - m.from
    if (d >= 0) return { pL: m.from + d * tw, pR: m.from + d * lw }
    return { pL: m.from + d * lw, pR: m.from + d * tw }
}

function makeState(stretchy: boolean) {
    return {
        on: true,
        stretchy,
        move: { from: 1, to: 1, start: 0, dur: 0, stretchy: false },
        col: { from: 1, to: 1, start: 0, dur: 0 },
        clock: 0,
        pausedUntil: 0,
        last: { pL: 1, pR: 1, c: 1 },
    }
}

function durations(live: any, reduced: boolean) {
    if (reduced) return { travel: 0, color: 0 }
    const rate = Math.max(0, live.speed) / 50
    const tr = rate > 0 ? Math.max(0.2, rate) : 1
    const adv = live.adv
    return {
        travel: Math.max(0, adv.travelMs) / tr,
        color: Math.max(0, adv.colorMs) / tr,
    }
}

function doToggle(s: any, on: boolean, now: number, d: any) {
    if (s.on === on) return
    s.on = on
    const cur = (s.last.pL + s.last.pR) / 2
    s.move = { from: cur, to: on ? 1 : 0, start: now, dur: d.travel, stretchy: s.stretchy }
    s.col = { from: s.last.c, to: on ? 1 : 0, start: now, dur: d.color }
}


function geometry(W: number, adv: any) {
    const H = (W * adv.trackHeight) / 100
    const inset = (W * adv.knobInset) / 1000
    const kw = Math.min(W - 2 * inset, (W * adv.knobWidth) / 100)
    const kh = Math.max(4, H - 2 * inset)
    const travel = Math.max(0, W - 2 * inset - kw)
    return { H, inset, kw, kh, travel }
}

function layout(W: number, adv: any, live: any, v: any) {
    const { H, inset, kw, kh, travel } = geometry(W, adv)
    let L = inset + travel * v.pL
    let R = inset + kw + travel * v.pR
    const lo = inset * 0.35
    const hi = W - inset * 0.35
    L = Math.max(lo, L)
    R = Math.min(hi, R)
    if (R - L < kh) R = L + kh
    const c = v.c
    const sc = W / 600
    const edge = Math.max(1, adv.edgeWidth * sc)
    return {
        // The knob box as numbers, for the glass lens.
        kn: { L, R, top: inset, kh, H, W },
        stage: {
            // Placement: relative left/top % resolve against the frame, so the toggle moves by a
            // share of the frame's width / height; the background stays put.
            position: "relative",
            left: `${live.placement.x}%`,
            top: `${live.placement.y}%`,
            width: px(W),
            height: px(H),
            flexShrink: 0,
        },
        track: {
            position: "absolute",
            left: "0px",
            top: "0px",
            width: px(W),
            height: px(H),
            borderRadius: px(H / 2),
            background: mixColor(live.offColor, live.onColor, c),
            boxShadow: [
                `0 ${0.043 * W}px ${0.087 * W}px rgba(0,0,0,${(adv.trackShadow / 100).toFixed(3)})`,
                `inset ${0.012 * W}px ${0.014 * W}px ${0.026 * W}px rgba(0,0,0,${((adv.innerShade / 100) * (1 - c)).toFixed(3)})`,
                `inset 0 0 0 ${edge}px ${rgbaOf(adv.knobEdgeOn, 0.5 * c)}`,
            ].join(", "),
            cursor: "pointer",
            // The glass knob can be dragged sideways; vertical swipes still scroll the page.
            touchAction: "pan-y",
        },
        knob: {
            position: "absolute",
            left: px(L),
            top: px(inset),
            width: px(R - L),
            height: px(kh),
            borderRadius: px(kh / 2),
            boxSizing: "border-box",
            background: live.knobColor,
            border: `${edge}px solid ${mixColor(adv.knobEdgeOff, adv.knobEdgeOn, c)}`,
            boxShadow: `${-0.006 * W}px ${0.009 * W}px ${0.023 * W}px rgba(0,0,0,${(adv.knobShadow / 100).toFixed(3)})`,
            pointerEvents: "none",
        },
    }
}

/**
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 800
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 */
export default function StretchPillToggle(props: any) {
    const {
        background = "#000000",
        onColor = "#2B76F0",
        offColor = "#CFCFCF",
        knobColor = "#FFFFFF",
        mode = "plain",
        autoplay = true,
        speed = 34,
        stretch = 25,
        size = 302,
        finish = "glass",
        style,
    } = props
    const adv = { ...ADVANCED_DEFAULTS, ...(props.advanced ?? {}) }
    const glass = { ...DEFAULT_GLASS, ...(props.glass ?? {}) }
    const placement = { ...DEFAULT_PLACEMENT, ...(props.placement ?? {}) }
    const live = { onColor, offColor, knobColor, mode, autoplay, speed, stretch, size, adv, finish, glass, background, placement }
    const liveRef = useRef(live)
    liveRef.current = live

    const st = useRef<any>(null)
    if (!st.current) st.current = makeState(mode !== "plain")
    const reducedRef = useRef(false)

    const rootRef = useRef<HTMLDivElement>(null)
    const stageRef = useRef<HTMLDivElement>(null)
    const trackRef = useRef<HTMLDivElement>(null)
    const knobRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const dragRef = useRef<any>(null)
    const suppressClickRef = useRef(false)

    useEffect(() => {
        const s = st.current
        s.pressed = false
        s.g = 0
        s.gv = 0

        // Glass lens: created the first time Style is Glass, rebuilt after a lost context. Until it
        // exists the solid knob stays on screen, so a missing GPU path never leaves a hole.
        let glass: GlassGL | null = null
        let glassTried = false
        let lostGL = false
        const canvas = canvasRef.current
        const onLost = (e: Event) => {
            e.preventDefault()
            lostGL = true
            glass = null
        }
        const onRestored = () => {
            lostGL = false
            glassTried = false
            cvKey = ""
        }
        canvas?.addEventListener("webglcontextlost", onLost)
        canvas?.addEventListener("webglcontextrestored", onRestored)
        // Drawn at the size it is shown: a scaled preview or the canvas zoom would otherwise
        // resample the lens soft. Laid out at zoom × size and scaled back by 1/zoom.
        let zoom = 1
        let zoomTick = 0
        const readZoom = () => {
            const r = rootRef.current
            if (!r || !r.offsetWidth) return 1
            const w = r.getBoundingClientRect().width
            return w > 0 ? Math.min(2, Math.max(0.1, w / r.offsetWidth)) : 1
        }
        let cvKey = ""
        let cvScale = 1
        let cvW = 0
        let cvH = 0
        let drawnKey = ""
        let mq: MediaQueryList | null = null
        try {
            mq = window.matchMedia("(prefers-reduced-motion: reduce)")
            reducedRef.current = !!mq.matches
        } catch (e) {}
        const onMq = () => {
            reducedRef.current = !!mq?.matches
        }
        mq?.addEventListener?.("change", onMq)

        let raf = 0
        let last = -1
        // Off-screen toggles stop animating until they scroll back in.
        let visible = true
        const tick = (now: number) => {
            if (!visible) {
                raf = 0
                return
            }
            const L = liveRef.current
            const A = L.adv
            const dt = last < 0 ? 0 : Math.min((now - last) / 1000, 1 / 20)
            last = now
            const reduced = reducedRef.current
            const d = durations(L, reduced)
            const rate = Math.max(0, L.speed) / 50

            s.stretchy = L.mode !== "plain"

            if (L.autoplay && !reduced && rate > 0 && now >= s.pausedUntil && !s.pressed) {
                const loop = Math.max(2, A.loopMs / 1000)
                const k = loop / REF_LOOP
                const fire = (kind: string) => {
                    if (kind === "on") doToggle(s, true, now, d)
                    else if (kind === "off") doToggle(s, false, now, d)
                }
                const run = (a: number, b: number) => {
                    for (const [t, kind] of SCHEDULE) {
                        const tt = t * k
                        if (tt > a && tt <= b) fire(kind)
                    }
                }
                const prev = s.clock
                let next = prev + dt * rate
                if (next >= loop) {
                    run(prev, loop)
                    next -= loop
                    run(-1, next)
                } else run(prev, next)
                s.clock = next
            }

            const mv = evalMove(s.move, now, L.stretch / 100, A.stretchLead / 100)
            const c = evalTween(s.col, now)
            s.last = { pL: mv.pL, pR: mv.pR, c }

            const W = Math.max(50, L.size)
            const Ls: any = layout(W, A, L, s.last)
            // ── glass knob ──
            const G = L.glass
            const glassOn = L.finish === "glass"
            const always = G.show === "always"
            const moving = s.move.dur > 0 && now < s.move.start + s.move.dur + GLASS_LINGER_MS
            const want = glassOn && (s.pressed || moving) ? 1 : 0
            if (!glassOn || reduced) {
                s.g = glassOn ? want : 0
                s.gv = 0
            } else {
                // Fixed 240 Hz substeps: the same spring at any refresh rate.
                const z = want === 1 ? GLASS_ZETA_UP : GLASS_ZETA_DOWN
                let rem = dt
                while (rem > 1e-6) {
                    const h = Math.min(rem, 1 / 240)
                    s.gv += (-2 * z * GLASS_OMEGA * s.gv - GLASS_OMEGA * GLASS_OMEGA * (s.g - want)) * h
                    s.g += s.gv * h
                    rem -= h
                }
                // Snap once settled, so a held or resting knob stops redrawing.
                if (Math.abs(s.g - want) < 1e-3 && Math.abs(s.gv) < 1e-2) {
                    s.g = want
                    s.gv = 0
                }
            }
            if (glassOn && !glass && !glassTried && !lostGL && canvas) {
                glassTried = true
                glass = createGlassGL(canvas)
            }
            const ga = glassOn && glass ? (always ? 1 : clamp01(s.g)) : 0
            const sz = glassOn ? 1 + (Math.max(100, G.swell) / 100 - 1) * s.g : 1
            if (glassOn) {
                const kn = Ls.kn
                const cx = (kn.L + kn.R) / 2
                const cy = kn.top + kn.kh / 2
                const kw2 = (kn.R - kn.L) * sz
                const kh2 = kn.kh * sz
                Ls.knob.left = px(cx - kw2 / 2)
                Ls.knob.top = px(cy - kh2 / 2)
                Ls.knob.width = px(kw2)
                Ls.knob.height = px(kh2)
                Ls.knob.borderRadius = px(kh2 / 2)
            }
            Ls.knob.opacity = String(1 - ga)

            if (glass && canvas) {
                const kn = Ls.kn
                const M = Math.max(0.6 * kn.H, 0.35 * kn.W)
                if (++zoomTick % 30 === 1) zoom = readZoom()
                const scale = Math.min(Math.min(2, window.devicePixelRatio || 1) * zoom, 3)
                const key = `${kn.W}|${kn.H}|${zoom}|${scale}`
                if (key !== cvKey) {
                    cvKey = key
                    cvScale = scale
                    cvW = kn.W + 2 * M
                    cvH = kn.H + 2 * M
                    canvas.width = Math.max(1, Math.round(cvW * scale))
                    canvas.height = Math.max(1, Math.round(cvH * scale))
                    Object.assign(canvas.style, {
                        left: px(-M),
                        top: px(-M),
                        width: px(cvW * zoom),
                        height: px(cvH * zoom),
                        transform: zoom === 1 ? "" : `scale(${1 / zoom})`,
                    })
                    drawnKey = "?"
                }
                const gl = glass.gl
                if (ga > 0.003) {
                    const cx = M + (kn.L + kn.R) / 2
                    const cy = M + kn.top + kn.kh / 2
                    const hw = ((kn.R - kn.L) / 2) * sz
                    const hh = (kn.kh / 2) * sz
                    const A = parseColor(L.offColor)
                    const B = parseColor(L.onColor)
                    const bg = parseColor(L.background)
                    const tc = [0, 1, 2].map((i) => (A[i] + (B[i] - A[i]) * clamp01(c)) / 255)
                    const ta = A[3] + (B[3] - A[3]) * clamp01(c)
                    const refr = clamp01(G.refraction / 100)
                    const hi = clamp01(G.highlight / 100)
                    const disp = clamp01(G.dispersion / 100)
                    // Redraw only on a visible change (1/20 px, 1/500 alpha).
                    const q = (v: number, s: number) => Math.round(v * s)
                    const k = [q(cx, 20), q(cy, 20), q(hw, 20), q(hh, 20), q(ga, 500), tc.map((v) => q(v, 255)), q(ta, 255), bg, refr, hi, disp, cvScale].join("|")
                    if (k !== drawnKey) {
                        drawnKey = k
                        const pad = Math.min(hw, hh) * 0.8
                        const bx = Math.max(0, cx - hw - pad)
                        const by = Math.max(0, cy - hh - pad)
                        gl.viewport(0, 0, canvas.width, canvas.height)
                        gl.clearColor(0, 0, 0, 0)
                        gl.clear(gl.COLOR_BUFFER_BIT)
                        const u = glass.u
                        gl.uniform4f(u.uBox, bx, by, Math.min(cvW, cx + hw + pad) - bx, Math.min(cvH, cy + hh + pad) - by)
                        gl.uniform2f(u.uSize, cvW, cvH)
                        gl.uniform1f(u.uScale, cvScale)
                        gl.uniform4f(u.uTrack, M, M, kn.W, kn.H)
                        gl.uniform4f(u.uTrackCol, tc[0], tc[1], tc[2], ta)
                        gl.uniform4f(u.uBg, bg[0] / 255, bg[1] / 255, bg[2] / 255, bg[3])
                        gl.uniform4f(u.uKnob, cx, cy, hw, hh)
                        gl.uniform1f(u.uAlpha, ga)
                        gl.uniform1f(u.uRefr, refr)
                        gl.uniform1f(u.uHi, hi)
                        gl.uniform1f(u.uDisp, disp)
                        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
                    }
                } else if (drawnKey !== "") {
                    // Settled back to the solid knob: clear once, then draw nothing.
                    drawnKey = ""
                    gl.clearColor(0, 0, 0, 0)
                    gl.clear(gl.COLOR_BUFFER_BIT)
                }
            }

            if (stageRef.current) Object.assign(stageRef.current.style, Ls.stage)
            if (trackRef.current) Object.assign(trackRef.current.style, Ls.track)
            if (knobRef.current) Object.assign(knobRef.current.style, Ls.knob)

            raf = requestAnimationFrame(tick)
        }
        const io =
            typeof IntersectionObserver !== "undefined"
                ? new IntersectionObserver(([e]) => {
                      visible = e.isIntersecting
                      if (visible && !raf) {
                          last = -1
                          raf = requestAnimationFrame(tick)
                      }
                  })
                : null
        if (io && rootRef.current) io.observe(rootRef.current)
        raf = requestAnimationFrame(tick)

        return () => {
            cancelAnimationFrame(raf)
            io?.disconnect()
            mq?.removeEventListener?.("change", onMq)
            canvas?.removeEventListener("webglcontextlost", onLost)
            canvas?.removeEventListener("webglcontextrestored", onRestored)
        }
    }, [])

    const pause = () => {
        st.current.pausedUntil = performance.now() + Math.max(0, liveRef.current.adv.resumeMs)
    }
    const onTrackClick = () => {
        // A drag of the glass knob ends in its own settle; the click that follows it is not a tap.
        if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
        }
        const s = st.current
        doToggle(s, !s.on, performance.now(), durations(liveRef.current, reducedRef.current))
        pause()
    }
    // Press and drag. In Glass the knob turns to glass while held and can be dragged across; letting
    // go settles it on the side it was dragged to. In Solid a press is only the start of a click.
    const onTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
        const s = st.current
        const L = liveRef.current
        s.pressed = L.finish === "glass"
        suppressClickRef.current = false
        pause()
        if (!s.pressed) return
        // Measured as shown, so the drag stays under the pointer at any zoom or preview scale.
        const r = e.currentTarget.getBoundingClientRect()
        const W = Math.max(50, L.size)
        dragRef.current = { id: e.pointerId, x0: e.clientX, k: r.width / W || 1, p0: (s.last.pL + s.last.pR) / 2, moved: false }
        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch (err) {}
    }
    const onTrackMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = dragRef.current
        const s = st.current
        if (!g || g.id !== e.pointerId || !s.pressed) return
        const L = liveRef.current
        const { travel } = geometry(Math.max(50, L.size), L.adv)
        const dx = (e.clientX - g.x0) / g.k
        if (!g.moved && Math.abs(dx) < DRAG_SLOP) return
        g.moved = true
        const p = clamp01(g.p0 + (travel > 0 ? dx / travel : 0))
        s.move = { from: p, to: p, start: 0, dur: 0, stretchy: false }
        // The track colour flips as the knob crosses the middle, as on iOS.
        const on = p > 0.5
        if (on !== s.on) {
            s.on = on
            s.col = { from: s.last.c, to: on ? 1 : 0, start: performance.now(), dur: durations(L, reducedRef.current).color }
        }
        pause()
    }
    const onTrackUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const s = st.current
        s.pressed = false
        const g = dragRef.current
        dragRef.current = null
        if (!g || g.id !== e.pointerId || !g.moved) return
        suppressClickRef.current = true
        const d = durations(liveRef.current, reducedRef.current)
        const p = (s.last.pL + s.last.pR) / 2
        const to = s.on ? 1 : 0
        s.move = { from: p, to, start: performance.now(), dur: d.travel * Math.max(0.35, Math.abs(to - p)), stretchy: false }
        pause()
    }
    const W = Math.max(50, size)
    const Ls: any = layout(W, adv, live, st.current.last)

    return (
        <div
            ref={rootRef}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                minWidth: 1200,
                minHeight: 800,
                ...style,
                background,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                userSelect: "none",
                WebkitUserSelect: "none",
                touchAction: "manipulation",
            }}
        >
            <div ref={stageRef} style={Ls.stage}>
                <div
                    ref={trackRef}
                    style={Ls.track}
                    onClick={onTrackClick}
                    onPointerDown={onTrackDown}
                    onPointerMove={onTrackMove}
                    onPointerUp={onTrackUp}
                    onPointerCancel={onTrackUp}
                />
                <div ref={knobRef} style={Ls.knob} />
                <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, display: "block", pointerEvents: "none", transformOrigin: "0 0" }} />
            </div>
            {adv.grain > 0 && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        backgroundImage: GRAIN_URL,
                        backgroundSize: "160px 160px",
                        opacity: (adv.grain / 100) * 0.35,
                        mixBlendMode: "overlay",
                    }}
                />
            )}
            {adv.vignette > 0 && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${(adv.vignette / 100) * 0.85}) 100%)`,
                    }}
                />
            )}
        </div>
    )
}

// Control order arranged in the builder.
