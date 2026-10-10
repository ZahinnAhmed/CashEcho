import { useEffect, useRef, useState } from "react";
import { api, DEMO, getSpeechTag } from "./api.js";
import {
  getUseFallback,
  setUseFallback,
  webSpeechAvailable,
} from "./lib/voiceClient.js";
// Recording stops by itself when the owner stops talking
const SILENCE_MS = 3000; // quiet this long after they have spoken -> stop
const NO_SPEECH_MS = 6000; // they never started talking -> stop

export function useRecorder(onText, onError) {
  const [status, setStatus] = useState("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef(null),
    stream = useRef(null),
    recognition = useRef(null),
    timer = useRef(null),
    silence = useRef(null),
    active = useRef(true),
    chunks = useRef([]);
  const [fallback, setFallbackState] = useState(
    () => webSpeechAvailable() && (getUseFallback() ?? DEMO),
  );
  function setFallback(on) {
    setUseFallback(on);
    setFallbackState(on);
  }
  function clean() {
    clearInterval(timer.current);
    if (silence.current) {
      clearInterval(silence.current.id);
      silence.current.ctx.close().catch(() => {});
      silence.current = null;
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      recognition.current?.abort();
      clean();
    };
  }, []);
  async function deliver(text) {
    if (!active.current) return;
    setStatus("sending");
    try {
      if (!text?.trim())
        throw new Error(
          "No speech detected. Try again or type the transaction.",
        );
      await onText(text);
    } catch (e) {
      onError(e.message);
    } finally {
      if (active.current) setStatus("idle");
    }
  }
  // Mic recordings and the backup demo clips both go through here.
  async function send(blob) {
    setStatus("sending");
    try {
      await deliver(await api.transcribe(blob));
    } catch (e) {
      if (e.fallback && webSpeechAvailable()) {
        setFallback(true);
        onError(
          "ElevenLabs is unavailable, so backup voice input is now on. Tap the mic and say it again.",
        );
      } else onError(e.message);
      setStatus("idle");
    }
  }
  // Listens to the microphone level while recording. After the owner has spoken, three seconds
  // of quiet ends the recording. The quiet level of the room is measured first, so background
  // noise is not mistaken for speech.
  function watchForSilence(media) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // no automatic stop; the owner taps stop
    const ctx = new Ctx();
    ctx.resume?.();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(media).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const startedAt = Date.now();
    let roomLevel = Infinity;
    let heardSpeech = false;
    let lastVoice = startedAt;
    const id = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const level = Math.sqrt(sum / samples.length);
      const now = Date.now();
      if (now - startedAt < 500) {
        roomLevel = Math.min(roomLevel, level); // the quietest moment is the room's noise
        return;
      }
      if (level > Math.max(0.015, roomLevel * 3)) {
        heardSpeech = true;
        lastVoice = now;
      }
      if (heardSpeech ? now - lastVoice >= SILENCE_MS : now - startedAt >= NO_SPEECH_MS) stop();
    }, 100);
    silence.current = { id, ctx };
  }
  async function start() {
    if (status !== "idle") return;
    setSeconds(0);
    if (fallback) {
      const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Speech) {
        onError(
          "Browser speech recognition is unavailable. Turn off browser fallback to use ElevenLabs, or type your transaction.",
        );
        return;
      }
      const r = new Speech();
      recognition.current = r;
      r.lang = getSpeechTag(); // follows the owner's language choice
      r.interimResults = false;
      r.continuous = false;
      let result = "";
      let failed = false;
      r.onresult = (e) => {
        result = Array.from(e.results)
          .map((x) => x[0].transcript)
          .join(" ");
      };
      r.onerror = (e) => {
        failed = true;
        onError(
          `Speech recognition: ${e.error}. You can type the transaction below.`,
        );
      };
      r.onend = () => {
        clean();
        if (!active.current) return;
        setStatus("idle");
        if (!failed) void deliver(result);
      };
      try {
        r.start();
        setStatus("recording");
        timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      } catch (e) {
        onError(e.message);
      }
      return;
    }
    setStatus("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Recording requires a supported browser and HTTPS or localhost.",
        );
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      chunks.current = [];
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(media, type ? { mimeType: type } : {});
      recorder.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onerror = () => {
        clean();
        if (active.current) {
          setStatus("idle");
          onError("Recording failed. Please try again.");
        }
      };
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType });
        clean();
        if (active.current) void send(blob);
      };
      rec.start();
      setStatus("recording");
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      watchForSilence(media);
    } catch (e) {
      clean();
      if (active.current) {
        setStatus("idle");
        onError(
          e.name === "NotAllowedError"
            ? "Microphone permission was denied. Allow access or type below."
            : e.message,
        );
      }
    }
  }
  function stop() {
    if (fallback) recognition.current?.stop();
    else if (recorder.current?.state === "recording") recorder.current.stop();
  }
  useEffect(() => {
    if (seconds >= 60 && status === "recording") stop();
  }, [seconds, status]);
  return { status, seconds, fallback, setFallback, start, stop, send };
}
