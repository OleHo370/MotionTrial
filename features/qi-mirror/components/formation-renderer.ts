/** Original decorative eight-gate formation. No sensor, movement or score data. */
export type FormationPlayback = { phase: number; visible: boolean; paused: boolean; reduced: boolean };
type Point = [number, number];
const TAU = Math.PI * 2;
const GOLD = [221, 204, 158], JADE = [151, 210, 185], IVORY = [244, 235, 205];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const t = clamp(n); return 1 - (1 - t) ** 3; };
const polar = (r: number, a: number): Point => [280 + Math.cos(a) * r, 280 + Math.sin(a) * r];
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const color = (rgb: number[], alpha: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(alpha)})`;

export function createFormationRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Decorative canvas unavailable');
  const ctx = context;
  let state: FormationPlayback = { phase: 0, visible: false, paused: false, reduced: false };
  let elapsed = 0, entrance = 0, last = 0, request = 0, frames = 0, disposed = false, size = 0;

  function line(points: Point[], rgb: number[], alpha: number, width = .8, closed = false) {
    if (points.length < 2 || alpha < .005) return;
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    if (closed) ctx.closePath();
    ctx.strokeStyle = color(rgb, alpha); ctx.lineWidth = width; ctx.stroke();
  }
  function arc(radius: number, start: number, length: number, rgb: number[], alpha: number, width = .8) {
    ctx.beginPath(); ctx.arc(280, 280, radius, start, start + length);
    ctx.strokeStyle = color(rgb, alpha); ctx.lineWidth = width; ctx.stroke();
  }
  function dot(point: Point, radius: number, rgb: number[], alpha: number, glow = 0) {
    if (glow > 0) {
      const halo = ctx.createRadialGradient(...point, 0, ...point, glow);
      halo.addColorStop(0, color(rgb, alpha * .26)); halo.addColorStop(1, color(rgb, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(...point, glow, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = color(rgb, alpha); ctx.beginPath(); ctx.arc(...point, radius, 0, TAU); ctx.fill();
  }
  function octagon(radius: number, rotation: number) {
    return Array.from({ length: 8 }, (_, i) => polar(radius, rotation + i * TAU / 8));
  }
  function gate(radius: number, angle: number, energy: number, opening: number, rgb: number[]) {
    ctx.save(); ctx.translate(...polar(radius, angle)); ctx.rotate(angle + Math.PI / 2);
    const span = 9 + opening * 5;
    ctx.strokeStyle = color(rgb, .2 + energy * .64); ctx.lineWidth = .9;
    for (const sign of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(sign * 4, -6); ctx.lineTo(sign * span, -6);
      ctx.lineTo(sign * (span + 5), 0); ctx.lineTo(sign * span, 6); ctx.lineTo(sign * 4, 6); ctx.stroke();
    }
    ctx.fillStyle = color(IVORY, .16 + energy * .75);
    ctx.fillRect(-1.3, -1.3, 2.6, 2.6); ctx.restore();
  }

  function drawWatch(t: number, reveal: number) {
    const breathe = Math.sin(t * .9) * .5 + .5;
    const open = clamp((reveal - .18) / .82);
    const turn = Math.sin(t * .24) * .12 + (1 - open) * .32;
    const outerRadius = 151 + 58 * open;
    const outer = octagon(outerRadius, -Math.PI / 2 + turn);
    const inner = octagon(134 + 11 * open + breathe * 3, -Math.PI / 2 + Math.PI / 8 - turn);
    const middle = octagon(146 + 34 * open, -Math.PI / 2 - turn * .7);

    // Two articulated planes form an actual network, rather than a radar fill.
    line(outer, GOLD, .46 * reveal, 1, true);
    line(inner, JADE, .22 * reveal, .8, true);
    line(middle, GOLD, .12 * reveal, .65, true);
    for (let i = 0; i < 8; i++) {
      const phase = ((t * .25 - i / 8) % 1 + 1) % 1;
      const energy = .12 + Math.exp(-(((phase - .16) / .18) ** 2)) * .88;
      const appeared = ease(reveal * 1.65 - i * .075);
      const a = outer[i], b = inner[i], c = inner[(i + 7) % 8];
      line([b, a, c], GOLD, (.16 + energy * .43) * appeared, .9);
      line([outer[i], outer[(i + 2) % 8]], JADE, .085 * appeared, .65);
      const ray = mix(b, a, ease(phase));
      line([b, mix(b, a, clamp(phase + .1))], GOLD, energy * .46 * appeared, 1.3);
      dot(ray, 1.3, IVORY, energy * appeared, 7);
      dot(b, 2.15, JADE, (.28 + energy * .55) * appeared, 7);
      dot(a, 2.9, GOLD, (.35 + energy * .65) * appeared, 17);
      gate(outerRadius, -Math.PI / 2 + i * TAU / 8 + turn, energy * appeared, breathe * open, GOLD);
      arc(228, -Math.PI / 2 + i * TAU / 8 - .16, .32 * appeared, GOLD, .16 + energy * .42, 1.05);
      // Small orbiting fragments imply depth without adding another complete ring.
      const angle = -Math.PI / 2 + i * TAU / 8 + t * .075;
      arc(159 + (i % 2) * 7, angle, .09 + energy * .12, JADE, .3 * appeared, 1.1);
    }
    for (let i = 0; i < 48; i++) {
      const a = i * TAU / 48 - t * .025;
      const r = 220 + 3 * Math.sin(i * 2.7 + t * .8);
      dot(polar(r, a), i % 6 === 0 ? 1.3 : .65, GOLD, (.13 + .17 * Math.sin(t + i) ** 2) * reveal);
    }
    // A broad, faint travelling halo gives the geometry a sense of unfolding.
    const cycle = (t * .23) % 1;
    arc(128 + cycle * 93, 0, TAU, JADE, Math.sin(cycle * Math.PI) * .12 * reveal, .7);
  }

  function flowPoint(a: number, lane: number, t: number): Point {
    const radius = 179 + lane * 3.5 + 29 * Math.sin(a * 2 + t * .17 + lane * .12) + 13 * Math.sin(a * 3 - t * .07 + lane * .19);
    return polar(radius, a + .055 * Math.sin(a * 3 + t * .12 + lane * .4) + lane * .025 * Math.sin(a));
  }
  function drawFollow(t: number, reveal: number) {
    const points = size < 280 ? 112 : 168;
    // Fine intersecting trajectories share one field; each current has a leader and a delayed response.
    for (let lane = -3; lane <= 3; lane++) {
      const rgb = lane < 0 ? JADE : GOLD;
      const guide: Point[] = [];
      for (let j = 0; j <= points; j++) guide.push(flowPoint(j / points * TAU, lane, t));
      line(guide, rgb, (lane === 0 ? .16 : .055) * reveal, lane === 0 ? .8 : .6);
      for (let group = 0; group < 2; group++) {
        const head = t * 1.02 + group * Math.PI + lane * .018;
        const delay = lane < 0 ? .44 : 0;
        const length = 1.36 + (3 - Math.abs(lane)) * .14;
        for (let segment = 0; segment < 13; segment++) {
          const tail = (segment / 13 - 1) * length;
          const part: Point[] = [];
          for (let j = 0; j <= 4; j++) part.push(flowPoint(head - delay + tail + j / 4 * length / 13, lane, t));
          const alpha = (.08 + (segment / 12) ** 2 * .78) * (1 - Math.abs(lane) * .12) * reveal;
          line(part, rgb, alpha, lane === 0 ? 1.8 : 1.05);
        }
        const headPoint = flowPoint(head - delay, lane, t);
        dot(headPoint, lane === 0 ? 3 : 1.3, lane === 0 ? IVORY : rgb, (.55 + (lane === 0 ? .45 : 0)) * reveal, lane === 0 ? 19 : 0);
        for (let bead = 1; bead < 4; bead++) dot(flowPoint(head - delay - bead * .23, lane, t), .85, rgb, (.52 - bead * .09) * reveal);
      }
    }
    // Fixed gates respond as the current passes, making the following relationship visible.
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8 - Math.PI / 2;
      const energy = (.5 + .5 * Math.cos(a - t * 1.02)) ** 8;
      gate(221, a, energy * reveal, .55, JADE);
      const inner = flowPoint(a, 0, t), end = polar(213, a);
      line([inner, mix(inner, end, .7)], JADE, (.06 + energy * .17) * reveal, .65);
      dot(inner, 1.4 + energy, JADE, (.15 + energy * .65) * reveal, energy * 9);
    }
    for (let i = 0; i < 68; i++) {
      const a = i * 2.39996 + t * (.10 + (i % 3) * .012);
      const r = 135 + ((i * 37) % 91);
      const brightness = .08 + .22 * (.5 + .5 * Math.sin(t * 1.2 - i)) ** 3;
      dot(polar(r, a), i % 9 === 0 ? 1.25 : .6, i % 2 ? GOLD : JADE, brightness * reveal);
    }
  }

  function render() {
    if (disposed || !size) return;
    const scale = canvas.width / 560;
    ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, 560, 560);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const staticFrame = state.reduced || (state.paused && entrance === 0);
    const reveal = staticFrame ? 1 : .18 + ease(entrance / 900) * .82;
    const t = staticFrame ? 2.2 : elapsed / 1000;
    if (state.phase === 1) drawWatch(t, reveal);
    if (state.phase === 2) drawFollow(t, reveal);
    canvas.dataset.frames = String(++frames);
    canvas.dataset.elapsed = elapsed.toFixed(0);
    canvas.dataset.formationMode = String(state.phase);
  }
  function stop() { cancelAnimationFrame(request); request = 0; last = 0; }
  function tick(now: number) {
    request = 0; if (disposed) return;
    const dt = last ? Math.min(now - last, 42) : 0; last = now;
    elapsed += dt; entrance += dt; render(); request = requestAnimationFrame(tick);
  }
  function synchronize() {
    stop();
    if (disposed) return;
    if (!state.visible || (state.phase !== 1 && state.phase !== 2)) { canvas.dataset.state = 'suspended'; return; }
    render();
    if (state.reduced || state.paused) { canvas.dataset.state = state.reduced ? 'reduced' : 'paused'; return; }
    canvas.dataset.state = 'running'; request = requestAnimationFrame(tick);
  }
  return {
    update(next: FormationPlayback) {
      if (next.phase !== state.phase) {
        elapsed = next.paused || next.reduced ? 2200 : 0;
        entrance = next.paused || next.reduced ? 900 : 0;
      }
      state = next; synchronize();
    },
    resize(width: number, height: number) {
      size = Math.min(width, height); const pixels = Math.ceil(size * Math.min(devicePixelRatio || 1, 2));
      if (canvas.width !== pixels || canvas.height !== pixels) { canvas.width = pixels; canvas.height = pixels; render(); }
    },
    dispose() { disposed = true; stop(); canvas.width = 0; canvas.height = 0; },
  };
}
