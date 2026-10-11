// Printing from a phone fails quietly in a few places, so we say what to do instead of
// leaving the owner tapping a button that seems broken.

// Apps that open links in their own browser (Instagram, Facebook, TikTok, LinkedIn, Snapchat,
// Line, and Android "WebView" pages) usually ignore window.print().
const IN_APP = /FBAN|FBAV|Instagram|Line\/|LinkedInApp|Snapchat|TikTok|musical_ly|; wv\)/i;

const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS says "Mac"

// Opens the print screen, or explains why it can't. `notice` shows a short message.
export function printPage(notice) {
  if (IN_APP.test(navigator.userAgent) || typeof window.print !== "function") {
    notice(
      "Printing doesn’t work inside this app. Open the page in Safari or Chrome, then tap Print.",
    );
    return;
  }
  if (isIOS())
    notice(
      "To save a PDF instead, tap the Share button in the print screen and choose Save to Files.",
    );
  window.print();
}
