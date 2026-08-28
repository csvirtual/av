// Short, sortable-ish ids. Uses crypto.randomUUID (native, available in both
// the extension and Node >=19 for tests) instead of a uuid dependency, with a
// Math.random fallback so the module never throws in an older environment.
function randomHex(len) {
  let s = '';
  while (s.length < len) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, len);
}

export function makeId(prefix = 'c') {
  const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().slice(0, 8) : randomHex(8);
  return `${prefix}_${id}`;
}
