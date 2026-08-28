// Background service worker (MV3). Deliberately thin: no state lives here —
// the app page talks to IndexedDB directly. This worker only wires the
// toolbar icon (and its keyboard shortcut, which fires the same
// action.onClicked event) to open the builder as its own full browser tab —
// not Chrome's Side Panel — so it always gets real width to work with
// instead of whatever sliver the side panel happens to be docked at.
// Clicking the icon again focuses the existing tab rather than piling up
// duplicates.

const APP_PATH = 'sidepanel/index.html';

async function openOrFocusAppTab() {
  const url = chrome.runtime.getURL(APP_PATH);
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

chrome.action.onClicked.addListener(() => {
  openOrFocusAppTab();
});
