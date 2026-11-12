# warz.io

A fast-paced top-down battle royale with real online multiplayer. You are a dot with a gun (diep.io style):
`WASD` moves, the mouse aims, and clicking fires along your barrel. Every match drops up to 50 players onto a
freshly generated island, zombsroyale style. Collect tokens, upgrade at stations, outlast the storm.

- **Online**: Solo, Duos, Trios, Squads with friends (invites) or random fill. Knocked-down teammates can be
  revived; medics heal the team. Accounts, friends and presence are live. Google and Apple sign-in are supported.
- **Bots**: every online match has 50 players. Bots fill the seats real players don't take, and a bot gives up its
  seat for every player who joins the lobby. They loot, upgrade, use items and fight like players, some better
  than others. See **Bots** below.
- **Free hosting**: the whole game (files + server) deploys to **Cloudflare Workers + Durable Objects** on the
  free plan. There is also a Node server for LAN play and tests. Both run the same code.
- **Offline**: with no server, Play offers a solo Practice match that runs entirely in the browser.

## Play right now (local)

```
npm start                 # http://localhost:5180  (Node server: game files + matchmaking + matches)
```

Press **Play → Solo**: the lobby shows 50 players, and the match starts when the countdown runs out (20 s by
default). Open the address in a second window and join the same lobby; a bot makes way for the second
player while the displayed total stays at 50. Friends on your Wi-Fi can join at `http://<your-ip>:5180`.

Other commands:

