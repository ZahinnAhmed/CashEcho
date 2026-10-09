import { DEMO } from "../api.js";
import { unlockAudio, webSpeechAvailable } from "../lib/voiceClient.js";

// Backup recordings in client/public/demo/, shown with ?demo=1. They go through the
// real transcribe → parse → confirm path; only the microphone is skipped.
const CLIPS = ["tx1", "tx2"];
const showClips = new URLSearchParams(window.location.search).has("demo");

async function loadClip(name) {
  for (const ext of ["webm", "mp4", "m4a"]) {
    const res = await fetch(`/demo/${name}.${ext}`);
    // A missing file comes back as the app's index.html, so check the type.
    if (res.ok && !(res.headers.get("content-type") || "").includes("text/html"))
      return new Blob([await res.arrayBuffer()], {
        type: ext === "webm" ? "audio/webm" : "audio/mp4",
      });
  }
  throw new Error(`Backup clip ${name} is missing from client/public/demo/.`);
}

// Voice input switch and the hidden backup clips (Labib). The switch is hidden
// where the browser has no speech recognition, e.g. Firefox.
export default function VoiceSettings({ recorder, disabled, onError }) {
  const idle = recorder.status === "idle";
  async function sendClip(name) {
    onError("");
    unlockAudio();
    try {
      await recorder.send(await loadClip(name));
    } catch (e) {
      onError(e.message);
    }
  }
  return (
    <>
      {webSpeechAvailable() && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={recorder.fallback}
            disabled={!idle}
            onChange={(e) => recorder.setFallback(e.target.checked)}
          />
          Use backup voice input {DEMO && <span>(demo)</span>}
        </label>
      )}
      {showClips && (
        <div className="row-actions">
          {CLIPS.map((name, i) => (
            <button
              key={name}
              type="button"
              className="text-button"
              disabled={disabled || !idle}
              onClick={() => void sendClip(name)}
            >
              Backup clip {i + 1}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
