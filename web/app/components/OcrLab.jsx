"use client";

import { useMemo, useState } from "react";

export default function OcrLab() {
  const [kind, setKind] = useState("guild-members");
  const [includePodium, setIncludePodium] = useState(true);
  const [file, setFile] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState(null);
  const result = response?.result;
  const columns = useMemo(() => resultColumns(kind), [kind]);

  async function runOcr(event) {
    event.preventDefault();
    if (!file) {
      setError("Choose a PNG screenshot first.");
      return;
    }
    setRunning(true);
    setError("");
    setResponse(null);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("includePodium", String(includePodium));
      form.set("file", file);
      const request = await fetch("/api/data/ocr", {
        method: "POST",
        headers: { "x-archero-dashboard-action": "1" },
        body: form,
      });
      const payload = await request.json();
      if (!request.ok || !payload?.ok) throw new Error(payload?.error || "OCR request failed.");
      setResponse(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OCR request failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="ocr-lab">
      <form className="panel ocr-lab-form" onSubmit={runOcr}>
        <label>
          <span>Screenshot type</span>
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="guild-members">Guild members</option>
            <option value="guild-boss">Guild boss</option>
          </select>
        </label>
        <label className="ocr-file-field">
          <span>PNG screenshot</span>
          <input
            type="file"
            accept="image/png"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <small>{file ? `${file.name} · ${formatBytes(file.size)}` : "The file is processed temporarily and is not imported."}</small>
        </label>
        {kind === "guild-boss" ? (
          <label className="ocr-checkbox-field">
            <input type="checkbox" checked={includePodium} onChange={(event) => setIncludePodium(event.target.checked)} />
            <span>Read the top-3 podium (enable only for the first screenshot of a batch)</span>
          </label>
        ) : null}
        <button className="primary-button" type="submit" disabled={running}>
          {running ? "Scanning…" : "Run OCR only"}
        </button>
        {error ? <p className="ocr-error" role="alert">{error}</p> : null}
      </form>

      {result ? (
        <>
          <section className="ocr-quality-grid" aria-label="OCR quality">
            <QualityCard label="Status" value={result.quality.status === "pass" ? "PASS" : "REVIEW"} tone={result.quality.status} />
            <QualityCard
              label="Detected"
              value={result.quality.expectedRows}
              detail={`${result.detection.rowCount} list rows${result.detection.podiumCount ? ` + ${result.detection.podiumCount} podium` : ""}`}
            />
            <QualityCard label="Coverage" value={formatPercent(result.quality.coverage)} detail={`${result.quality.usefulRows} useful rows`} />
            <QualityCard label="Complete" value={formatPercent(result.quality.completeness)} detail={`${result.quality.completeRows} complete rows`} />
            <QualityCard label="OCR time" value={`${result.timingsMs.ocr} ms`} detail={`${result.timingsMs.total} ms total`} />
          </section>

          {result.quality.warnings.length ? (
            <section className="panel ocr-warning-panel">
              <strong>Quality gate blocked</strong>
              <ul>{result.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </section>
          ) : null}

          <section className="ocr-preview-grid">
            <Preview title="Normalized image" detail={`${result.normalization.canonicalWidth} × ${result.normalization.canonicalHeight}`} src={response.previews.normalized} />
            <Preview title="Detected rows" detail="Cyan boxes are the areas sent to OCR" src={response.previews.annotated} />
          </section>

          <section className="panel table-panel">
            <div className="panel-heading">
              <div>
                <h2>OCR response</h2>
                <p>{result.rows.length} rows returned by the isolated service</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="ocr-result-table">
                <thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={`${row.source ?? "row"}-${index}`}>
                      {columns.map(([key]) => <td key={key}>{displayValue(row[key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="panel ocr-json">
            <summary>Raw JSON contract</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </div>
  );
}

function QualityCard({ label, value, detail = "", tone = "" }) {
  return (
    <article className={`metric-card ocr-quality-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function Preview({ title, detail, src }) {
  return (
    <figure className="panel ocr-preview">
      <figcaption><strong>{title}</strong><span>{detail}</span></figcaption>
      <img src={src} alt={title} />
    </figure>
  );
}

function resultColumns(kind) {
  return kind === "guild-members"
    ? [["playerId", "Player ID"], ["name", "Name"], ["roleText", "Role"], ["powerText", "Power"], ["contribution7d", "Donation"], ["bossAttacks", "Boss"], ["activityText", "Activity"], ["matchStatus", "Match"], ["matchScore", "Score"]]
    : [["name", "Name"], ["rank", "Rank"], ["damageText", "Damage"], ["rawName", "Detected name"]];
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (value === "matched") return "Matched";
  if (value === "unmatched") return "Unmatched";
  return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
}

function formatPercent(value) {
  return `${Math.round(Number(value ?? 0) * 100)}%`;
}

function formatBytes(value) {
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
