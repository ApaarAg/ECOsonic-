/**
 * Local storage manager for session field notes.
 * Distinguishes local researcher annotations from server-persisted scientific data.
 */

export interface SessionNote {
  id: string;
  sessionId: string;
  content: string;
  createdAtIso: string;
  updatedAtIso: string;
}

const STORAGE_KEY_PREFIX = 'ecosonic_session_notes_v1_';

export function getSessionNotes(sessionId: string): SessionNote[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + sessionId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is SessionNote =>
        typeof n === 'object' &&
        n !== null &&
        typeof n.id === 'string' &&
        n.sessionId === sessionId &&
        typeof n.content === 'string'
    );
  } catch {
    return [];
  }
}

export function saveSessionNote(
  sessionId: string,
  content: string,
  noteId?: string
): SessionNote | null {
  if (typeof window === 'undefined' || !window.localStorage || !content.trim()) {
    return null;
  }

  const existingNotes = getSessionNotes(sessionId);
  const nowIso = new Date().toISOString();

  if (noteId) {
    // Edit existing
    const idx = existingNotes.findIndex((n) => n.id === noteId);
    if (idx >= 0) {
      existingNotes[idx] = {
        ...existingNotes[idx],
        content: content.trim(),
        updatedAtIso: nowIso,
      };
      try {
        window.localStorage.setItem(
          STORAGE_KEY_PREFIX + sessionId,
          JSON.stringify(existingNotes)
        );
        return existingNotes[idx];
      } catch {
        return null;
      }
    }
  }

  // Create new
  const newNote: SessionNote = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sessionId,
    content: content.trim(),
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };

  const updatedNotes = [newNote, ...existingNotes];
  try {
    window.localStorage.setItem(
      STORAGE_KEY_PREFIX + sessionId,
      JSON.stringify(updatedNotes)
    );
    return newNote;
  } catch {
    return null;
  }
}

export function deleteSessionNote(sessionId: string, noteId: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }
  try {
    const existing = getSessionNotes(sessionId);
    const filtered = existing.filter((n) => n.id !== noteId);
    window.localStorage.setItem(
      STORAGE_KEY_PREFIX + sessionId,
      JSON.stringify(filtered)
    );
    return true;
  } catch {
    return false;
  }
}
