# Voice layer → frontend: notes for Parsa

From Labib. My branch `labib/voice-layer` (not pushed yet) combines your `my-feature-branch`, Zahin's `server-backend` and the voice layer. Every change to your files is a voice integration point. `npm test` (7/7) and `npm run build` both pass.

## Heads-up: your branch has its own history

The first commit on `my-feature-branch` (`f6e24ef`, "Initial project upload") has no parent, so the branch isn't based on `main`. It doesn't include `main`'s root `.gitignore` or the `server/` folder.

- **Merging it into `main`** needs `git merge --allow-unrelated-histories`. On my branch, I've combined your files with `main` and Zahin's backend by hand.
- **The root `.gitignore` matters:** without it, `server/.env`, which holds our API keys, isn't ignored and could get committed.

API mode works against Zahin's backend. Her `/api/wall` matches the shape in your README, and her parse errors come back as readable messages that your error banner shows as they are.

## What changed in your files

### `client/src/App.jsx`

- **One shared audio player.** All playback now goes through `src/lib/voiceClient.js`. iPhone Safari blocks `audio.play()` unless a tap started that element. The old `new Audio()` ran after `await api.save()` and `await load()`, so the read-back was silent on iPhone. `unlockAudio()` now runs synchronously in three tap handlers: the mic button, `save()` (Confirm) and `playAlert()`.
- **`playAudio()` and `say()`** are thin wrappers over `playSound()` and `speak()`, and they still drive `playing`. `audioRef` and `urlRef` are gone; the unmount cleanup calls `stopAudio()`.
- **`save()`** starts the read-back right after the save without awaiting it, then runs `load()`. The line ("Logged $340 expense, supplies.") comes from `confirmationLine()`.
- **`parse()`** now calls `setText(textValue)` first, so a spoken transcript stays in the text box if parsing or validation fails.
- **`playAlert()` in API mode:**
  1. It plays `audio_url` or `audioUrl`.
  2. If playback fails, it speaks `text`.
  3. If `/api/alert` fails entirely, it plays `/demo/alert.mp3`, and if that is missing it speaks your local `alertText`.
- **The inline toggle** is replaced, in the same spot, by `<VoiceSettings recorder={recorder} disabled={busy || !!draft} onError={setError} />`.

### `client/src/api.js`

- **Error details.** Errors from `request()` now carry `.error` (the server's code), `.fallback` and `.status`.
- **Friendly messages.** The voice codes `no_audio`, `audio_too_large`, `empty_transcript`, `transcribe_failed`, `parse_failed` and `save_failed` get readable messages. Other errors read the same as before.
- **Stage tags.** Failures from `parse` and `save` are tagged `error: "parse_failed"` and `"save_failed"`. Transcribe failures keep the server's code, defaulting to `transcribe_failed`.

### `client/src/useRecorder.js`

- **The browser-speech switch is remembered** per browser, in `localStorage` under `cashecho.voiceFallback`. With nothing stored, it defaults to `DEMO` as before. It's always off where the browser has no speech recognition.
- **New `send(blob)`**, used by `rec.onstop` and by the backup clips. If the server replies `fallback: true`, it turns browser speech on and tells the user to tap the mic again.

## Behavior you'll notice

- **Demo mode tries ElevenLabs first.** The read-back and Hear alert call `/api/speak`, then fall back to the browser voice. With no backend running, the request fails fast and it sounds the same as before. Your demo note ("…browser voice… ElevenLabs requires the backend.") is now slightly off; reword it if you like.
- **The toggle reads "Use backup voice input."** It's hidden in browsers without speech recognition (Firefox), so nobody gets stuck in fallback mode there.
- **Hidden demo controls.** Adding `?demo=1` to the URL shows "Backup clip 1" and "Backup clip 2" under the mic.
  - Each sends `client/public/demo/tx1` or `tx2` (`.webm`, `.mp4` or `.m4a`) through the real transcribe → parse → confirm path.
  - This is separate from `VITE_DEMO_MODE`.
  - The buttons use your `row-actions` and `text-button` classes; restyle them freely.

## New files (mine)

- `client/src/lib/voiceClient.js`: the shared player, `unlockAudio`, `speak` (ElevenLabs, then the browser voice), `confirmationLine` and storage for the fallback switch.
- `client/src/components/VoiceSettings.jsx`: the toggle and the hidden backup clips.
- `client/public/demo/`: the backup clips and `alert.mp3` (recordings coming).

## Questions for you

1. Are you OK with where the toggle and the backup-clip buttons sit?
2. In API mode, the banner shows your local `alertText`, but Hear alert speaks the Gemini text from `/api/alert`. Should the banner show the API text when there is one?
3. Once we're on Vercel, can we test the mic and the read-back together on an iPhone over HTTPS? That's the one thing localhost can't check.
