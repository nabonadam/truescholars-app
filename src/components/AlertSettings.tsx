"use client";

import { useEffect, useState } from "react";
import { enableDesktopAlerts, getPrefs, playMessage, setPrefs, unlockAudioOnGesture } from "@/lib/sounds";

/** Sound on/off and desktop alerts. Remembered on this device. */
export function AlertSettings({ compact = false }: { compact?: boolean }) {
  const [prefs, set] = useState({ sound: true, desktop: false });
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    set(getPrefs());
    setSupported(typeof Notification !== "undefined");
    unlockAudioOnGesture();
    const on = (e: Event) => set((e as CustomEvent).detail);
    window.addEventListener("ts:prefs", on);
    return () => window.removeEventListener("ts:prefs", on);
  }, []);

  const toggleSound = () => {
    const next = setPrefs({ sound: !prefs.sound });
    if (next.sound) setTimeout(playMessage, 50); // play a sample so people know what they turned on
  };

  return (
    <div className={`flex ${compact ? "flex-col gap-1" : "flex-wrap items-center gap-2"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={prefs.sound}
        onClick={toggleSound}
        className={compact ? "flex w-full items-center justify-between px-4 py-2.5 text-left text-[15px] hover:bg-parchment" : `inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-bold ${prefs.sound ? "border-green bg-green-tint text-green" : "border-line bg-white text-ink-muted"}`}
      >
        <span className="inline-flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9z" />
            {prefs.sound ? <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
          </svg>
          Message sounds
        </span>
        {compact && <Switch on={prefs.sound} />}
      </button>
      {supported && (
        <button
          type="button"
          role="switch"
          aria-checked={prefs.desktop}
          onClick={() => (prefs.desktop ? setPrefs({ desktop: false }) : void enableDesktopAlerts())}
          className={compact ? "flex w-full items-center justify-between px-4 py-2.5 text-left text-[15px] hover:bg-parchment" : `inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-bold ${prefs.desktop ? "border-green bg-green-tint text-green" : "border-line bg-white text-ink-muted"}`}
        >
          <span className="inline-flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 5h18v11H3zM8 20h8M12 16v4" />
            </svg>
            Desktop alerts
          </span>
          {compact && <Switch on={prefs.desktop} />}
        </button>
      )}
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-green" : "bg-line"}`} aria-hidden="true">
      <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </span>
  );
}

/** A single speaker button (used beside the Messages heading). */
export function SoundButton() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(getPrefs().sound);
    unlockAudioOnGesture();
    const h = (e: Event) => setOn((e as CustomEvent).detail.sound);
    window.addEventListener("ts:prefs", h);
    return () => window.removeEventListener("ts:prefs", h);
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = setPrefs({ sound: !on });
        if (next.sound) setTimeout(playMessage, 50);
      }}
      aria-pressed={on}
      aria-label={on ? "Message sounds on. Turn off" : "Message sounds off. Turn on"}
      title={on ? "Sounds on" : "Sounds off"}
      className={`grid size-10 place-items-center rounded-full ${on ? "text-green hover:bg-green-tint" : "text-ink-muted hover:bg-parchment"}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9z" />
        {on ? <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
      </svg>
    </button>
  );
}
