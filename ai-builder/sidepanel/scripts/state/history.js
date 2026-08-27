// Generic undo/redo command stack. A command is {label, do(), undo()}.
// do()/undo() mutate whatever they close over (usually the project object)
// and must return void; the stack itself holds no project state, so undo is
// always O(1) regardless of project size (spec §3 "Command pattern").

const MAX_HISTORY = 200;

export function createHistory(onChange) {
  let undoStack = [];
  let redoStack = [];

  function notify() {
    onChange?.({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
  }

  return {
    push(command) {
      command.do();
      undoStack.push(command);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
      notify();
    },
    undo() {
      const command = undoStack.pop();
      if (!command) return false;
      command.undo();
      redoStack.push(command);
      notify();
      return true;
    },
    redo() {
      const command = redoStack.pop();
      if (!command) return false;
      command.do();
      undoStack.push(command);
      notify();
      return true;
    },
    clear() {
      undoStack = [];
      redoStack = [];
      notify();
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
  };
}
