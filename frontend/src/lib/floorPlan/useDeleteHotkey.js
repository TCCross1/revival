import { useEffect } from "react";

export default function useDeleteHotkey(deleteSelectedRef) {
  useEffect(() => {
    const typingInField = (node) => {
      const tag = String(node?.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || Boolean(node?.isContentEditable);
    };
    const onKey = (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingInField(event.target)) return;
      const removed = deleteSelectedRef.current();
      if (removed) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelectedRef]);
}
