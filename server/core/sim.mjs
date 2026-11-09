// The authoritative simulation is the browser code itself (config, util, map, world), loaded as-is.
// Works in Node (CommonJS loader) and in the Cloudflare Worker bundle (esbuild) alike.
import './shim.mjs';
import '../../js/config.js';
import '../../js/util.js';
import '../../js/map.js';
import '../../js/world.js';
import '../../js/items.js';
import '../../js/class-combat.js';

export const Warz = globalThis.Warz;
