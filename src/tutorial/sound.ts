/**
 * The tutorial's two sounds, made on the spot with Web Audio (no files): a
 * soft click as a tile lands, and a chime when a move scores, plus a short
 * buzz for a big moment on a phone. Off until the player turns them on; the
 * one switch covers both, and the choice is kept on this device.
 */
const KEY = "kraftwerd:tutorial-sound";

export function soundOn(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Kept for this visit only.
  }
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
  context ??= new window.AudioContext();
  // iOS starts it suspended until a gesture asks for sound.
  if (context.state === "suspended") void context.resume();
  return context;
}

function tone(frequency: number, start: number, length: number, volume: number) {
  const ctx = audio();
  if (ctx === null) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  const t = ctx.currentTime + start;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

/** A tile landing. */
export function playClick(): void {
  if (soundOn()) tone(880, 0, 0.06, 0.08);
}

/** A move scoring; brighter for a big moment. */
export function playChime(big = false): void {
  if (!soundOn()) return;
  tone(660, 0, 0.25, 0.1);
  tone(990, 0.08, 0.3, 0.08);
  if (big) tone(1320, 0.16, 0.4, 0.07);
}

/** A short buzz on a phone that has one, for a big moment (when sound is on). */
export function buzz(): void {
  if (!soundOn()) return;
  try {
    navigator.vibrate?.(25);
  } catch {
    // No vibration: nothing lost.
  }
}
