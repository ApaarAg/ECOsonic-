import React, { useRef, useState } from "react";
import LetterCascade from "../components/originkit/ui/letter-cascade";

export interface EditorialHeadingProps {
  text: string;
  hoverNote?: string;
  revealKey: string;
  align?: "left" | "center";
  stagger?: number;
  className?: string;
  style?: React.CSSProperties;
  reducedMotion?: boolean;
  as?: "h1" | "h2";
}

/**
 * Major heading primitive pairing LetterCascade entrance with a restrained,
 * non-shifting hover/focus/tap secondary annotation.
 */
export const EditorialHeading: React.FC<EditorialHeadingProps> = ({
  text,
  hoverNote,
  revealKey,
  align = "left",
  stagger = 8,
  className = "",
  style,
  reducedMotion = false,
  as = "h1",
}) => {
  const [revealed, setRevealed] = useState(false);
  const mouseHoverRef = useRef(false);
  const lastPointerTypeRef = useRef<string>("mouse");
  const Tag = as;

  const alignNoteClass =
    align === "center"
      ? "left-1/2 -translate-x-1/2 text-center border-l-0 border-b border-[#C89B62]/45 px-2.5 pb-1"
      : "left-0 text-left border-l border-[#C89B62]/55 pl-2.5";

  return (
    <div
      className={`group pointer-events-auto relative inline-block max-w-full ${
        align === "center" ? "text-center" : ""
      }`}
      onPointerEnter={(ev) => {
        lastPointerTypeRef.current = ev.pointerType || "mouse";
      }}
      onPointerDown={(ev) => {
        lastPointerTypeRef.current = ev.pointerType || "mouse";
      }}
      onMouseEnter={() => {
        if (lastPointerTypeRef.current === "touch") return;
        mouseHoverRef.current = true;
        setRevealed(true);
      }}
      onMouseLeave={() => {
        mouseHoverRef.current = false;
        setRevealed(false);
      }}
      onFocus={() => setRevealed(true)}
      onBlur={() => {
        mouseHoverRef.current = false;
        setRevealed(false);
      }}
      onClick={() => {
        if (!hoverNote) return;
        if (lastPointerTypeRef.current !== "touch" && mouseHoverRef.current) {
          setRevealed(true);
          return;
        }
        setRevealed((prev) => !prev);
      }}
    >
      <Tag className={className} style={style}>
        <LetterCascade
          text={text}
          variant="reveal"
          revealKey={revealKey}
          align={align}
          stagger={stagger}
        />
      </Tag>

      {hoverNote ? (
        <span
          aria-hidden={!revealed}
          data-testid={`heading-hover-note-${revealKey}`}
          className={`pointer-events-none absolute top-full z-20 mt-1.5 max-w-[calc(100vw-3rem)] whitespace-normal sm:whitespace-nowrap bg-[#060708]/82 py-0.5 font-technical text-[11px] font-normal tracking-[0.04em] text-[#C8C3BA] backdrop-blur-sm ${
            reducedMotion ? "" : "transition-[opacity,transform] duration-200 ease-out"
          } ${alignNoteClass} ${
            revealed
              ? "translate-y-0 opacity-100"
              : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
          }`}
        >
          {hoverNote}
        </span>
      ) : null}
    </div>
  );
};
