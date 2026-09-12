export function createHistory(limit = 80) {
  let past = [];
  let future = [];
  let gestureActive = false;
  return {
    push(doc) {
      past.push(JSON.stringify(doc));
      if (past.length > limit) past.shift();
      future = [];
      gestureActive = false;
    },
    /** Start a drag/gesture: push once; later live updates should not push. */
    beginGesture(doc) {
      if (gestureActive) return;
      past.push(JSON.stringify(doc));
      if (past.length > limit) past.shift();
      future = [];
      gestureActive = true;
    },
    endGesture() {
      gestureActive = false;
    },
    isGesture() {
      return gestureActive;
    },
    undo(current) {
      gestureActive = false;
      if (!past.length) return current;
      future.push(JSON.stringify(current));
      return JSON.parse(past.pop());
    },
    redo(current) {
      gestureActive = false;
      if (!future.length) return current;
      past.push(JSON.stringify(current));
      return JSON.parse(future.pop());
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
