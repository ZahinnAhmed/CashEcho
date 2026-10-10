const pool = require('./db');

// Languages the owner can pick, each checked against ElevenLabs one by one.
// Most use the fast Flash v2.5 model. Bengali and Urdu are not supported there, so they use
// the newer Eleven v3 model (ttsModel), which is a little slower.
//   code    ElevenLabs language code
//   name    English name, used when asking Gemini to translate
//   label   what the owner sees in the picker
//   tag     browser speech-recognition tag, for the backup microphone
const LANGUAGES = [
  { code: 'en', name: 'English', label: 'English', tag: 'en-US' },
  { code: 'es', name: 'Spanish', label: 'Español (Spanish)', tag: 'es-US' },
  { code: 'zh', name: 'Mandarin Chinese', label: '中文 (Chinese)', tag: 'zh-CN' },
  { code: 'hi', name: 'Hindi', label: 'हिन्दी (Hindi)', tag: 'hi-IN' },
  { code: 'ar', name: 'Arabic', label: 'العربية (Arabic)', tag: 'ar-SA' },
  { code: 'fr', name: 'French', label: 'Français (French)', tag: 'fr-FR' },
  { code: 'pt', name: 'Portuguese', label: 'Português (Portuguese)', tag: 'pt-BR' },
  { code: 'ru', name: 'Russian', label: 'Русский (Russian)', tag: 'ru-RU' },
  { code: 'ko', name: 'Korean', label: '한국어 (Korean)', tag: 'ko-KR' },
  { code: 'ja', name: 'Japanese', label: '日本語 (Japanese)', tag: 'ja-JP' },
  { code: 'fil', name: 'Filipino', label: 'Filipino', tag: 'fil-PH' },
  { code: 'vi', name: 'Vietnamese', label: 'Tiếng Việt (Vietnamese)', tag: 'vi-VN' },
  { code: 'tr', name: 'Turkish', label: 'Türkçe (Turkish)', tag: 'tr-TR' },
  { code: 'it', name: 'Italian', label: 'Italiano (Italian)', tag: 'it-IT' },
  { code: 'ta', name: 'Tamil', label: 'தமிழ் (Tamil)', tag: 'ta-IN' },
  { code: 'pl', name: 'Polish', label: 'Polski (Polish)', tag: 'pl-PL' },
  { code: 'bn', name: 'Bengali', label: 'বাংলা (Bengali)', tag: 'bn-BD', ttsModel: 'eleven_v3' },
  { code: 'ur', name: 'Urdu', label: 'اردو (Urdu)', tag: 'ur-PK', ttsModel: 'eleven_v3' },
];

const find = (code) => LANGUAGES.find((l) => l.code === code);
const isSupported = (code) => Boolean(find(code));

// The language this owner picked for talking and listening (English if none)
async function getLanguage(userId) {
  const result = await pool.query("SELECT value FROM settings WHERE user_id = $1 AND key = 'language'", [userId]);
  const code = result.rows[0]?.value;
  return isSupported(code) ? code : 'en';
}

async function setLanguage(userId, code) {
  await pool.query(
    `INSERT INTO settings (user_id, key, value) VALUES ($1, 'language', $2)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, code]
  );
}

module.exports = { LANGUAGES, find, isSupported, getLanguage, setLanguage };
