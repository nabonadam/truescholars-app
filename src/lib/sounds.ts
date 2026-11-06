/**
 * Small, synthesised interface sounds (no audio files to download). Browsers only allow sound after
 * the person has interacted with the page, so the audio engine unlocks on the first click or key.
 * People can turn sounds off; the choice is remembered on this device.
 */

type Prefs = { sound: boolean; desktop: boolean };
const KEY = "ts:prefs";
let ctx: AudioContext | null = null;

export function getPrefs(): Prefs {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    return { sound: true, desktop: false, ...(raw ? (JSON.parse(raw) as Partial<Prefs>) : {}) };
  } catch {
    return { sound: true, desktop: false };
  }
}

export function setPrefs(p: Partial<Prefs>) {
  const next = { ...getPrefs(), ...p };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: keep it for this page only */
  }
  window.dispatchEvent(new CustomEvent("ts:prefs", { detail: next }));
  return next;
}

/** Call once on the client: prepares audio on the first gesture so later sounds can play. */
export function unlockAudioOnGesture() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!ctx && AC) ctx = new AC();
      void ctx?.resume();
    } catch {
      /* no audio available */
    }
  };
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function ready() {
  if (!getPrefs().sound || !ctx || ctx.state !== "running") return null;
  return ctx;
}

/** One soft voice: an oscillator through an envelope that rises fast and fades out. */
function voice(c: AudioContext, o: { freq: number; to?: number; type?: OscillatorType; start: number; dur: number; gain: number; attack?: number }) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "sine";
  const t = c.currentTime + o.start;
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur * 0.6);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

/** New message: a warm two-note marimba "ta-ding" (E5 then B5, each with a soft octave overtone). */
export function playMessage() {
  const c = ready();
  if (!c) return;
  for (const [freq, start] of [
    [659.25, 0],
    [987.77, 0.11],
  ] as const) {
    voice(c, { freq, start, dur: 0.42, gain: 0.16 });
    voice(c, { freq: freq * 2, start, dur: 0.16, gain: 0.04 });
    voice(c, { freq: freq * 4, start, dur: 0.05, gain: 0.015, type: "triangle" });
  }
}

/** A message arriving in the conversation you're looking at: one quiet bubble pop. */
export function playPop() {
  const c = ready();
  if (!c) return;
  voice(c, { freq: 480, to: 820, start: 0, dur: 0.14, gain: 0.1, attack: 0.004 });
}

/** Your own message went out: a light upward swoosh. */
export function playSent() {
  const c = ready();
  if (!c) return;
  voice(c, { freq: 620, to: 1240, start: 0, dur: 0.12, gain: 0.05, attack: 0.01 });
}

/** Other alerts (a proposal, a hire, a payout): a single small bell. */
export function playBell() {
  const c = ready();
  if (!c) return;
  voice(c, { freq: 1046.5, start: 0, dur: 0.9, gain: 0.09 });
  voice(c, { freq: 1046.5 * 2.76, start: 0, dur: 0.35, gain: 0.025 }); // bell-like inharmonic partial
  voice(c, { freq: 1046.5 * 5.4, start: 0, dur: 0.12, gain: 0.01 });
}

export async function enableDesktopAlerts(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  setPrefs({ desktop: result === "granted" });
  return result === "granted";
}
