// Background service worker (MV3). Deliberately thin: no state lives here —
// the side panel talks to IndexedDB directly. This worker only wires the
// toolbar icon to open the side panel (Chrome doesn't do this automatically
// unless `openPanelOnActionClick` is set, and setting that from the
// manifest already covers most cases — this is the explicit fallback for
// older Chrome versions that only support the imperative API).

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Older Chrome without setPanelBehavior: fall back to opening on click.
    });
});

if (!chrome.sidePanel?.setPanelBehavior) {
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId });
  });
}
