// Draw the circuit once; HUD updates only blit the cached track and paint the marker.
export function createMinimap(canvas, points) {
  const context = canvas.getContext("2d");
  const track = document.createElement("canvas");
  track.width = canvas.width;
  track.height = canvas.height;
  const background = track.getContext("2d");
  const xs = points.map((p) => p.x),
    zs = points.map((p) => p.z);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minZ = Math.min(...zs),
    maxZ = Math.max(...zs);
  const scale = Math.min(
    (canvas.width - 32) / Math.max(1, maxX - minX),
    (canvas.height - 32) / Math.max(1, maxZ - minZ),
  );
  const x = (value) => canvas.width / 2 + (value - (minX + maxX) / 2) * scale;
  const z = (value) => canvas.height / 2 + (value - (minZ + maxZ) / 2) * scale;
  background.beginPath();
  points.forEach((point, index) =>
    index
      ? background.lineTo(x(point.x), z(point.z))
      : background.moveTo(x(point.x), z(point.z)),
  );
  background.closePath();
  for (const [color, width] of [
    ["#091119bb", 12],
    ["#758b8477", 5],
    ["#c5e3a055", 1],
  ]) {
    background.strokeStyle = color;
    background.lineWidth = width;
    background.stroke();
  }
  background.fillStyle = "#f0f7e0";
  background.fillRect(x(points[0].x) - 3, z(points[0].z) - 3, 6, 6);
  return function draw(car) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(track, 0, 0);
    context.save();
    context.translate(x(car.x), z(car.z));
    context.rotate(-car.yaw);
    context.beginPath();
    context.moveTo(0, 7);
    context.lineTo(-4, -4);
    context.lineTo(4, -4);
    context.closePath();
    context.fillStyle = "#b8ed50";
    context.shadowColor = "#b8ed50";
    context.shadowBlur = 10;
    context.fill();
    context.restore();
  };
}
