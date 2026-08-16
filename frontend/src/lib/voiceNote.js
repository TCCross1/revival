export function voiceSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startVoiceNote({ onText, onError, onEnd }) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) {
    onError?.(new Error("Voice notes need Safari or Chrome on this phone."));
    return null;
  }
  const rec = new Rec();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript || "";
    if (text.trim()) onText?.(text.trim());
  };
  rec.onerror = (event) => {
    if (event.error === "not-allowed") {
      onError?.(new Error("Allow the microphone to save a voice note."));
      return;
    }
    if (event.error === "no-speech") {
      onError?.(new Error("I didn’t catch that. Tap voice and try again."));
      return;
    }
    onError?.(new Error("Could not take that voice note. Type it instead."));
  };
  rec.onend = () => onEnd?.();
  try {
    rec.start();
  } catch (err) {
    onError?.(err);
    return null;
  }
  return rec;
}
