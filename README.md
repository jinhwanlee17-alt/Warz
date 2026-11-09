# warz.io

A fast-paced top-down battle royale with real online multiplayer. You are a dot with a gun (diep.io style):
`WASD` moves, the mouse aims, and clicking fires along your barrel. Every match drops up to 50 players onto a
freshly generated island, zombsroyale style. Collect tokens, upgrade at stations, outlast the storm.

- **Online**: Solo, Duos, Trios, Squads with friends (invites) or random fill. Knocked-down teammates can be
  revived; medics heal the team. Accounts, friends and presence are live. Google and Apple sign-in are supported.
- **Free hosting**: the whole game (files + server) deploys to **Cloudflare Workers + Durable Objects** on the
  free plan. There is also a Node server for LAN play and tests. Both run the same code.
- **Offline**: with no server, Play offers a solo Practice match that runs entirely in the browser.

## Play right now (local)

```
npm start                 # http://localhost:5180  (Node server: game files + matchmaking + matches)
```

Open the address in two browser windows, press **Play → Solo** in both, and the match starts once the lobby
countdown runs (defaults: 2+ players, 20 s). Friends on your Wi-Fi can join at `http://<your-ip>:5180`.

Other commands:

```
npm test                  # Node suites: rules, map + simulation, teams, menu demo, controls, websocket, auth, full server
npm run qa                # headless Chrome: offline practice flow with screenshots in output/qa/
npm run qa:online         # two headless Chrome tabs vs the Node server: accounts, friends, party, duos, solo duel
npm run dev:cf            # the Cloudflare Worker locally (wrangler dev) at http://localhost:8787
npm run dev               # static files only (no server; Practice works, online modes are disabled)
```

## Deploy for free on Cloudflare

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) (no card needed).
2. In this folder: `npx wrangler login`, then `npm run deploy`.
3. Wrangler prints your URL, e.g. `https://warz-io.<your-account>.workers.dev`. Share it. That's the game.

What runs where: static assets serve `index.html`, `js/` and `css/`; one **Hub** Durable Object handles accounts,
friends, parties and matchmaking; each match runs in its own **Match** Durable Object (20 Hz authoritative
simulation, the same `js/world.js` the browser uses). Accounts are stored in the Hub's Durable Object storage.

Settings live in `wrangler.toml` (`LOBBY_MIN`, `LOBBY_COUNTDOWN`, `LOBBY_MAX`) or as secrets:

```
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put APPLE_CLIENT_ID
npx wrangler secret put PUBLIC_URL        # https://warz-io.<your-account>.workers.dev
```

**Free-plan budget** (as of late 2025): Durable Objects get 100,000 requests and 13,000 GB-seconds of
duration per day. Every 20 incoming WebSocket messages count as one request, and a match object is "on" while it
runs. In practice a group of friends can play for a few hours a day. Idle browser tabs disconnect from the hub
after five minutes hidden so they don't eat the budget.

## Google sign-in (free, ~5 minutes)

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID**
   → application type **Web application**.
2. **Authorized JavaScript origins**: add your game URL (e.g. `https://warz-io.<account>.workers.dev`) and, for local
   testing, `http://localhost:8787` and `http://localhost:5180`.
