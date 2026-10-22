const clamp01 = (value) => Math.max(0, Math.min(1, value));
function build(segments) {
  const node = {
    minX: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxZ: -Infinity,
  };
  for (const segment of segments) {
    node.minX = Math.min(node.minX, segment.minX);
    node.minZ = Math.min(node.minZ, segment.minZ);
    node.maxX = Math.max(node.maxX, segment.maxX);
    node.maxZ = Math.max(node.maxZ, segment.maxZ);
  }
  if (segments.length <= 8) node.segments = segments;
  else {
    const axis =
      node.maxX - node.minX > node.maxZ - node.minZ ? "centerX" : "centerZ";
    segments.sort((a, b) => a[axis] - b[axis] || a.index - b.index);
    const middle = segments.length >> 1;
    node.left = build(segments.slice(0, middle));
    node.right = build(segments.slice(middle));
  }
  return node;
}
function bound(node, x, z) {
  const dx = Math.max(node.minX - x, 0, x - node.maxX),
    dz = Math.max(node.minZ - z, 0, z - node.maxZ);
  return dx * dx + dz * dz;
}
function search(node, distance, x, z, best, diagnostics) {
  // Equal bounds remain eligible so shared endpoints choose the lowest segment ID.
  if (distance > best.squared) return;
  if (diagnostics) diagnostics.visitedNodes++;
  if (node.segments) {
    for (const segment of node.segments) {
      if (diagnostics) diagnostics.testedSegments++;
      const t =
        segment.lengthSquared === 0
          ? 0
          : clamp01(
              ((x - segment.x) * segment.dx + (z - segment.z) * segment.dz) /
                segment.lengthSquared,
            );
      const px = segment.x + segment.dx * t,
        pz = segment.z + segment.dz * t,
        squared = (x - px) ** 2 + (z - pz) ** 2;
      if (
        squared < best.squared ||
        (squared === best.squared && segment.index < best.index)
      ) {
        best.squared = squared;
        best.x = px;
        best.z = pz;
        best.index = segment.index;
        best.t = t;
      }
    }
    return;
  }
  const left = bound(node.left, x, z),
    right = bound(node.right, x, z);
  if (left <= right) {
    search(node.left, left, x, z, best, diagnostics);
    search(node.right, right, x, z, best, diagnostics);
  } else {
    search(node.right, right, x, z, best, diagnostics);
    search(node.left, left, x, z, best, diagnostics);
  }
}
// Index the closed polyline once. Each query still projects onto exact segments,
// including after teleports, at crossings, and far outside the track bounds.
export function createRoadQuery(points, halfWidth) {
  if (
    points.length < 2 ||
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.z),
    )
  )
    throw new TypeError("A road needs at least two finite points");
  const segments = points.map((a, index) => {
    const b = points[(index + 1) % points.length],
      dx = b.x - a.x,
      dz = b.z - a.z;
    return {
      x: a.x,
      z: a.z,
      dx,
      dz,
      index,
      lengthSquared: dx * dx + dz * dz,
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minZ: Math.min(a.z, b.z),
      maxZ: Math.max(a.z, b.z),
      centerX: (a.x + b.x) / 2,
      centerZ: (a.z + b.z) / 2,
    };
  });
  const root = build(segments);
  return function nearestRoad(x, z, diagnostics = null) {
    const best = { squared: Infinity, index: Infinity, x: 0, z: 0, t: 0 };
    if (diagnostics) {
      diagnostics.visitedNodes = 0;
      diagnostics.testedSegments = 0;
    }
    search(root, 0, x, z, best, diagnostics);
    return {
      x: best.x,
      z: best.z,
      index: best.index,
      progress: (best.index + best.t) / points.length,
      distance: Math.sqrt(best.squared),
      halfWidth,
    };
  };
}
