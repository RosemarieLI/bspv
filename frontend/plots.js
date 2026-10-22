export function drawPlot(canvas, points, time, { segments, bounds } = {}) {
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  const isFacet = segments !== undefined;
  if (isFacet ? !segments.length : !points.length) return null;

  const extent = (values) => {
    let min = Infinity,
      max = -Infinity;
    for (const value of values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    if (min === max) {
      min -= 0.5;
      max += 0.5;
    }
    return [min, max];
  };
  let [xmin, xmax] = extent(
    isFacet ? segments.flatMap((s) => [s[0], s[2]]) : points.map((p) => p[0]),
  );
  let [ymin, ymax] = extent(
    isFacet ? segments.flatMap((s) => [s[1], s[3]]) : points.map((p) => p[1]),
  );
  if (isFacet && bounds) [xmin, xmax, ymin, ymax] = bounds;
  const ypad = (ymax - ymin || 1) * 0.08;
  ymin -= ypad;
  ymax += ypad;
  if (isFacet) {
    const pad = (xmax - xmin || 1) * 0.08;
    xmin -= pad;
    xmax += pad;
  }
  const left = 58,
    right = 24,
    top = 24,
    bottom = 42;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  let scaleX = plotWidth / (xmax - xmin),
    scaleY = plotHeight / (ymax - ymin);
  if (isFacet) scaleX = scaleY = Math.min(scaleX, scaleY);
  const offsetX = left + (plotWidth - (xmax - xmin) * scaleX) / 2;
  const offsetY = top + (plotHeight - (ymax - ymin) * scaleY) / 2;
  const X = (value) => offsetX + (value - xmin) * scaleX;
  const Y = (value) =>
    height - bottom - offsetY + top - (value - ymin) * scaleY;
  ctx.font = "12px Segoe UI, Microsoft YaHei, sans-serif";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = xmin + ((xmax - xmin) * i) / 5;
    const y = ymin + ((ymax - ymin) * i) / 5;
    ctx.strokeStyle = "#edf3f0";
    ctx.beginPath();
    ctx.moveTo(X(x), Y(ymin));
    ctx.lineTo(X(x), Y(ymax));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(xmin), Y(y));
    ctx.lineTo(X(xmax), Y(y));
    ctx.stroke();
    ctx.fillStyle = "#666";
    ctx.textAlign = "center";
    ctx.fillText(Number(x.toPrecision(3)).toString(), X(x), Y(ymin) + 22);
    ctx.textAlign = "right";
    ctx.fillText(Number(y.toPrecision(3)).toString(), X(xmin) - 8, Y(y) + 4);
  }
  ctx.strokeStyle = isFacet ? "#e18a45" : "#168f9c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (isFacet) {
    for (const [x1, y1, x2, y2] of segments) {
      ctx.moveTo(X(x1), Y(y1));
      ctx.lineTo(X(x2), Y(y2));
    }
  } else {
    points.forEach(([x, y], i) =>
      i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)),
    );
  }
  ctx.stroke();
  if (!isFacet) {
    const point = points.reduce((a, b) =>
      Math.abs(a[0] - time) <= Math.abs(b[0] - time) ? a : b,
    );
    ctx.strokeStyle = "#888";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(point[0]), Y(ymin));
    ctx.lineTo(X(point[0]), Y(ymax));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  return { xmin, xmax, left: offsetX, width: (xmax - xmin) * scaleX };
}
