// Minimal pub/sub store. Not Redux, not a framework — the app is small
// enough that "object + listeners" is the honest amount of state management.

export function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    setState(patch) {
      state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
      for (const fn of listeners) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const store = createStore({
  project: null,
  activePageId: null,
  selectedNodeId: null,
  hoveredNodeId: null,
  device: 'mobile',
  viewMode: 'visual', // 'visual' | 'code'
  codeTab: 'html',
  issues: [],
  consoleEntries: [],
  aiProvider: 'local',
});
