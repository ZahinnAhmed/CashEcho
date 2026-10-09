// Voice playback and settings shared by the mic, confirmation and alert flows (Labib).
// Recording lives in useRecorder.js and the HTTP calls in api.js.
import { api } from "../api.js";

// ~10 ms of silence, played once inside a tap to unlock the shared player.
const SILENCE =
  "data:audio/wav;base64,UklGRnYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVIAAACA" +
  "gICA".repeat(27);
const FALLBACK_KEY = "cashecho.voiceFallback";

// iPhone Safari only lets an element play outside a tap if a tap started it once,
// so every sound goes through this one element and unlockAudio() runs in click handlers.
const player = typeof Audio === "undefined" ? null : new Audio();
let unlocked = false,
  objectUrl = null,
  stopCurrent = null;

export function unlockAudio() {
  if (unlocked || !player) return;
  if (!player.paused) {
    unlocked = true;
    return;
  }
  player.onended = player.onerror = null;
  player.src = SILENCE;
  player.play().then(
    () => (unlocked = true),
    () => {},
  );
  // iOS also keeps speechSynthesis silent until it is used once inside a tap.
  window.speechSynthesis?.speak(new SpeechSynthesisUtterance(""));
}

// Each playback gets a done() that runs once: when it ends, fails or is stopped.
function track(onEnd) {
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    if (stopCurrent === done) stopCurrent = null;
    onEnd?.();
  };
  stopCurrent = done;
  return done;
}

export function stopAudio() {
  player?.pause();
  window.speechSynthesis?.cancel();
  stopCurrent?.();
}

async function playOnPlayer(source, done) {
  if (!player) throw new Error("Audio playback is unavailable in this browser.");
  if (!source) throw new Error("The voice API returned no audio.");
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = source instanceof Blob ? URL.createObjectURL(source) : null;
  player.onended = player.onerror = null;
  player.src = objectUrl || source;
  await player.play();
  player.onended = player.onerror = done;
}

function speakInBrowser(text, done) {
  if (!window.speechSynthesis)
    throw new Error("Speech playback is unavailable in this browser.");
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.94;
  utterance.onend = utterance.onerror = done;
  speechSynthesis.speak(utterance);
}

// Plays a Blob or URL. Resolves once playback starts; onEnd runs when it stops.
export async function playSound(source, onEnd) {
  stopAudio();
  const done = track(onEnd);
  try {
    await playOnPlayer(source, done);
  } catch (e) {
    done();
    throw e;
  }
}

// Reads text in the ElevenLabs voice (/api/speak), or the browser voice if that fails.
export async function speak(text, onEnd) {
  stopAudio();
  const done = track(onEnd);
  try {
    const result = await api.speak(text);
    if (stopCurrent !== done) return; // stopped or replaced while loading
    await playOnPlayer(
      result instanceof Blob ? result : result?.audio_url || result?.audioUrl,
      done,
    );
  } catch {
    if (stopCurrent !== done) return;
    try {
      speakInBrowser(text, done);
    } catch (e) {
      done();
      throw e;
    }
  }
}

// "Logged $340 expense, supplies." Whole dollars drop the cents.
export function confirmationLine(tx) {
  const amount = Number(tx.amount);
  const dollars = amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `Logged $${dollars} ${tx.type}, ${String(tx.category).replaceAll("_", " ")}.`;
}

export const webSpeechAvailable = () =>
  typeof window !== "undefined" &&
  !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// The "Use backup voice input" switch, remembered per browser. null = never set.
export function getUseFallback() {
  try {
    const value = localStorage.getItem(FALLBACK_KEY);
    return value === null ? null : value === "true";
  } catch {
    return null;
  }
}

export function setUseFallback(on) {
  try {
    localStorage.setItem(FALLBACK_KEY, String(on));
  } catch {
    /* Still works for this visit. */
  }
}
