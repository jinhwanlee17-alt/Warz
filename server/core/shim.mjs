// The game scripts attach themselves to `window.Warz`. Outside a browser, `window` is the global object.
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
