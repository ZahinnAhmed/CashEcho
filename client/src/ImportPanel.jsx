import { useEffect, useRef, useState } from "react";
import { Camera, FileUp, Check, X } from "lucide-react";
import { api } from "./api.js";
import { categories, money, prettyDate } from "./model.js";

const label = (s) => s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

// Phone photos can be 5 MB or more. Shrink them in the browser before uploading, so they
// upload fast and fit the server's size limit. If the browser cannot read the image
// (some HEIC files), the original is sent as is.
async function shrinkImage(file) {
  if (!file.type.startsWith("image/") || file.size < 700 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    return blob
      ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
          type: "image/jpeg",
        })
      : file;
  } catch {
    return file;
  }
}

// Lets a new owner bring in records they already have: a photo of a receipt or notebook page,
// a bank statement PDF, and so on. The assistant lists the entries it finds, the owner
// checks them, and only the ones they keep are saved.
export default function ImportPanel({ onImported, onError, incoming, onIncomingHandled }) {
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const [stage, setStage] = useState("idle"); // idle | reading | review | saving
  const [rows, setRows] = useState([]);
  const [info, setInfo] = useState({ files: 0, skipped: 0 });
  const [original, setOriginal] = useState(null); // the rows before combining, so it can be undone
  const [slow, setSlow] = useState(false); // reading has taken longer than usual

  // After 10 seconds of reading, tell the owner it's still working (the server may be waking up)
  useEffect(() => {
    if (stage !== "reading") return setSlow(false);
    const timer = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(timer);
  }, [stage]);

  // Entries that came from the owner's voice (a whole week said in one go) use the same review
  useEffect(() => {
    if (!incoming?.length) return;
    setRows(incoming.map((t) => ({ ...t, keep: true })));
    setInfo({ files: 0, skipped: 0, spoken: true });
    setOriginal(null);
    setStage("review");
    onIncomingHandled?.();
  }, [incoming]);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 5);
    if (!files.length) return;
    onError("");
    setStage("reading");
    try {
      const prepared = await Promise.all(files.map(shrinkImage));
      const result = await api.importFiles(prepared);
      if (!result.transactions.length) {
        onError(
          "I couldn't find any transactions in that. Try a clearer, well-lit photo, or a different page.",
        );
        setStage("idle");
        return;
      }
      // Entries already in the ledger start unticked so nothing is counted twice
      setRows(result.transactions.map((t) => ({ ...t, keep: !t.duplicate })));
      setInfo({ files: result.files, skipped: result.skipped });
      setStage("review");
    } catch (e) {
      onError(e.message);
      setStage("idle");
    }
  }

  const update = (i, patch) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.keep && Number(r.amount) > 0);

  async function save() {
    setStage("saving");
    try {
      await api.saveBulk(
        chosen.map(({ keep, duplicate, ...t }) => ({
          ...t,
          amount: Number(t.amount),
        })),
      );
      const count = chosen.length;
      setRows([]);
      setStage("idle");
      await onImported(count);
    } catch (e) {
      onError(e.message);
      setStage("review");
    }
  }

  function cancel() {
    setRows([]);
    setOriginal(null);
    setStage("idle");
  }

  // A register ledger lists every small sale. Most owners would rather keep one total per day,
  // so rows with the same date, direction and category are added together.
  function groupRows(list) {
    const groups = new Map();
    for (const r of list) {
      const key = `${r.date}|${r.type}|${r.category}`;
      groups.set(key, [...(groups.get(key) || []), r]);
    }
    return [...groups.values()].map((g) =>
      g.length === 1
        ? g[0]
        : {
            date: g[0].date,
            type: g[0].type,
            category: g[0].category,
            amount: Math.round(g.reduce((n, r) => n + Number(r.amount), 0) * 100) / 100,
            vendor: null,
            payment_method: "other",
            note: `${g.length} entries combined`,
            duplicate: g.every((r) => r.duplicate),
            keep: g.some((r) => r.keep),
          },
    );
  }
  const combinedCount = groupRows(rows).length;
  function combine() {
    setOriginal(rows);
    setRows(groupRows(rows));
  }
  function separate() {
    setRows(original);
    setOriginal(null);
  }

  // Hidden inputs: the first opens the phone's camera, the second the file picker
  const inputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );

  if (stage === "review" || stage === "saving") {
    const dupes = rows.filter((r) => r.duplicate).length;
    return (
      <section className="panel import-panel">
        <div className="section-head">
          <div>
            <h2>{info.spoken ? "Check what I heard" : "Check what we found"}</h2>
            <p className="muted">
              {rows.length} entries from{" "}
              {info.spoken
                ? "what you said"
                : `${info.files} ${info.files === 1 ? "file" : "files"}`}
              {dupes > 0 && `, ${dupes} already in your ledger (unticked)`}
              {info.skipped > 0 && `, ${info.skipped} unreadable skipped`}.
              Fix anything that looks wrong, then add them.
            </p>
          </div>
        </div>
        {original ? (
          <button type="button" className="text-button" onClick={separate}>
            Show the separate entries again
          </button>
        ) : (
          combinedCount < rows.length && !rows.some((r) => r.date_from && r.date_from !== r.date_to) && (
            <button type="button" className="button outline" onClick={combine}>
              Combine into daily totals ({rows.length} → {combinedCount})
            </button>
          )
        )}
        <div className="import-table">
          {rows.map((r, i) => (
            <div
              key={i}
              className={`import-row ${r.keep ? "" : "off"}`}
            >
              <input
                type="checkbox"
                checked={r.keep}
                onChange={(e) => update(i, { keep: e.target.checked })}
                aria-label={`Include entry ${i + 1}`}
              />
              {r.date_from && r.date_from !== r.date_to ? (
                <span className="import-period">
                  {prettyDate(r.date_from)} to {prettyDate(r.date_to)}
                  <small>spread evenly</small>
                </span>
              ) : (
                <input
                  type="date"
                  value={r.date}
                  onChange={(e) => update(i, { date: e.target.value, date_from: undefined, date_to: undefined })}
                  aria-label={`Date of entry ${i + 1}`}
                />
              )}
              <select
                value={r.type}
                onChange={(e) => update(i, { type: e.target.value })}
                aria-label={`Money in or out for entry ${i + 1}`}
              >
                <option value="income">Money in</option>
                <option value="expense">Money out</option>
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={r.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                aria-label={`Amount of entry ${i + 1}`}
              />
              <select
                value={r.category}
                onChange={(e) => update(i, { category: e.target.value })}
                aria-label={`Category of entry ${i + 1}`}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {label(c)}
                  </option>
                ))}
              </select>
              <span className="import-vendor">
                {r.vendor || r.note || ""}
                {r.duplicate && <em className="coverage-tag watch">Already logged</em>}
              </span>
            </div>
          ))}
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="button outline"
            disabled={stage === "saving"}
            onClick={cancel}
          >
            <X size={16} />
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={stage === "saving" || chosen.length === 0}
            onClick={() => void save()}
          >
            {stage === "saving"
              ? "Adding…"
              : `Add ${chosen.length} to my ledger`}
            <Check size={16} />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel import-panel">
      {inputs}
      <h2>Bring in your past records</h2>
      <p className="muted">
        Starting out? Take a photo of a receipt or a notebook page, or upload a
        bank statement or a PDF. We’ll list the entries for you to check, so you
        don’t have to retype anything.
      </p>
      <div className="row-actions import-actions">
        <button
          type="button"
          className="button outline"
          disabled={stage === "reading"}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera size={17} />
          Take a photo
        </button>
        <button
          type="button"
          className="button outline"
          disabled={stage === "reading"}
          onClick={() => fileRef.current?.click()}
        >
          <FileUp size={17} />
          Upload photos or PDFs
        </button>
      </div>
      {stage === "reading" && (
        <p className="muted" role="status">
          {slow
            ? "Still reading… several pages, or a server that was asleep, can take up to a minute."
            : "Reading your records… this usually takes a few seconds."}
        </p>
      )}
    </section>
  );
}
