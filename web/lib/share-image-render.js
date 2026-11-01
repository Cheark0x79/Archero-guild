import { createElement as h } from "react";
import { adaptiveChartDomain } from "./chart-points.js";

const compact = (value) => Number.isFinite(value)
  ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value) : "—";
const text = (value, style = {}) => h("div", { style: { display: "flex", ...style } }, String(value ?? "—"));

function chart(title, points) {
  const { minimum, span } = adaptiveChartDomain(points.map((point) => point.value));
  const plotted = points.map((point, index) => ({ ...point, x: 35 + index * 440 / Math.max(1, points.length - 1), y: 145 - (point.value - minimum) / span * 100 }));
  return h("div", { style: { display: "flex", flexDirection: "column", width: 540, padding: 16, background: "#17233b", borderRadius: 12 } },
    text(title, { fontSize: 23, marginBottom: 10 }),
    points.length ? h("div", { style: { display: "flex", position: "relative", width: 508, height: 205 } },
      h("svg", { width: 508, height: 205, viewBox: "0 0 508 205" },
        h("path", { d: plotted.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" "), stroke: "#62d7cf", strokeWidth: 3, fill: "none" }),
        ...plotted.map((point) => h("circle", { key: point.date, cx: point.x, cy: point.y, r: 4, fill: "#62d7cf" })),
      ),
      ...plotted.flatMap((point) => [
        text(compact(point.value), { position: "absolute", left: point.x - 34, top: point.y - 28, width: 68, justifyContent: "center", fontSize: 16 }),
        text(point.date.slice(5), { position: "absolute", left: point.x - 34, top: 180, width: 68, justifyContent: "center", fontSize: 13, color: "#bdcbe4" }),
      ]),
    ) : text("No recorded results", { height: 205, alignItems: "center", color: "#bdcbe4" }),
  );
}

export function renderShareImage(model) {
  return h("div", { style: { display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 40, background: "#0c1527", color: "#f4f7ff", fontFamily: "sans-serif" } },
    text("ARCHERO GUILD · MEMBER PROFILE", { fontSize: 20, color: "#62d7cf" }),
    text(model.name, { fontSize: 38, marginTop: 12, height: 52, overflow: "hidden" }),
    text(`Player ${model.playerId} · Power ${compact(model.power)} · Checkpoint ${model.checkpointDate ?? "unknown"}`, { fontSize: 21, color: "#bdcbe4", marginBottom: 22 }),
    h("div", { style: { display: "flex", gap: 20 } }, chart("Power progression", model.powerHistory), chart(`${model.bossName} · personal record`, model.bossHistory)),
    text("Personal bests by boss", { fontSize: 25, marginTop: 22, marginBottom: 8 }),
    ...model.records.map((record) => h("div", { key: record.name, style: { display: "flex", justifyContent: "space-between", fontSize: 20, padding: "7px 4px", borderBottom: "1px solid #26334b" } },
      text(record.name, { width: 500 }), text(compact(record.damage), { width: 240 }), text(record.date ?? "No record", { color: "#bdcbe4" }),
    )),
    text("Up to 7 evenly sampled observations, including endpoints; no averaging. Boss chart uses running personal bests.", { fontSize: 16, color: "#bdcbe4", marginTop: 20 }),
    text("Versioned image · link expires after 12 hours or when this image's data changes", { fontSize: 16, color: "#bdcbe4", marginTop: 8 }),
  );
}
