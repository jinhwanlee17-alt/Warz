// The authoritative simulation is the browser code itself (config, util, map, world), loaded as-is.
// Works in Node (CommonJS loader) and in the Cloudflare Worker bundle (esbuild) alike.
import './shim.mjs';
import '../../js/config.js';
import '../../js/cosmetics.js';
import '../../js/util.js';
import '../../js/biomes.js';
import '../../js/map.js';
import '../../js/world.js';
import '../../js/items.js';
import '../../js/class-combat.js';
import '../../js/vehicles.js';
import '../../js/sentry-combat.js';
import '../../js/level3-combat.js';
import '../../js/engineer.js';
import '../../js/rpg.js';
import '../../js/magic-medic.js';
import '../../js/pyromaniac.js';
import '../../js/artillery.js';

export const Warz = globalThis.Warz;
