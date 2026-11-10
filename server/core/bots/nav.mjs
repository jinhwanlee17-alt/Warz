// Bot navigation: a lazily evaluated walkability grid over the match's collision world plus A*.
// Cells are classified on first use straight from `world.solids`, so the grid always agrees with what the
// simulation will let a player walk through; crates breaking and rocks being placed just invalidate a few cells.
const CELL = 32;          // door gaps are 86 wide: with CLEAR = 25 every doorway keeps at least one free column
const CLEAR = 25;         // a path's centre line stays this far from solids (players are 24 wide)
const WALK = 21;          // swept-circle radius for "can I walk straight there" (smaller than a player, so touching a wall is fine)
const UNKNOWN = 0, FREE = 1, BLOCKED = 2, POND = 3;
const POND_COST = 1.7;    // ponds slow you to 62%
const WEIGHT = 1.25;      // weighted A*: slightly greedy, far fewer expansions on an open island
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export class Nav {
  constructor(W, world) {
    this.W = W;
    this.U = W.U;
    this.world = world;
    this.size = W.CONFIG.worldSize;
    this.corner = W.CONFIG.cornerRadius;
    this.n = Math.ceil(this.size / CELL);
    const total = this.n * this.n;
    this.cells = new Uint8Array(total);
    this.g = new Float32Array(total);
    this.from = new Int32Array(total);
    this.seen = new Uint32Array(total);
    this.done = new Uint32Array(total);
    this.heap = new Int32Array(2048);
    this.heapF = new Float32Array(2048);
    this.heapN = 0;
    this.search = 0;
    this.budget = 4;        // path searches left this tick (the director refills it)
    this.stats = { searches: 0, nodes: 0, deferred: 0, partial: 0 };
  }

  // ---------------------------------------------------------------- cells
  solidAt(x, y, r) {
    if (!this.U.insideIsland(x, y, r + 4, this.size, this.corner)) return true;
    const U = this.U;
    let hit = false;
    this.world.solids.query(x - r, y - r, x + r, y + r, (s) => {
      if (hit || (s.crate && !s.crate.alive) || (s.rock && !s.rock.alive) || (s.struct && !s.struct.alive)) return;
      if (s.shape === 'circle') { if (Math.hypot(s.x - x, s.y - y) < s.r + r) hit = true; }
      else if (U.circleRectPush(x, y, r, s.x, s.y, s.w, s.h)) hit = true;
    });
    return hit;
  }

  state(ix, iy) {
    const n = this.n;
    if (ix < 0 || iy < 0 || ix >= n || iy >= n) return BLOCKED;
    const i = iy * n + ix;
    let s = this.cells[i];
    if (s) return s;
    const x = (ix + 0.5) * CELL, y = (iy + 0.5) * CELL;
    s = this.solidAt(x, y, CLEAR) ? BLOCKED : this.world.inPond(x, y) ? POND : FREE;
    this.cells[i] = s;
    return s;
  }
  stateAt(x, y) { return this.state(Math.floor(x / CELL), Math.floor(y / CELL)); }
  freeAt(x, y) { return this.stateAt(x, y) !== BLOCKED; }
  pondAt(x, y) { return this.stateAt(x, y) === POND; }

  // Something solid appeared or disappeared around (x, y): forget those cells.
  invalidate(x, y, r) {
    const n = this.n, pad = r + CLEAR + CELL;
    const x0 = Math.max(0, Math.floor((x - pad) / CELL)), x1 = Math.min(n - 1, Math.floor((x + pad) / CELL));
    const y0 = Math.max(0, Math.floor((y - pad) / CELL)), y1 = Math.min(n - 1, Math.floor((y + pad) / CELL));
    for (let iy = y0; iy <= y1; iy++) this.cells.fill(UNKNOWN, iy * n + x0, iy * n + x1 + 1);
  }

  // Can a player walk the straight segment? Exact swept test against the live collision world.
  // `avoid` circles ({x, y, r}) and ponds can be treated as walls for path smoothing.
  segmentClear(x1, y1, x2, y2, opts) {
    const U = this.U;
    if (!U.insideIsland(x2, y2, WALK + 4, this.size, this.corner)) return false;
    let clear = true;
    this.world.solids.query(Math.min(x1, x2) - WALK, Math.min(y1, y2) - WALK, Math.max(x1, x2) + WALK, Math.max(y1, y2) + WALK, (s) => {
      if (!clear || (s.crate && !s.crate.alive) || (s.rock && !s.rock.alive) || (s.struct && !s.struct.alive)) return;
      // Starting closer to something than a player normally gets (shoved against a wall by a crowd): then the
      // rule is "no closer than we already are", so walking away from it or along it is still a clear walk.
      let r = WALK;
      if (s.shape === 'circle') {
        const d0 = Math.hypot(s.x - x1, s.y - y1) - s.r;
        if (d0 < r) r = d0 - 0.5;
        if (r <= 0) { if (Math.hypot(s.x - x2, s.y - y2) < Math.hypot(s.x - x1, s.y - y1)) clear = false; return; }
        if (U.segCircle(x1, y1, x2, y2, s.x, s.y, s.r + r) >= 0) clear = false;
        return;
      }
      const ox = x1 < s.x ? s.x - x1 : x1 > s.x + s.w ? x1 - s.x - s.w : 0, oy = y1 < s.y ? s.y - y1 : y1 > s.y + s.h ? y1 - s.y - s.h : 0, d0 = Math.hypot(ox, oy);
      if (d0 < r) r = d0 - 0.5;
      if (r <= 0) return;
      // A circle swept past a rectangle: the rectangle grown sideways, grown up and down, and a disc on each corner.
      // (Growing it as one big box would call a player touching a wall's corner "inside the wall" and strand them.)
      if (U.segRect(x1, y1, x2, y2, s.x - r, s.y, s.w + r * 2, s.h) >= 0 || U.segRect(x1, y1, x2, y2, s.x, s.y - r, s.w, s.h + r * 2) >= 0
        || U.segCircle(x1, y1, x2, y2, s.x, s.y, r) >= 0 || U.segCircle(x1, y1, x2, y2, s.x + s.w, s.y, r) >= 0
        || U.segCircle(x1, y1, x2, y2, s.x, s.y + s.h, r) >= 0 || U.segCircle(x1, y1, x2, y2, s.x + s.w, s.y + s.h, r) >= 0) clear = false;
    });
    if (!clear || !opts) return clear;
    if (opts.avoid) {
      for (const a of opts.avoid) {
        // Leaving a zone you are already in is always allowed; cutting into or through one is not.
        if (Math.hypot(x1 - a.x, y1 - a.y) < a.r) continue;
        if (U.segCircle(x1, y1, x2, y2, a.x, a.y, a.r) >= 0) return false;
      }
    }
    if (opts.dry) {
      const d = Math.hypot(x2 - x1, y2 - y1), steps = Math.ceil(d / CELL);
      if (!this.pondAt(x1, y1)) for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        if (this.pondAt(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k)) return false;
      }
    }
    return true;
  }

  // Index of a free cell at or next to a point, or -1. `from` prefers cells the point can actually walk to.
  freeCellNear(x, y, rings, reach) {
    const n = this.n, cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (this.state(cx, cy) !== BLOCKED) return cy * n + cx;
    let best = -1, bestD = Infinity;
    for (let ring = 1; ring <= rings && best < 0; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const ix = cx + dx, iy = cy + dy;
          if (this.state(ix, iy) === BLOCKED) continue;
          const px = (ix + 0.5) * CELL, py = (iy + 0.5) * CELL, d = Math.hypot(px - x, py - y);
          if (d >= bestD || (reach && !this.segmentClear(x, y, px, py))) continue;
          bestD = d; best = iy * n + ix;
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- heap
  push(node, f) {
    if (this.heapN >= this.heap.length) {
      const h = new Int32Array(this.heap.length * 2), hf = new Float32Array(this.heap.length * 2);
      h.set(this.heap); hf.set(this.heapF);
      this.heap = h; this.heapF = hf;
    }
    const heap = this.heap, hf = this.heapF;
    let i = this.heapN++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (hf[parent] <= f) break;
      heap[i] = heap[parent]; hf[i] = hf[parent];
      i = parent;
    }
    heap[i] = node; hf[i] = f;
  }
  pop() {
    const heap = this.heap, hf = this.heapF, top = heap[0], n = --this.heapN;
    if (n > 0) {
      const node = heap[n], f = hf[n];
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= n) break;
        if (child + 1 < n && hf[child + 1] < hf[child]) child++;
        if (hf[child] >= f) break;
        heap[i] = heap[child]; hf[i] = hf[child];
        i = child;
      }
      heap[i] = node; hf[i] = f;
    }
    return top;
  }

  // ---------------------------------------------------------------- A*
  // Returns { points:[{x,y}], partial } (partial: ran out of budget, the path leads toward the goal),
  // null when there is no way at all, or undefined when this tick's search budget is spent (ask again).
  findPath(sx, sy, gx, gy, opts = {}) {
    if (this.budget <= 0) { this.stats.deferred++; return undefined; }
    this.budget--;
    this.stats.searches++;
    const n = this.n, maxNodes = opts.maxNodes || 2600, avoid = opts.avoid && opts.avoid.length ? opts.avoid : null;
    const start = this.freeCellNear(sx, sy, 2, true), goal = this.freeCellNear(gx, gy, opts.goalRings === undefined ? 4 : opts.goalRings, false);
    if (start < 0 || goal < 0) return null;
    const goalX = goal % n, goalY = (goal - goalX) / n;
    const exact = Math.floor(gx / CELL) === goalX && Math.floor(gy / CELL) === goalY;
    if (start === goal) return { points: [exact ? { x: gx, y: gy } : this.center(goal)], partial: false };
    const id = ++this.search, g = this.g, from = this.from, seen = this.seen, done = this.done;
    const h = (ix, iy) => {
      const dx = Math.abs(ix - goalX), dy = Math.abs(iy - goalY);
      return dx > dy ? dx + dy * 0.41421356 : dy + dx * 0.41421356;
    };
    this.heapN = 0;
    g[start] = 0; from[start] = -1; seen[start] = id;
    let best = start, bestH = h(start % n, (start - (start % n)) / n), expanded = 0, found = false;
    this.push(start, bestH * WEIGHT);
    while (this.heapN > 0) {
      const cur = this.pop();
      if (done[cur] === id) continue;
      done[cur] = id;
      if (cur === goal) { best = cur; found = true; break; }
      if (++expanded > maxNodes) break;
      const cx = cur % n, cy = (cur - cx) / n, base = g[cur];
      for (let k = 0; k < 8; k++) {
        const dx = DIRS[k][0], dy = DIRS[k][1], nx = cx + dx, ny = cy + dy;
        const s = this.state(nx, ny);
        if (s === BLOCKED) continue;
        if (k >= 4 && (this.state(cx + dx, cy) === BLOCKED || this.state(cx, cy + dy) === BLOCKED)) continue; // no corner cutting
        const ni = ny * n + nx;
        if (done[ni] === id) continue;
        let cost = DIRS[k][2] * (s === POND ? POND_COST : 1);
        if (avoid) {
          const px = (nx + 0.5) * CELL, py = (ny + 0.5) * CELL;
          for (let a = 0; a < avoid.length; a++) if (Math.hypot(px - avoid[a].x, py - avoid[a].y) < avoid[a].r) cost += avoid[a].cost || 12;
        }
        const ng = base + cost;
        if (seen[ni] === id && ng >= g[ni] - 1e-4) continue;
        seen[ni] = id; g[ni] = ng; from[ni] = cur;
        const hh = h(nx, ny);
        if (hh < bestH) { bestH = hh; best = ni; }
        this.push(ni, ng + hh * WEIGHT);
      }
    }
    this.stats.nodes += expanded;
    if (!found) {
      if (best === start) return null;
      this.stats.partial++;
    }
    const cells = [];
    for (let c = best; c !== start && c >= 0; c = from[c]) cells.push(c);
    cells.reverse();
    const raw = cells.map((c) => this.center(c));
    if (found && exact) raw[raw.length - 1] = { x: gx, y: gy };
    return { points: this.pull(sx, sy, raw, { avoid, dry: true }), partial: !found };
  }

  // The way out of a danger zone for someone with walls around them: the walk to the nearest free cell (nearest by
  // walking, not as the crow flies) that lies outside every circle in `zones`. Returns the points to walk through,
  // or null when there is no such cell within reach. Runs outside the per-tick search budget: it cannot wait.
  wayOut(sx, sy, zones, maxNodes = 3000) {
    const n = this.n, start = this.freeCellNear(sx, sy, 2, true);
    if (start < 0) return null;
    this.stats.searches++;
    const id = ++this.search, g = this.g, from = this.from, seen = this.seen, done = this.done;
    this.heapN = 0;
    g[start] = 0; from[start] = -1; seen[start] = id;
    this.push(start, 0);
    let expanded = 0, exit = -1;
    while (this.heapN > 0) {
      const cur = this.pop();
      if (done[cur] === id) continue;
      done[cur] = id;
      const cx = cur % n, cy = (cur - cx) / n, base = g[cur];
      if (cur !== start) {
        const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
        let out = true;
        for (let i = 0; i < zones.length; i++) if (Math.hypot(x - zones[i].x, y - zones[i].y) < zones[i].r) { out = false; break; }
        if (out) { exit = cur; break; }
      }
      if (++expanded > maxNodes) break;
      for (let k = 0; k < 8; k++) {
        const dx = DIRS[k][0], dy = DIRS[k][1], nx = cx + dx, ny = cy + dy;
        const s = this.state(nx, ny);
        if (s === BLOCKED) continue;
        if (k >= 4 && (this.state(cx + dx, cy) === BLOCKED || this.state(cx, cy + dy) === BLOCKED)) continue; // no corner cutting
        const ni = ny * n + nx;
        if (done[ni] === id) continue;
        const ng = base + DIRS[k][2] * (s === POND ? POND_COST : 1);
        if (seen[ni] === id && ng >= g[ni] - 1e-4) continue;
        seen[ni] = id; g[ni] = ng; from[ni] = cur;
        this.push(ni, ng);
      }
    }
    this.stats.nodes += expanded;
    if (exit < 0) return null;
    const cells = [];
    for (let c = exit; c !== start && c >= 0; c = from[c]) cells.push(c);
    cells.reverse();
    return this.pull(sx, sy, cells.map((c) => this.center(c)), null);
  }

  center(cell) { const ix = cell % this.n; return { x: (ix + 0.5) * CELL, y: ((cell - ix) / this.n + 0.5) * CELL }; }

  // String pulling: drop every waypoint a straight walk can skip.
  pull(sx, sy, pts, opts) {
    const out = [];
    let ax = sx, ay = sy, i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 14);
      while (j > i && !this.segmentClear(ax, ay, pts[j].x, pts[j].y, opts)) j--;
      out.push(pts[j]);
      ax = pts[j].x; ay = pts[j].y;
      i = j + 1;
    }
    return out;
  }
}

export const NAV = { CELL, CLEAR, WALK, FREE, BLOCKED, POND };
