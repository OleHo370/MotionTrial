// Canvas-only presentation of the same projected area used for practice.
// In particular, do not add curve interpolation here: it could show a shortcut
// or overshoot that the learner cannot actually complete in the matcher.
const finitePoint = point => !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
const unit = value => Math.max(0, Math.min(1, value));

function pixelPoints(route, width, height) {
  if (!Array.isArray(route.points) || route.points.length < 2 || !route.points.every(finitePoint)) return [];
  const points = route.points.map(point => ({x: point.x * width, y: point.y * height, phase: point.phase}));
  const validPhases = points.every((point, index) => Number.isFinite(point.phase)
    && point.phase >= 0 && point.phase <= 1 && (!index || point.phase >= points[index - 1].phase));
  if (!validPhases) {
    let length = 0;
    for (let index = 0; index < points.length; index++) {
      if (index) length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
      points[index].phase = length;
    }
    for (const point of points) point.phase = length ? point.phase / length : 0;
  }
  return points;
}

function strokePolyline(ctx, points, color, lineWidth, alpha) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  ctx.stroke();
}

function completedPoints(points, progress) {
  if (progress <= points[0].phase) return [];
  const completed = [points[0]];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1], current = points[index];
    if (current.phase <= progress) {
      completed.push(current);
      continue;
    }
    const span = current.phase - previous.phase;
    if (span > 0) {
      const fraction = unit((progress - previous.phase) / span);
      completed.push({x: previous.x + (current.x - previous.x) * fraction,
        y: previous.y + (current.y - previous.y) * fraction});
    }
    break;
  }
  return completed;
}

function drawChevrons(ctx, points, halfWidth, progress) {
  const spacing = Math.max(42, halfWidth * 3.5), size = Math.max(3, Math.min(7, halfWidth * .32));
  let travelled = 0, next = spacing * .6;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.25, halfWidth * .075);
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
    if (!distance) continue;
    while (next < travelled + distance) {
      const fraction = (next - travelled) / distance;
      const x = a.x + dx * fraction, y = a.y + dy * fraction;
      const ux = dx / distance, uy = dy / distance;
      const phase = a.phase + (b.phase - a.phase) * fraction;
      ctx.globalAlpha = phase <= progress ? .72 : .43;
      ctx.beginPath();
      ctx.moveTo(x - ux * size - uy * size * .65, y - uy * size + ux * size * .65);
      ctx.lineTo(x + ux * size * .45, y + uy * size * .45);
      ctx.lineTo(x - ux * size + uy * size * .65, y - uy * size - ux * size * .65);
      ctx.stroke();
      next += spacing;
    }
    travelled += distance;
  }
}

function drawNextChevron(ctx, points, nextPoint, halfWidth, pulse) {
  let nearestDistance = Infinity, ux = 0, uy = -1;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) continue;
    const fraction = unit(((nextPoint.x - a.x) * dx + (nextPoint.y - a.y) * dy) / lengthSquared);
    const distance = (nextPoint.x - a.x - dx * fraction) ** 2 + (nextPoint.y - a.y - dy * fraction) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      const length = Math.sqrt(lengthSquared);
      ux = dx / length;
      uy = dy / length;
    }
  }
  const size = Math.max(5, Math.min(12, halfWidth * .62));
  // The route cue is directional and stays fixed at the next measured section.
  // Only actual camera landmarks use circular dots; pulse changes opacity only.
  ctx.beginPath();
  ctx.moveTo(nextPoint.x - ux * size - uy * size * .7, nextPoint.y - uy * size + ux * size * .7);
  ctx.lineTo(nextPoint.x + ux * size * .6, nextPoint.y + uy * size * .6);
  ctx.lineTo(nextPoint.x - ux * size + uy * size * .7, nextPoint.y - uy * size - ux * size * .7);
  ctx.strokeStyle = '#07151d';
  ctx.lineWidth = 5;
  ctx.globalAlpha = .9;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = .7 + pulse * .3;
  ctx.stroke();
}

/**
 * Draw projected, already-smoothed routes in the unmirrored camera canvas.
 * CSS mirrors the video and this canvas together. `progress` and each vertex's
 * `phase` show spatial progress only; they are not required checkpoints.
 */
export function drawPracticeTubes(ctx, routes, frame, width, height, {nowMs = 0,guideline=false} = {}) {
  if (!ctx || !Array.isArray(routes) || !Number.isFinite(frame?.scale) || frame.scale <= 0
      || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  for (const route of routes) {
    if (!route?.available || route.stationary || !Number.isFinite(route.halfWidth) || route.halfWidth <= 0) continue;
    const points = pixelPoints(route, width, height);
    if (points.length < 2) continue;
    const halfWidth = route.halfWidth * frame.scale * height;
    const progress = route.complete ? 1 : unit(Number.isFinite(route.progress) ? route.progress : 0);
    const color = typeof route.color === 'string' ? route.color : '#ffffff';
    if(guideline){
      // A soft direction cue, not a live boundary or a sequence to collect.
      strokePolyline(ctx,points,color,halfWidth*3,.10);
      strokePolyline(ctx,points,color,Math.max(3,halfWidth*.22),.72);
      drawChevrons(ctx,points,halfWidth,0);
      continue;
    }
    // The colored corridor uses the assessed half-width. A thin outer keyline
    // keeps it visible over both bright clothing and a dark camera background.
    strokePolyline(ctx, points, '#07151d', halfWidth * 2 + 3, .72);
    strokePolyline(ctx, points, color, halfWidth * 2, .30);
    strokePolyline(ctx, points, color, Math.max(1, halfWidth * .12), .60);
    const completed = route.complete ? points : completedPoints(points, progress);
    strokePolyline(ctx, completed, color, halfWidth * 2, .54);
    strokePolyline(ctx, completed, '#ffffff', Math.max(1.5, halfWidth * .13), .80);
    drawChevrons(ctx, points, halfWidth, progress);
    if (!route.complete && finitePoint(route.nextPoint)) {
      const pulse = .5 + .5 * Math.sin((Number.isFinite(nowMs) ? nowMs : 0) / 210);
      drawNextChevron(ctx, points, {x: route.nextPoint.x * width, y: route.nextPoint.y * height}, halfWidth, pulse);
    }
  }
  ctx.restore();
}
