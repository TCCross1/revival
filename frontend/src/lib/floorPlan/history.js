export function createHistory(limit = 80) {
  let past = [];
  let future = [];
  return {
    push(doc) {
      past.push(JSON.stringify(doc));
      if (past.length > limit) past.shift();
      future = [];
    },
    undo(current) {
      if (!past.length) return current;
      future.push(JSON.stringify(current));
      return JSON.parse(past.pop());
    },
    redo(current) {
      if (!future.length) return current;
      past.push(JSON.stringify(current));
      return JSON.parse(future.pop());
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
