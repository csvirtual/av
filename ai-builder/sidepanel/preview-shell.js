// Runs ONLY inside the sandboxed iframe declared in manifest.json's
// `sandbox.pages` — that's what gives this specific page a relaxed CSP
// (script-src/style-src 'unsafe-inline') independent of the rest of the
// extension, which stays locked down to 'self'. This is the Chrome-documented
// pattern for running dynamically-generated content safely: the page has no
// access to chrome.* APIs and (loaded with `sandbox="allow-scripts"`, no
// `allow-same-origin`, from runtime/preview.js) a unique opaque origin, so a
// relaxed CSP here never weakens the extension itself.
//
// The parent posts the generated app's {html, css, js} once per render; this
// injects it by setting innerHTML/textContent and appending fresh <script>
// elements (which DOES execute here, unlike in the parent's own CSP).
(function () {
  function inject(payload) {
    document.title = payload.title || 'Preview';
    document.getElementById('av-shell-style').textContent = payload.css || '';
    document.body.innerHTML = payload.html || '';

    var script = document.createElement('script');
    script.textContent = payload.js || '';
    document.body.appendChild(script);

    if (payload.extraScript) {
      var extra = document.createElement('script');
      extra.textContent = payload.extraScript;
      document.body.appendChild(extra);
    }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.source === 'av-builder' && d.type === 'load') inject(d);
  });

  // Tells runtime/preview.js this (freshly navigated) instance is ready to
  // receive content — avoids a race where content is posted before this
  // listener exists.
  window.parent.postMessage({ source: 'av-preview-shell', type: 'ready' }, '*');
})();
