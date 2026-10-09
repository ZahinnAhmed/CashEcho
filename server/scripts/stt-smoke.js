// L1 smoke test: sends every clip in test/audio/ straight to ElevenLabs Scribe
// and prints the transcript, so we can check the key and how numbers come back.
// Usage: npm run stt:smoke
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const AUDIO_DIR = path.join(__dirname, "..", "test", "audio");
const AUDIO_TYPES = {
  ".webm": "audio/webm",
  ".mp4": "audio/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
};

async function transcribe(file) {
  const type = AUDIO_TYPES[path.extname(file).toLowerCase()];
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type }), path.basename(file));
  form.append("model_id", "scribe_v2");
  form.append("language_code", "en");
  form.append("tag_audio_events", "false");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).text?.trim() ?? "";
}

async function main() {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("ELEVENLABS_API_KEY is missing. Copy server/.env.example to server/.env and fill it in.");
    process.exit(1);
  }
  const clips = fs.existsSync(AUDIO_DIR)
    ? fs.readdirSync(AUDIO_DIR).filter((f) => AUDIO_TYPES[path.extname(f).toLowerCase()]).sort()
    : [];
  if (!clips.length) {
    console.error(`No clips found. Add phone recordings (${Object.keys(AUDIO_TYPES).join(" ")}) to ${AUDIO_DIR}`);
    process.exit(1);
  }
  let failed = 0;
  for (const clip of clips) {
    const started = Date.now();
    try {
      const text = await transcribe(path.join(AUDIO_DIR, clip));
      console.log(`\n${clip}  (${Date.now() - started} ms)\n  → ${text || "(empty transcript)"}`);
      if (!text) failed++;
    } catch (err) {
      failed++;
      console.log(`\n${clip}  FAILED\n  → ${err.message}`);
    }
  }
  console.log(`\n${clips.length - failed}/${clips.length} clips transcribed.`);
  process.exit(failed ? 1 : 0);
}

main();
