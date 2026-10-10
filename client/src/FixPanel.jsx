import { useEffect, useState } from "react";
import { api } from "./api.js";

const pct = (p) => `${Math.round(p * 100)}%`;
const TARGETS = [0.1, 0.2, 0.3];

// "How do I fix it?" The server tries what-if versions of the forecast and reports the smallest
// change that brings the chance of running short down to the chosen level.
export default function FixPanel({ refreshKey }) {
  const [target, setTarget] = useState(0.2);
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    api
      .solve(target)
      .then((r) => !cancelled && setResult(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [target, refreshKey]);

  // Nothing useful to show yet
  if (failed || result?.status === "not_enough_data") return null;

  return (
    <section className="panel fix-panel">
      <div className="section-head">
        <div>
          <h2>How to fix it</h2>
          <p className="muted">
            The smallest change that brings your chance of running short down
            to
          </p>
        </div>
        <label className="language-picker">
          <span className="sr-only">Target chance</span>
          <select
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            aria-label="Target chance of running short"
          >
            {TARGETS.map((t) => (
              <option key={t} value={t}>
                {pct(t)} or less
              </option>
            ))}
          </select>
        </label>
      </div>
      {!result && <p className="muted">Working it out…</p>}
      {result?.status === "ok" && (
        <p>
          Your chance of running short is already {pct(result.current_probability)},
          at or under your target.
        </p>
      )}
      {result?.status === "needs_action" && (
        <>
          <p className="muted">
            Right now it’s {pct(result.current_probability)}. Any one of these
            would do it:
          </p>
          <div className="fix-options">
            {result.options.length === 0 && (
              <p>
                No single change gets there on its own. Try a higher target, or
                combine changes.
              </p>
            )}
            {result.options.map((o) => (
              <div key={o.id} className="fix-option">
                <strong>{o.title}</strong>
                <p>{o.detail}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
