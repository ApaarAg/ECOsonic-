declare global {
  interface Window {
    __ECOSONIC_AUDIO_CONTEXT_COUNT__?: number;
  }
}

let sharedContext: AudioContext | null = null;

function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ||
    null
  );
}

/**
 * Returns the single shared AudioContext for the entire application session.
 * Guarantees at most one AudioContext is ever instantiated across microphone
 * capture and continuous scroll soundscape playback.
 */
export function getOrCreateSharedAudioContext(
  preferredSampleRate?: number,
): AudioContext | null {
  if (sharedContext && sharedContext.state !== "closed") {
    return sharedContext;
  }

  const Ctor = resolveAudioContextCtor();
  if (!Ctor) return null;

  try {
    sharedContext = preferredSampleRate
      ? new Ctor({ sampleRate: preferredSampleRate })
      : new Ctor();
  } catch {
    sharedContext = new Ctor();
  }

  if (typeof window !== "undefined") {
    window.__ECOSONIC_AUDIO_CONTEXT_COUNT__ =
      (window.__ECOSONIC_AUDIO_CONTEXT_COUNT__ ?? 0) + 1;
  }
  return sharedContext;
}

export function getExistingSharedAudioContext(): AudioContext | null {
  if (sharedContext && sharedContext.state !== "closed") {
    return sharedContext;
  }
  return null;
}