```
npm test                  # Node suites: rules, map + simulation, teams, menu demo, controls, websocket, auth, full server, bots
npm run test:bots         # only the bot suites: behaviours one at a time, whole 50-bot matches, lobby + match over sockets
npm run qa                # headless Chrome: offline practice flow with screenshots in output/qa/
npm run qa:online         # two headless Chrome tabs vs the Node server: accounts, friends, party, duos, solo duel (bots off)
npm run qa:bots           # headless Chrome vs the Node server with bots: the 50-player lobby, a match among bots, a bot teammate
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

Settings live in `wrangler.toml` (`LOBBY_MIN`, `LOBBY_COUNTDOWN`, `LOBBY_MAX`, `BOT_FILL`, `BOT_SKILL`) or as secrets:

```
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put APPLE_CLIENT_ID
npx wrangler secret put PUBLIC_URL        # https://warz-io.<your-account>.workers.dev
```

**Free-plan budget** (as of late 2025): Durable Objects get 100,000 requests and 13,000 GB-seconds of
duration per day. Every 20 incoming WebSocket messages count as one request, and a match object is "on" while it
runs. In practice a group of friends can play for a few hours a day. Idle browser tabs disconnect from the hub
after five minutes hidden so they don't eat the budget. With bots one player is enough to start a match, so every
solo queue now turns a match object on for as long as that player stays in it (a match everyone has left ends
itself after ten seconds; a player whose connection merely dropped is waited for while their body stands, 25 seconds;
bots never keep a match running). The bots themselves are cheap: a whole 50-player tick takes
about a quarter of a millisecond on a desktop CPU, and there are 50 ms to spend.

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
| Lobby | always 50 players: bots fill the seats real players don't take, and each player who joins takes a bot's seat (5 players wait with 45 bots; a sixth makes it 6 and 44). The countdown (`LOBBY_COUNTDOWN`, 20 s) starts with the first player in the queue; `LOBBY_MIN` real players (1) are needed to start. |
| Modes | Solo, Duos, Trios, Squads. Teams: no friendly fire except commander airstrikes; grenades can damage their thrower, team medkit heals, knocked-down players bleed out in 30 s unless a teammate holds `E` next to them (medics revive twice as fast). When the last standing member falls, the team is out. |
| Spawn | evenly spaced coastal Drop Stations: 50 Solo, 25 Duos, 16 Trios, 12 Squads; 1.8 s parachute drop. Teammates land together; extra partial/no-fill teams receive separate nearby coastal positions |
| Start | Soldier: 100 HP, 0 armor, Basic AR + Basic Pistol |
| Tokens | a few in the open, in buildings and inside every crate. **8 tokens buy level 1; 15 tokens buy level 2; 40 tokens buy level 3.** |
| Crates | 210 regular crates: 80% common, 10% rare, 8% epic, 2% mythic (whole-crate rounding). Exactly one legendary crate at the center drops all four legendary items and announces its destruction to everyone. Its gold marker appears on both maps until the crate breaks. |
| Items | Two weapons/class gear (`1`–`2`) and three items (`3`–`5`); Engineer adds its hammer in slot `3` and moves that item to `6`. Press `E` near an item to pick it up; select an item and left click to use it or `Q` to drop its entire stack. `Tab` opens item details. Class weapons stay with you. See **Items** below. |
| Upgrade Stations | 9 per island (glowing blue hexagons). `E` opens the class tree. A used station recharges for **1:30** unless you spend a **station key**. |
| Ammo | infinite; magazines reload automatically |
| Humvees | Eight per island on a slightly varied inner ring, 1,000 HP each. WASD steers through gradual curves at up to 378 units/s (30% slower than the previous speed). At cruising speed the hull crushes contacted crates of every tier, releasing their normal loot; slower vehicles stop against crates. Ram damage is 65 × current speed / maximum speed. E boards from any side or exits. Seats fill in order: driver, machine gunner if equipped, then rear passengers, limited by the match team size. Solo vehicles have only a driver seat. In team modes every Humvee has two rear passenger seats; two also have a separate Turret I gunner position on the side. The hull absorbs damage for all occupants. A destroyed Humvee ejects its crew and remains an indestructible, solid wreck. |
| Tanks | Four per island near the inner ring; 5,000 HP and smooth steering at up to 382.725 units/s (30% slower than the previous speed). One driver can move and fire: `1` selects the cannon (infinite shells, 3-second interval, 75-unit blast radius, 75-500 damage with 500 on a direct hit); `2` selects the machine gun (Turret I fire rate, 8 damage, 1,000 rounds, 4-second reload). In Duos the second rider controls both weapons with 1/2. In Trios and Squads the second rider operates the cannon, the third operates the machine gun, and the fourth is a passenger. E boards from any side into the first available seat; occupied weapon seats take precedence over the driver. All riders are protected by the hull. |
| Vehicle impacts | Humvees and tanks lose 10 HP per crate crushed or player rammed. A full-speed tank instantly breaks natural rocks, loses 50 hull HP and halves its speed. A full-speed ram into a player-placed rock deals 100 rock damage, costs 75 hull HP and stops the tank completely, including the hit that breaks the rock. |
| Rocks | Natural rocks have no HP, health bar or damage stages: they are intact until a tank cannon or full-speed tank ram breaks them outright. Other attacks leave them intact. Player-placed rocks have 1,000 HP, health bars and damage cracks; they take 100 damage per full-speed tank ram and break at 0 HP. Their owner or teammates can still reclaim them. |
| Armor Crewmember | Available from any level-one class for 15 tokens: 150 HP, permanent 10% personal damage reduction, 30-damage melee hammer and regular pistol. Humvee driving is 15% faster; vehicle weapons deal 5% more damage; tank weapons fire 15% faster. The cannon holds two rounds with a short firing gap and a fixed 3-second reload. F/G toggles nearby vehicle repair: 100 HP every 3.5 seconds for a Humvee, or every 2 seconds for a tank. Moving, attacking, changing tools, boarding, or completing repair stops it. Repairing exposes the crew member on the map to enemies within 2.5 smoke radii (1125 units), only while repair continues and that enemy remains in range. The armor HUD bar is removed. |
| Placed turrets | Larger 38-unit platforms seat the player at their center immediately on placement. Hold fire to operate; `E` dismounts to a clear position. |
| Storm | Safe island area: 100% initially, then 80%, 50%, 20%, 5%, 2.5%, and 0%. Each circle shifts within the previous circle. Waits before closing are 2:30, 3:00, 3:30, 4:00, 4:30, and 5:00; closure durations are 45, 40, 35, 30, 25, and 30 seconds. Damage grows each step. |
| Map | 24,000 units wide and tall: 25% wider and taller than the previous 19,200-unit island, with the same terrain density. M opens the full map: white arrow = you, blue = teammates, red = enemies revealed continuously by radar or drone. |
| Placement | last team standing wins; everyone else gets their placement when their team is out |

## Bots

Bots live on the server, inside the match (`server/core/bots/`). Each one is an ordinary player whose inputs come
from code instead of a socket: it returns the same move / aim / fire / item intent a browser sends, so every rule
that applies to a player applies to a bot. Offline Practice starts without bots. In **Esc → Settings**, choose **Spawn practice bot** to add a nearby stationary target with unlimited HP. It never attacks or picks up loot, while hits still show damage numbers. The same button is available in the pause menu's practice tools.

- **The lobby**: in team modes bots first fill the open spots on teams that have Fill switched on, then make up
  whole teams until there are 50 players. A party with Fill off keeps its empty spots. Bots have ordinary names
  and no special labels in the menus or match; the lobby shows one combined player count and fill bar.
- **What they know**: only what a player's screen would show. No seeing under tree canopies or roofs, into smoke,
  beyond the edge of the view, or invisible players; a muzzle flash, a bullet going past, radar and the drone give
  people away exactly as they do to a player. Noticing takes a reaction time, aiming lags and wobbles.
- **How good they are**: skill is rolled per bot. About a fifth are clearly weak, a bit over half average, a
  fifth clearly better and one in twenty sharp. Clear, in-range shots target roughly 60-90% accuracy by skill,
  including close targets; movement, distance and cover can reduce actual hits. Aim errors change the firing
  direction, and ordinary projectile collision determines hits. The best bot still takes about a fifth of a
  second to react. Each also has its
  own aggression, caution and class plan. `BOT_SKILL` (`"0"` easy … `"1"` hard, default `"0.5"`) slides the whole
  lobby down or up and also sets how readily bots go after players who have left them alone.
- **What they do**: land, open crates (indoor ones have to be found), pick up and swap items, save tokens for the
  class they want and walk to an Upgrade Station, rotate ahead of the storm, keep out of fire, airstrikes and big
  sentries (and shoot those down from outside their reach). In a fight they pick the right gun for the distance,
  strafe, reload behind cover, back off and heal when it goes badly, and use what they carry with a purpose: a
  boulder between them and the shooter and a snowbomb on the chaser to get away, smoke or a riot shield to revive
  under fire, flashbang before a shotgun push, black hole then grenade, a teleporter pad left somewhere safe.
- **Toward players**: nobody opens fire on a player in the first seconds after landing, bots do not gang up on
  one player (a second bot team-mate joins a fight a moment after the first), and through the middle of a match
  most bots leave a player alone unless shot at, crowded or met in the same room. As the circle shrinks they go
  looking. A bot on your team follows you, fights who you fight and revives you.
- **Pacing**: how readily bots fight *each other* follows a target curve for the number of players left, so a
  match is still populated when the storm closes in (about 35 left at 2:30, 17 at 5:00, a winner at about 7:30).

`BOT_FILL = "0"` turns bots off; with that, set `LOBBY_MIN` to the number of real players a match should wait for.
(A match never starts with one player and nobody to play against: without bots, or with a fill no bigger than one
team, the lobby waits for a second player whatever `LOBBY_MIN` says.)

## Classes

You pick **one** Lvl 1 class per match; the other branches lock. Then spend 15 tokens on the matching class upgrade or Pyromancer, Juggernaut or Commander. Each level-one class shows five playable choices, including Armor Crewmember. See [Armor Crewmember rules](docs/vehicle-design.md).

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
| Grenadier | Grenadier II | 115 HP; launcher 0–70 damage with 0.2-second landing fuse; destroys crates in one blast |
| Any level 1 | Pyromancer | 135 HP, 10% slower; splash flamethrower ticks every 0.15 seconds, ramping 10/15/20/…/50 damage; 75-damage, 5-round revolver |
| Any level 1 | Juggernaut | 150 HP, 25% slower; 5-damage minigun with 0.75-second spin-up and 20 rounds/second; basic pistol |
| Any level 1 | Commander | 100 HP; 15-damage, 12-round pistol; radar grants the team +25% damage/speed/fire rate for 15 seconds, with a 45-second cooldown. Cursor airstrike warns for 5 seconds, radius 225, then deals 250 damage to everyone inside, including allies |

Aim in a direction and release fire to throw a grenade or launcher shell. A quick tap gives a short throw; holding for 0.75 seconds reaches maximum range, with the preview growing as you charge. Mouse distance does not set range. Hand grenades reach 560 world units, the launcher 660, and Launcher II 700. Hold/release the gear key also charges the Grenadier's hand grenade. Grenades can damage their owner. Sentries target opposing players and occupied enemy vehicles first, then crates. Vehicle hits damage the hull, preserving occupants' HP. Foliage has no hidden center collision.

## Level-three classes

Engineer and Shield Operator are available from **any level-two class for 40 tokens** and have 100 HP. Rocketeer requires **Grenadier II**, costs **40 tokens**, and has **65 HP**. All use the same station recharge and key rules.

Shotgunner III requires **Shotgunner II** and Magic Medic requires **Medic II**, each for **40 tokens**. Shotgunner III has **175 HP**, permanent **25% damage resistance**, and **10% extra damage** with everything it uses. Shotgun III deals 50–500 base damage by distance; Dual Heavy Revolvers fire two 75-base-damage bullets together, consuming two of their ten rounds per click.

Magic Medic has **300 HP**, a Heavy Revolver, Medic Staff, and Medic's Medkit in slots 1–3. As with Engineer, the old slot-3 item moves to slot 6. The medkit adds **300 HP**, including overheal, to one player and recharges for **30 seconds**. With it selected, click a teammate to heal them or click empty ground to heal yourself; press E beside a teammate to heal them. Holding E revives teammates to full health without an item or medkit charge.

Equip the staff to heal the nearby teammate with the lowest health percentage, excluding yourself, within a grenade's radius. Click to place it; press E nearby to pick it up. A placed staff shares its total healing rate evenly among injured teammates within a fire grenade's radius, including its owner, and displays a waypoint to everyone. Healing stops at maximum HP without removing existing overheal. Its stages advance while healing; switching between held and placed restarts those stages. Completing a cycle starts a **25-second recharge**, which switching modes cannot bypass.

| Staff mode | Healing rate and duration, in order |
| --- | --- |
| Held | 1 HP/s for 10s; 2 for 10s; 3 for 5s; 10 for 3s; 25 for 5s |
| Placed | 1 HP/s for 5s; 2 for 5s; 3 for 2s; 10 for 5s; 25 for 5s; 50 for 30s |

Pyromaniac requires **Pyromancer** and **40 tokens**. It has **150 HP** and permanent **50% damage reduction**. Its dual revolvers fire two 100-damage rounds at once, using two of ten rounds. Its upgraded flamethrower reaches 500 world units and never needs ammo or reloads. Holding fire ramps through 5, 10, 15, 45 and 70 damage, advancing every **2.5 seconds**. The first three stages fire every 0.25s, the 45-damage stage every 0.15s, and the final 70-damage stage every 0.1s. Releasing fire resets the ramp. After continuous exposure ends, the residual burn deals 10% of the direct damage taken per second for 40% of the exposure time.

Press the gear binding (F or G by default) as Pyromaniac to spend **50 additional tokens** and replace the dual revolvers with one Firegun. It fires eight fireballs per second with unlimited ammo and no reload. A shared **50-point fire bar** starts full, spending one point per second of flamethrower use and seven points per Firegun shot. Each fireball's impact damage is `(remaining fire bar / 2 / 50) * 1800`, calculated before spending that shot's fire: the first shot from a full bar deals 900 damage, then 774, 648, and so on. The final shot can use the remaining amount below seven points. At zero the Firegun pauses; the flamethrower continues normally. The bar refills to 50 after 60 seconds from the first use, even while weapons are stowed. Each Firegun hit still adds three seconds to a 6-HP-per-second burn; duration stacks, damage rate does not. Snowbombs and snowball sentry hits extinguish burns. Tanks remain immune to residual burns; Humvees can burn.

| Class | Equipment |
| --- | --- |
| Engineer | Sentry Wrench, Basic Pistol, and Engineer's Hammer in slots 1–3. Hold fire with the wrench for 10 seconds to construct an ordinary 50-HP sentry. The hammer deals 30 melee damage and repairs a friendly sentry at 12 HP/second. The previous slot-3 item moves to slot 6; slots 4–5 stay in place. |
| Rocketeer | RPG + Basic Pistol. One rocket, then a 3-second reload, with unlimited reserve ammo. Click to fire immediately in the aimed direction. Rockets cross the island and explode on contact in a radius 10% smaller than a grenade: 10–200 player damage, 10–500 Humvee damage, or 10–1000 tank damage. Direct hits deal the maximum; blast damage falls with distance. |
| Shield Operator | Slot 1 combines a forward-facing riot shield with a Basic Pistol: 10 rounds, 8 damage, normal reload, shield stays raised while shooting. Slot 2 is a red explosive shield, with no pistol. It also blocks frontal grenades, both grenade launchers, and flashbangs. Both class shields retain the normal shield movement penalty. |

The pistol's riot shield is inactive during reload. The class shields do not stop fire, snowbombs, gravity bombs, smoke, poison, lightning, meteors, commander airstrikes, tank weapons, or vehicle ramming. Hits from behind bypass the shields. Selecting an item or an empty slot puts the class shield away. Every class can select empty item slots and remain empty-handed.

Aim the Engineer's hammer at a friendly sentry and hold fire to repair it. At full health, continued hammer work upgrades Sentry I to II, then II to III: each costs 8 tokens and takes 8 seconds. Sentry III offers all six Sentry IV weapons: bullets, grenades, rockets, snowballs, fireballs, and cannons. The upgrade costs 30 tokens and takes 30 seconds. Releasing fire, changing equipment, boarding, leaving reach, or damage to the sentry interrupts construction; tokens are spent only on completion. The wrench cannot build through cover or on occupied ground.

| Sentry IV weapon | HP | Attack |
| --- | --- | --- |
| Bullets | 250 | 50 damage, 25% faster firing than Sentry III |
| Grenades | 310 | 8/second, normal 100-damage grenade blast; arcs over cover and bursts on contact or landing |
| Rockets | 150 | 15/second, unlimited travel across the island; 0–25 player blast damage, 10–80 Humvee damage, or 10–100 tank damage bypassing tank resistance, in half a grenade's blast radius |
| Snowballs | 100 | 50/second, 10 damage; each hit slows movement 5% for 3 seconds; 20 active stacks freeze for 5 seconds |
| Fireballs | 300 | 50/second, 20 damage plus a refreshed 3-second burn ticking 1 damage every 0.1 seconds |
| Cannons | 760 | Once every 5 seconds, bullet-speed projectile; 500 damage through shields, 510 to vehicles; destroys the first rock hit and stops. Double-size sentry visuals and a rock-sized cannonball. |

Tanks take 75% less damage from regular bullets, turrets and sentries, except rocket sentries and the cannon's explicit 510 damage. Rocket sentries bypass this resistance and deal their full 10–100 tank damage. Rocketeer's RPG is an anti-tank explosive and deals its full 10–1000 base tank damage. Snowballs deal 75% less damage to tanks and 50% less to Humvees. Each vehicle snow hit slows fire/reload clocks by 5%, up to 50%, with independently expiring 3-second stacks. Tanks cannot burn; Humvees can. Sentry IV variants are upgrade-only and do not change crate drops.

Four additional level-three branches are visible but **not playable yet**: Sniper III from Sniper II, President from Commander, Tank Commander from Armor Crewmember, and Juggernaut II from Juggernaut.

## Private party practice

Create a Duos, Trios or Squads party, invite a friend, and have the leader choose **Practice with party**. This starts immediately with only the party's current members. Multiplayer practice requires an internet connection; **Practice offline (solo)** remains available separately.

Esc opens the same practice tools: tokens, keys, damage, class reset, armor, item picker, station teleport and passive unlimited-health targets. Each player's equipment changes are authoritative and affect only that player. The leader controls the shared storm and **Fight each other** switch. Practice starts with the storm disabled and party members on one team; enabling fights lets them attack each other. Eliminated players return after two seconds with their class, purchased Firegun and carried equipment. Normal match queues never accept practice commands or targets.

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

Engineer uses `3` for its hammer and `6` for the item previously in slot 3. Empty item slots can also be selected.

## How the online play works

The main-menu **Locker** saves your look in this browser: twenty preset colours, an HSV colour wheel,
brightness and RGB/hex input, plus six optional faces. Items remain locked. Equip nine of thirteen fixed
emotes, then press **B** in a match and choose **Q W E R T Y U I O** (slots 1-9), or click a slot.
The compact 3×3 picker sits on the right without pausing movement, sprinting, aiming or firing. Movement
keys remain held when selecting an emote; other selection shortcuts are consumed so Q/E/R cannot also
drop an item, interact or reload. B or Esc closes the panel.
Other players see your chosen colour, face and a three-second emote bubble. Emotes have a 1.5-second cooldown
and use a fixed server-validated list; there is no text chat. Rejoining restores appearances and active bubbles.

- One WebSocket to the **hub** for the menu (accounts, friends, parties, queue). When a match forms, the hub hands
  every player a one-time ticket; the client opens a second WebSocket to that **match**.
- The match simulates at 20 Hz, accepts inputs (move, aim angle, buttons; bots produce theirs in-process), and sends each player compact snapshots
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
| `server/core/bots/` | the bots: `index.mjs` (director: shared navigation, pacing, world events), `bot.mjs` (senses, decisions, steering, aim), `bot-combat.mjs`, `bot-loot.mjs`, `bot-items.mjs`, `nav.mjs` (grid + A*), `sense.mjs` (what a screen shows), `profile.mjs` (skill, personality, names) |
| `server/cf/worker.mjs` | Cloudflare Worker + Durable Objects (`wrangler.toml`, `.assetsignore`) |
| `server/node/index.mjs` | Node adapter (`ws.mjs` zero-dependency WebSocket server, JSON file store) |
| `tests/`, `tools/` | Node smoke suites, headless-Chrome QA scripts |