3. Copy the client ID (`...apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID` (Cloudflare secret, or the env var
   for the Node server). Restart/redeploy. The **Continue with Google** button appears under Settings → Account.

The browser gets an ID token from Google; the server verifies its signature against Google's published keys and
its audience against your client ID before creating or signing in the account. First-time Google users pick a
username.

## Apple sign-in

Apple requires a paid Apple Developer account ($99/year) and an **https** page:

1. Apple Developer → Certificates, Identifiers & Profiles → **Identifiers**: create an **App ID** with the
   "Sign in with Apple" capability, then a **Services ID** (this is your client ID, e.g. `com.yourname.warz.web`).
2. Configure the Services ID: domain `warz-io.<account>.workers.dev`, return URL `https://warz-io.<account>.workers.dev/`.
3. Set `APPLE_CLIENT_ID` to the Services ID and `PUBLIC_URL` to your https URL. The **Continue with Apple** button
   enables itself on https pages only.

The server verifies Apple's ID token the same way (issuer `https://appleid.apple.com`, your Services ID as audience).

## Match rules

| | |
| --- | --- |
| Lobby | up to 50 players; a match starts after the countdown once `LOBBY_MIN` players are queued |
| Modes | Solo, Duos, Trios, Squads. Teams: no friendly fire except commander airstrikes; grenades can damage their thrower, team medkit heals, knocked-down players bleed out in 30 s unless a teammate holds `E` next to them (medics revive twice as fast). When the last standing member falls, the team is out. |
| Spawn | random Drop Station (16 per island, teams share one), 1.8 s parachute drop |
| Start | Soldier: 100 HP, 0 armor, Basic AR + Basic Pistol |
| Tokens | a few in the open, in buildings and inside every crate. **8 tokens buy level 1; 15 tokens buy level 2.** |
| Crates | 90 regular crates: 80% common, 10% rare, 8% epic, 2% mythic (whole-crate rounding). Exactly one legendary crate at the center drops all four legendary items and announces its destruction to everyone. |
| Items | One five-slot hotbar: two weapons/class gear (`1`–`2`) and three items (`3`–`5`). Press `E` near an item to pick it up; select an item and left click to use it or `Q` to drop its entire stack. `Tab` opens item details. Class weapons stay with you. See **Items** below. |
| Upgrade Stations | 9 per island (glowing blue hexagons). `E` opens the class tree. A used station recharges for **1:30** unless you spend a **station key**. |
| Ammo | infinite; magazines reload automatically |
| Storm | forms at 2:30, then shrinks in five steps; damage grows each step |
| Map | Three times the previous width and height (nine times the area). M opens the full map: white arrow = you, blue = teammates, red = enemies revealed continuously by radar or drone. |
| Placement | last team standing wins; everyone else gets their placement when their team is out |

## Classes

You pick **one** Lvl 1 class per match; the other branches lock. Then spend 15 tokens on the matching class upgrade or Pyromancer, Juggernaut or Commander. Each level-one class shows five choices including the planned Armor Crewmember. Armor Crewmember remains planned for vehicles; see [vehicle requirements](docs/vehicle-design.md).

| Class | HP | Loadout |
| --- | --- | --- |
| Soldier (start) | 100 | Basic AR (10 dmg, 20 rounds) + Basic Pistol (8 dmg, 10 rounds) |
| Sniper | 95 | Sniper Rifle (95 dmg, 1 round; hold right click to scope out) + Basic Pistol |
| Shotgunner | 100 | Shotgun (5–115 dmg by distance, 5 rounds) + Deagle (45 dmg, 6 rounds) |
| Medic | 100 | Basic Pistol + Medic's Medkit (+30 HP to you and teammates within reach, 50 s cooldown) |
| Grenadier | 100 | Grenade Launcher (10 rounds, endless grenades, 0–37.5 dmg, burst 0.5 s after landing) + 10 hand grenades (0–100) |

## Level-two classes

| Branch | Upgrade | Stats and equipment |
| --- | --- | --- |
| Medic | Medic II | 100 HP; Deagle (45 damage); medkit heals 50 HP and revives allies at 50% maximum HP |
| Shotgunner | Shotgunner II | 135 HP; shotgun 10–200 damage; Deagle (45 damage) |
| Sniper | Sniper II | 95 HP; wider scope; 3-round rifle with unlimited island range and damage rising from 95 to 300 over 2,100 units |
| Grenadier | Grenadier II | 115 HP; launcher 0–70 damage with 0.2-second landing fuse; destroys rocks and crates in one blast |
| Any level 1 | Pyromancer | 135 HP, 10% slower; splash flamethrower ticks every 0.15 seconds, ramping 10/15/20/…/50 damage; 75-damage, 5-round revolver |
| Any level 1 | Juggernaut | 150 HP, 25% slower; 5-damage minigun with 0.75-second spin-up and 20 rounds/second; basic pistol |
| Any level 1 | Commander | 100 HP; 15-damage, 12-round pistol; radar grants the team +25% damage/speed/fire rate for 15 seconds, with a 45-second cooldown. Cursor airstrike warns for 5 seconds, radius 450, then deals 500 damage to everyone inside, including allies |

Hold fire to preview any grenade or launcher arc, then release to throw over walls/buildings. Hold/release the gear key also aims the Grenadier's hand grenade. Grenades can damage their owner. Sentries target opposing players first, then crates. Foliage has no hidden center collision.

## Items

| Rarity | Items |
| --- | --- |
| Common | Bandages (+20 HP, sets of 3), Flash Bang (grenade range and timing, whites out the screen), Grenade (like the Grenadier's, pairs), Smoke Grenade (3× a grenade, 12 s), Smoothie (+15 HP), Energy Bar (+15% speed, 20 s) |
| Rare | Grenade of Fire (bursts on landing, 2× wide fire wall, 25 HP/s for 5 s, spares your team), Shieldo Shieldo (1 s immune to weapons, then 50% less damage for 5 s), First Aid Kit (+100 HP over 15 s), Strength (+10% dmg, 30 s), Speed (+15%, 45 s), Health (+75), Shield (−15% damage taken, 30 s), Poison Potion (thrown: 10 HP/s for 10 s and half speed to enemies splashed), Mystery Potion (random potion effect, poison included) |
| Epic | Drone (every enemy on your team's map for 1 min), Rock (double-size boulder, blue to its team and red to enemies; owner or teammates can reclaim it with E), Riot Shield (blocks everything from the front while held, −75% speed), Turret (place, then `E` to mount: 15 dmg, faster than an AR, 100 HP; damage hits the rider), Sentry (automatic, never misses, 5 dmg at pistol speed, 50 HP), Black Hole Grenade (bursts on landing, pulls enemies and loose pickups within 3× a grenade into its middle), Snowbomb (5× a grenade, 10 s, half speed, storm damage after 4 s inside), Overheal Potion (+30 HP up to 130) |
| Mythic | Invisibility (30 s, only your team sees you; shooting still shows muzzle flashes), Radar (pings enemies within 7× a grenade for 30 s), Teleporter (pairs: stand 1 s on your pad, 3 s on someone else's), Turret II (200 HP, 20 dmg, 2× fire rate), Sentry II (100 HP, 10 dmg, 2× rate), Lightning Strike (click an enemy, auto-aims within a grenade radius; 1 s later 50 true damage through armor, shields and overheal; stacks of 5), Power Potion (+15% dmg/speed, −15% damage taken, 1 min) |
| Legendary | Turret III (500 HP, 30 dmg, Turret II rate), Sentry III (700 HP, 30 dmg, Turret rate), Power Potion II (1:15 of Power plus 10 s death immunity: a killing blow leaves you at 30 HP and ends the potion), Meteor Launcher (3 meteors: click a spot, 2 s later 99 damage across 2× a grenade) |

Your items drop where you die. All numbers live in `W.ITEMS` / `W.CRATES` in `js/config.js`.

## Controls (defaults, rebindable in Settings)

`WASD` move · mouse aim · left click shoot or use the held item · right click scope (Sniper) · `1` `2` / wheel switch weapon ·
`3`–`5` hold a hotbar item · `R` reload · `F`/`G` gear (medkit / grenade) ·
`Q` drop the held item stack · `E` pick up item / Upgrade Station / mount a turret / hold to revive · `Tab` inventory · `M` map · `Esc` menu

## How the online play works

- One WebSocket to the **hub** for the menu (accounts, friends, parties, queue). When a match forms, the hub hands
  every player a one-time ticket; the client opens a second WebSocket to that **match**.
- The match simulates at 20 Hz, accepts inputs (move, aim angle, buttons), and sends each player compact snapshots
  of what is near them plus replicated events (shots, blasts, damage, pickups, crate HP, station use, knocks, kills).
- The browser predicts its own movement and reconciles with the server; other players are interpolated; bullets and
  grenades are mirrored cosmetically (hits are decided only on the server).
- Dropping and reconnecting puts you back into your running match. Leaving a match counts as an elimination.

## Code map

| | |
| --- | --- |
| `js/config.js` | all tuning numbers, classes, weapons, modes, tree layout and the pure upgrade rules |
| `js/map.js`, `js/world.js`, `js/items.js` | island generator, the simulation and the item system (shared with the server; `remote` mode mirrors them in the browser) |
| `js/render.js`, `js/hud.js`, `js/inventory.js`, `js/map-art.js`, `js/map-screen.js`, `js/upgrade-tree.js` | drawing and in-match UI |
| `js/input.js`, `js/controls.js` | key/mouse state and rebindable actions |
| `js/net.js`, `js/online.js`, `js/account.js`, `js/menu.js`, `js/main.js` | hub/match sockets, the online match mirror, account/party/lobby state, dialogs, app flow |
| `server/core/` | platform-neutral server: `auth.mjs` (PBKDF2, sessions, Google/Apple token verification), `accounts.mjs`, `lobby.mjs`, `match.mjs`, `hub.mjs`, `sim.mjs` |
| `server/cf/worker.mjs` | Cloudflare Worker + Durable Objects (`wrangler.toml`, `.assetsignore`) |
| `server/node/index.mjs` | Node adapter (`ws.mjs` zero-dependency WebSocket server, JSON file store) |
| `tests/`, `tools/` | Node smoke suites, headless-Chrome QA scripts |
