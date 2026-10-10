import { Volume2, X } from "lucide-react";

// Shows what the assistant said back to a question, so it can be read as well as heard. It is a
// live region, so a screen reader announces a new answer by itself.
export default function AnswerCard({ reply, onReplay, onClose }) {
  return (
    <section
      className={`panel answer-card ${reply.asking ? "asking" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="section-head">
        <div>
          <p className="eyebrow">{reply.asking ? "ONE QUICK QUESTION" : "ANSWER"}</p>
          <h2>{reply.text}</h2>
          <p className="muted">
            {reply.asking
              ? "Tap the mic and tell me, or type it below."
              : `You asked: “${reply.question}”`}
          </p>
        </div>
        <div className="row-actions">
          <button type="button" className="button outline" onClick={onReplay}>
            <Volume2 size={16} />
            Hear it again
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close this answer"
          >
            <X />
          </button>
        </div>
      </div>
    </section>
  );
}
