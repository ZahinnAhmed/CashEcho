import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    const script = existing || document.createElement("script");
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Could not load Google sign-in.")),
      { once: true },
    );
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

// Shows Google's sign-in button. The server tells us the Google client ID; Google gives the
// browser an ID token, and we send it to /api/auth/google to get our own session.
export default function GoogleSignIn({ onSignedIn }) {
  const buttonRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | google | open | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await api.authConfig();
        if (cancelled) return;
        // The server has no Google client ID set, so it isn't asking for a login
        if (!config.enabled) return setStatus("open");

        await loadGoogleScript();
        if (cancelled) return;
        window.google.accounts.id.initialize({
          client_id: config.google_client_id,
          callback: async ({ credential }) => {
            try {
              const user = await api.googleLogin(credential);
              onSignedIn(user);
            } catch (e) {
              setMessage(e.message);
            }
          },
        });
        setStatus("google");
      } catch (e) {
        if (!cancelled) {
          setMessage(e.message);
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onSignedIn]);

  // Draw the button once its container exists
  useEffect(() => {
    if (status === "google" && buttonRef.current) {
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        width: 280,
      });
    }
  }, [status]);

  if (status === "loading") return <p className="login-subtitle">Loading…</p>;
  if (status === "open")
    return (
      <button
        type="button"
        className="button primary login-button"
        onClick={() => onSignedIn(null)}
      >
        Continue
      </button>
    );
  return (
    <div className="google-signin">
      {status === "google" && <div ref={buttonRef} />}
      {message && <p className="login-error">{message}</p>}
    </div>
  );
}
