// Voice layer (Labib): speech-to-text and text-to-speech through ElevenLabs.
const express = require("express");
const multer = require("multer");
const { getLanguage, find } = require("../languages");
const { localizeKnownLine } = require("../phrasebook");
const { translateForSpeech } = require("../translate");

const ELEVENLABS = "https://api.elevenlabs.io/v1";
const STT_MODEL = "scribe_v2";
const TTS_MODEL = "eleven_flash_v2_5";
const TIMEOUT_MS = 15000;
const MAX_SPEAK_CHARS = 600;
const CACHE_LIMIT = 100;

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function apiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  return key;
}

async function transcribeAudio(buffer, mimetype = "", language = "en") {
  const form = new FormData();
  // iPhone Safari records mp4; Chrome and Android record webm.
  const filename = mimetype.includes("mp4") ? "clip.mp4" : "clip.webm";
  form.append("file", new Blob([buffer], { type: mimetype }), filename);
  form.append("model_id", STT_MODEL);
  form.append("language_code", language); // the owner's chosen language (English by default)
  form.append("tag_audio_events", "false");
  const res = await fetch(`${ELEVENLABS}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok)
    throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.text || "").trim();
}

async function requestSpeech(text, language = "en") {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID is not set");
  const res = await fetch(
    `${ELEVENLABS}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: find(language)?.ttsModel || TTS_MODEL, language_code: language }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!res.ok)
    throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

// text → mp3 Buffer. Cached in memory because the demo repeats the same lines.
const ttsCache = new Map();
function synthesize(text, language = "en") {
  const key = `${language}|${text}`;
  if (!ttsCache.has(key)) {
    const pending = requestSpeech(text, language).catch((err) => {
      ttsCache.delete(key);
      throw err;
    });
    ttsCache.set(key, pending);
    if (ttsCache.size > CACHE_LIMIT) ttsCache.delete(ttsCache.keys().next().value);
  }
  return ttsCache.get(key);
}

async function synthesizeDataUrl(text, language = "en") {
  const audio = await synthesize(text, language);
  return `data:audio/mpeg;base64,${audio.toString("base64")}`;
}

// "Logged $340 expense, supplies." Whole dollars drop the cents.
function confirmationLine(tx) {
  const amount = Number(tx.amount);
  const dollars = amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `Logged $${dollars} ${tx.type}, ${String(tx.category).replaceAll("_", " ")}.`;
}

function receiveAudio(req, res, next) {
  upload.single("audio")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE")
      return res.status(413).json({ error: "audio_too_large" });
    res.status(400).json({ error: "no_audio" });
  });
}

router.post("/transcribe", receiveAudio, async (req, res) => {
  if (!req.file?.size) return res.status(400).json({ error: "no_audio" });
  try {
    const language = await getLanguage(req.user.id);
    const text = await transcribeAudio(req.file.buffer, req.file.mimetype, language);
    if (!text) return res.status(422).json({ error: "empty_transcript" });
    res.json({ text });
  } catch (err) {
    console.error("[voice] transcribe failed:", err.message);
    res.status(502).json({ error: "transcribe_failed", fallback: true });
  }
});

router.post("/speak", express.json(), async (req, res) => {
  const text =
    typeof req.body?.text === "string"
      ? req.body.text.trim().slice(0, MAX_SPEAK_CHARS)
      : "";
  if (!text) return res.status(400).json({ error: "no_text" });
  try {
    // Speak in the owner's language: translate the English line first (numbers are checked)
    const owner = await getLanguage(req.user.id);
    // Fixed lines like "Logged $700 income, sales." use a ready phrasebook, so they are instant;
    // anything else is translated by Gemini
    const spoken = (await localizeKnownLine(text, owner)) || (await translateForSpeech(text, owner));
    const audio = await synthesize(spoken.text, spoken.language);
    res.set("Content-Type", "audio/mpeg").send(audio);
  } catch (err) {
    console.error("[voice] speak failed:", err.message);
    res.status(502).json({ error: "speak_failed" });
  }
});

module.exports = { router, synthesize, synthesizeDataUrl, confirmationLine };
