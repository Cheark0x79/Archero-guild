const state = {
  batch: null,
  corrections: { entries: [] },
  table: "members",
  status: null,
  busy: false,
  step: 1,
  images: [],
  referenceImages: [],
  preflight: null,
};
const $ = (id) => document.getElementById(id);

const MEMBER_COLUMNS = [
  { label: "Action", key: "_actions", action: true },
  { label: "Player ID", key: "playerId", editable: true },
  { label: "Detected name", key: "rawName", editable: true, wide: true },
  { label: "Linked name", key: "name", editable: true },
  {
    label: "Role",
    key: "role",
    editable: true,
    options: [
      ["", "— Select —"],
      ["leader", "Leader"],
      ["officer", "Vice-leader"],
      ["elder", "Elder"],
      ["member", "Guild member"],
    ],
  },
  { label: "Power", key: "powerText", editable: true, placeholder: "1.42M" },
  { label: "Last connection", key: "activityText", editable: true, placeholder: "1 d 10 h" },
  { label: "Donation", key: "contribution7d", editable: true, input: "number" },
  { label: "Boss tries", key: "bossAttacks", editable: true, input: "number" },
  { label: "Source", key: "source" },
  { label: "Match", key: "matchScore" },
];

const BOSS_COLUMNS = [
  { label: "Action", key: "_actions", action: true },
  { label: "Rank", key: "rank", editable: true, input: "number" },
  { label: "Detected name", key: "rawName", editable: true, wide: true },
  { label: "Linked name", key: "name", editable: true },
  { label: "Damage", key: "damageText", editable: true, placeholder: "615.55M" },
  {
    label: "Area",
    key: "area",
    editable: true,
    options: [["podium", "Podium"], ["list", "List"]],
  },
  { label: "Source", key: "source" },
];

function localDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function formatFrenchDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function parseFrenchDate(displayDate) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(displayDate || "").trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const candidate = new Date(`${year}-${month}-${day}T12:00:00Z`);
  if (
    candidate.getUTCFullYear() !== Number(year)
    || candidate.getUTCMonth() + 1 !== Number(month)
    || candidate.getUTCDate() !== Number(day)
  ) return null;
  return `${year}-${month}-${day}`;
}

function setCaptureDate(isoDate) {
  $("capture-date").value = isoDate;
  $("capture-date-display").value = formatFrenchDate(isoDate);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function setBusy(busy) {
  state.busy = busy;
  [
    "upload", "scan", "refresh", "clear", "preflight", "add-row",
    "reset-session", "reference-previous", "reference-next",
  ].forEach((id) => { $(id).disabled = busy; });
  document.querySelectorAll("[data-edit-field]").forEach((control) => { control.disabled = busy; });
  document.querySelectorAll(".delete-row, .add-missing-member").forEach((control) => { control.disabled = busy; });
  renderUploadSelection();
  renderExtractionSelection();
  renderReferenceImage();
  updateTargetEditor();
  updateTargetControls();
}

function message(text, error = false) {
  $("message").textContent = text;
  $("message").className = error ? "error" : "";
}

async function loadStatus() {
  try {
    const payload = await request("/api/status");
    state.status = payload;
    $("service-dot").classList.add("online");
    $("service-label").textContent = payload.busy ? "OCR busy" : "OCR ready";
    $("agent-version").textContent = `Agent ${payload.agentVersion}`;
    const previous = $("target").value;
    $("target").replaceChildren(...payload.targets.map((target) => {
      const option = document.createElement("option");
      option.value = target.key;
      option.disabled = target.mode === "remote" && !target.configured;
      const destination = target.mode === "local"
        ? "clear/review only"
        : target.configured ? target.url : "configuration required";
      option.textContent = `${target.label} · ${destination}`;
      return option;
    }));
    const selected = payload.targets.find((target) => target.key === previous)
      ?? payload.targets.find((target) => target.key === "preprod" && target.configured)
      ?? payload.targets.find((target) => target.mode === "remote" && target.configured)
      ?? payload.targets[0];
    if (selected) $("target").value = selected.key;
    updateTargetEditor();
    updateTargetControls();
    await loadDay();
  } catch (error) {
    $("service-label").textContent = "OCR unavailable";
    message(error.message, true);
  }
}

async function loadDay() {
  const captureDate = $("capture-date").value;
  if (!captureDate) return;
  try {
    const payload = await request(`/api/day?date=${encodeURIComponent(captureDate)}`);
    state.images = [];
    renderUploadSelection();
    renderExtractionSelection();
    if (payload.batchReady) await loadBatch();
    else clearBatchView();
  } catch (error) {
    message(error.message, true);
  }
}

function renderUploadSelection() {
  const files = [...$("upload-files").files];
  $("upload-count").textContent = files.length
    ? `${files.length} file${files.length === 1 ? "" : "s"} selected`
    : "No files selected";
  $("upload").disabled = state.busy || files.length === 0;
  if (!files.length) {
    const help = document.createElement("p");
    help.className = "muted";
    help.textContent = "A new upload replaces the active screenshots for this source. Older files are archived and cannot be reused by OCR.";
    $("upload-selection").replaceChildren(help);
    return;
  }
  $("upload-selection").replaceChildren(...files.map((file) => {
    const chip = document.createElement("span");
    chip.className = "file-chip";
    const icon = document.createElement("strong");
    icon.textContent = "PNG";
    const name = document.createElement("span");
    name.textContent = file.name;
    chip.append(icon, name);
    return chip;
  }));
}

function renderExtractionSelection() {
  const count = state.images.length;
  const selectedKind = selectedImageKind();
  const label = scopeLabel(selectedKind);
  const existingScope = state.batch ? batchScope(state.batch) : null;
  $("extract-kind").textContent = count ? label : "No source selected";
  if (!count && existingScope && existingScope !== "mixed") {
    $("extract-kind").textContent = `${scopeLabel(existingScope)} reviewed`;
  }
  $("extract-kind").className = `badge ${count || existingScope ? "pass" : "neutral"}`;
  $("extract-count").textContent = count
    ? `${count} screenshot${count === 1 ? "" : "s"} ready`
    : existingScope
      ? "Existing batch available in Review"
      : "Upload screenshots in Step 1";
  $("scan").disabled = state.busy || count === 0;
  $("scan-help").textContent = count
    ? `Validate this ${label} session to start local OCR. No destination is contacted.`
    : existingScope
      ? "Upload new screenshots in Step 1 to start another extraction."
      : "Upload screenshots in Step 1 before extraction.";
}

function selectedImageKind() {
  const kinds = new Set(state.images.map((image) => image.kind));
  return kinds.size === 1 ? [...kinds][0] : null;
}

function captureImageUrl(captureDate, kind, name) {
  return `/api/image?date=${encodeURIComponent(captureDate)}&kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`;
}

async function uploadImages() {
  const files = [...$("upload-files").files];
  if (!files.length) {
    message("Select at least one PNG screenshot.", true);
    return;
  }
  setBusy(true);
  message(`Reading ${files.length} screenshot(s)…`);
  try {
    const encoded = await Promise.all(files.map(async (file) => ({
      name: file.name,
      data: await fileToDataUrl(file),
    })));
    const payload = await request("/api/upload", {
      method: "POST",
      body: JSON.stringify({
        date: $("capture-date").value,
        kind: $("upload-kind").value,
        files: encoded,
      }),
    });
    const captureDate = $("capture-date").value;
    const kind = $("upload-kind").value;
    state.images = payload.files.map((file) => ({
      ...file,
      url: captureImageUrl(captureDate, kind, file.name),
    }));
    state.referenceImages = [...state.images];
    $("upload-files").value = "";
    clearBatchView();
    renderUploadSelection();
    renderExtractionSelection();
    renderReferenceOptions();
    message(`${payload.files.length} ${scopeLabel(kind)} screenshot(s) uploaded. The previous active session was archived.`);
    goToStep(2);
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function resetCaptureSession() {
  const captureDate = $("capture-date").value;
  const kind = $("upload-kind").value;
  const label = scopeLabel(kind);
  if (!window.confirm(`Reset the active ${label} capture session for ${captureDate}? The old screenshots will be archived.`)) return;
  setBusy(true);
  message(`Resetting ${label} capture session…`);
  try {
    const payload = await request("/api/session/reset", {
      method: "POST",
      body: JSON.stringify({
        date: captureDate,
        kind,
        confirmation: `RESET ${captureDate} ${kind}`,
      }),
    });
    state.images = [];
    state.referenceImages = [];
    $("upload-files").value = "";
    clearBatchView();
    renderUploadSelection();
    renderExtractionSelection();
    message(`${label} session reset. ${payload.archivedImages} active screenshot(s) archived.`);
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function runScan() {
  const images = state.images.map(({ kind, name }) => ({ kind, name }));
  if (!images.length) {
    message("Select at least one screenshot in Step 1 before extraction.", true);
    goToStep(1);
    return;
  }
  if (new Set(images.map((image) => image.kind)).size !== 1) {
    message("Extract Guild members and Guild boss as two separate batches.", true);
    goToStep(1);
    return;
  }
  setBusy(true);
  $("extraction-progress").hidden = false;
  $("scan").textContent = "Extracting…";
  message(`Running Tesseract locally on ${images.length} selected screenshot(s)…`);
  try {
    const payload = await request("/api/scan", {
      method: "POST",
      body: JSON.stringify({ date: $("capture-date").value, images }),
    });
    const rosterSource = payload.result?.rosterSource;
    const rosterMessage = rosterSource?.type === "database"
      ? ` IDs were matched against ${rosterSource.label}.`
      : rosterSource ? " The local fallback roster was used for ID matching." : "";
    message(`OCR extraction finished.${rosterMessage} Review rows highlighted in red.`);
    await loadBatch();
    goToStep(3);
  } catch (error) {
    message(error.message, true);
  } finally {
    $("extraction-progress").hidden = true;
    $("scan").textContent = "Validate and extract";
    setBusy(false);
  }
}

async function loadBatch() {
  const payload = await request(`/api/batch?date=${encodeURIComponent($("capture-date").value)}`);
  state.batch = payload.batch;
  state.corrections = payload.corrections || { entries: [] };
  renderBatch();
  await loadMissingMembers();
}

function clearBatchView() {
  state.batch = null;
  state.corrections = { entries: [] };
  resetPreflight();
  $("quality-badge").textContent = "No batch";
  $("quality-badge").className = "badge neutral";
  ["members-count", "boss-count", "coverage", "completeness"].forEach((id) => { $(id).textContent = "—"; });
  $("quality-warnings").replaceChildren();
  $("batch-key").textContent = "No reviewed batch";
  $("review-scope-label").textContent = "No source extracted";
  $("review-count").textContent = "0 rows";
  $("publish-scope").textContent = "No source ready";
  $("review-head").replaceChildren();
  $("review-body").replaceChildren();
  $("missing-members").hidden = true;
  $("missing-members-list").replaceChildren();
  if (!state.images.length) state.referenceImages = [];
  renderReferenceOptions();
  renderCorrections();
  updateTargetControls();
}

function renderBatch() {
  const batch = state.batch;
  if (!batch) return clearBatchView();
  const quality = batch.quality || {};
  const scope = batchScope(batch);
  if (state.preflight?.key !== preflightKey()) resetPreflight();
  $("quality-badge").textContent = `${scopeLabel(scope)} · ${quality.status || "unknown"}`;
  $("quality-badge").className = `badge ${quality.status || "neutral"}`;
  $("members-count").textContent = batch.members?.length ?? 0;
  $("boss-count").textContent = batch.bossRankings?.length ?? 0;
  $("coverage").textContent = percent(quality.coverage);
  $("completeness").textContent = percent(quality.completeness);
  $("batch-key").textContent = batch.idempotencyKey || "No idempotency key";
  $("review-scope-label").textContent = scopeLabel(scope);
  const reviewRows = scope === "guild-boss" ? batch.bossRankings || [] : batch.members || [];
  const incompleteRows = reviewRows.filter((row) => missingFields(row, scope === "guild-boss" ? "bosses" : "members").length > 0).length;
  const duplicateIds = scope === "guild-members" ? duplicateValues(reviewRows, "playerId") : new Set();
  const duplicateRows = reviewRows.filter((row) => duplicateIds.has(row.playerId)).length;
  $("review-count").textContent = [
    `${reviewRows.length} row${reviewRows.length === 1 ? "" : "s"}`,
    incompleteRows ? `${incompleteRows} incomplete` : "",
    duplicateRows ? `${duplicateRows} duplicate IDs` : "",
  ].filter(Boolean).join(" · ");
  $("publish-scope").textContent = `${scopeLabel(scope)} only`;
  $("quality-warnings").replaceChildren(...(quality.warnings || []).map((warning) => {
    const row = document.createElement("span");
    row.textContent = warning;
    return row;
  }));
  if (scope !== "mixed") state.table = scope === "guild-boss" ? "bosses" : "members";
  state.referenceImages = (batch.sourceImages || []).map((image) => ({
    kind: image.kind,
    name: image.sourceName,
    url: captureImageUrl($("capture-date").value, image.kind, image.sourceName),
  }));
  renderReferenceOptions();
  renderTable();
  renderCorrections();
  renderExtractionSelection();
  updateTargetControls();
}

async function loadMissingMembers() {
  if (!state.batch || batchScope(state.batch) !== "guild-members") {
    $("missing-members").hidden = true;
    $("missing-members-list").replaceChildren();
    return;
  }
  try {
    const payload = await request(`/api/missing-members?date=${encodeURIComponent($("capture-date").value)}`);
    const members = payload.members || [];
    $("missing-members").hidden = members.length === 0;
    $("missing-members-count").textContent = `${members.length} missing`;
    $("missing-members-source").textContent = payload.target
      ? `Compared with ${payload.target.label}`
      : "";
    $("missing-members-list").replaceChildren(...members.map((member) => {
      const item = document.createElement("article");
      item.className = "missing-member";
      const identity = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = member.name;
      const id = document.createElement("small");
      id.textContent = member.playerId;
      identity.append(name, id);
      const add = document.createElement("button");
      add.type = "button";
      add.className = "button secondary compact add-missing-member";
      add.textContent = "Add row";
      add.disabled = state.busy;
      add.addEventListener("click", () => addReviewedRow(member));
      item.append(identity, add);
      return item;
    }));
  } catch (error) {
    $("missing-members").hidden = false;
    $("missing-members-count").textContent = "Check unavailable";
    $("missing-members-source").textContent = error.message;
    $("missing-members-list").replaceChildren();
  }
}

async function addReviewedRow(initial = {}) {
  const category = state.table;
  setBusy(true);
  message(initial.name ? `Adding ${initial.name} to the review…` : "Adding a manual review row…");
  try {
    const payload = await request("/api/add-row", {
      method: "POST",
      body: JSON.stringify({
        date: $("capture-date").value,
        category,
        initial,
      }),
    });
    state.batch = payload.batch;
    state.corrections = payload.corrections;
    renderBatch();
    await loadMissingMembers();
    message(initial.name
      ? `${initial.name} added. Missing metrics are highlighted in red; they may remain empty.`
      : "Manual row added. Add at least a linked name; other missing member metrics may remain empty.");
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderTable() {
  const category = state.table;
  const columns = category === "members" ? MEMBER_COLUMNS : BOSS_COLUMNS;
  const rows = category === "members" ? state.batch?.members || [] : state.batch?.bossRankings || [];
  const duplicateIds = category === "members" ? duplicateValues(rows, "playerId") : new Set();
  const headerRow = document.createElement("tr");
  columns.forEach(({ label }) => {
    const th = document.createElement("th");
    th.textContent = label;
    headerRow.append(th);
  });
  $("review-head").replaceChildren(headerRow);
  $("review-body").replaceChildren(...rows.map((row, rowIndex) => {
    const tr = document.createElement("tr");
    const missing = missingFields(row, category);
    const duplicateId = duplicateIds.has(row.playerId);
    if (missing.length || duplicateId) {
      tr.classList.add("needs-review");
      tr.title = [
        missing.length ? `Missing: ${missing.join(", ")}` : "",
        duplicateId ? `Duplicate Player ID: ${row.playerId}` : "",
      ].filter(Boolean).join(" · ");
    }
    columns.forEach((column) => {
      const td = document.createElement("td");
      if (missing.includes(column.key) || (duplicateId && column.key === "playerId")) td.classList.add("missing-value");
      if (column.action) td.append(deleteRowButton(category, rowIndex, row));
      else if (column.editable) td.append(editControl(category, rowIndex, row, column));
      else td.textContent = displayValue(row[column.key]);
      tr.append(td);
    });
    return tr;
  }));
}

function duplicateValues(rows, key) {
  const seen = new Set();
  const duplicates = new Set();
  rows.forEach((row) => {
    const value = row?.[key];
    if (value === null || value === undefined || value === "") return;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return duplicates;
}

function missingFields(row, category) {
  if (category === "bosses") {
    return [
      ["rank", Number.isInteger(row.rank)],
      ["name", Boolean(String(row.name || "").trim())],
      ["damageText", Number.isInteger(row.damage) && Boolean(String(row.damageText || "").trim())],
    ].filter(([, complete]) => !complete).map(([field]) => field);
  }
  return [
    ["playerId", Boolean(String(row.playerId || "").trim())],
    ["rawName", Boolean(String(row.rawName || "").trim())],
    ["name", Boolean(String(row.name || "").trim())],
    ["role", ["leader", "officer", "elder", "member"].includes(row.role)],
    ["powerText", Number.isInteger(row.power)],
    ["activityText", Number.isInteger(row.lastActivityDays)],
    ["contribution7d", Number.isInteger(row.contribution7d)],
    ["bossAttacks", Number.isInteger(row.bossAttacks)],
  ].filter(([, complete]) => !complete).map(([field]) => field);
}

function deleteRowButton(category, rowIndex, row) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "delete-row";
  button.textContent = "Reject row";
  button.disabled = state.busy;
  button.addEventListener("click", () => deleteReviewedRow(category, rowIndex, row));
  return button;
}

async function deleteReviewedRow(category, rowIndex, row) {
  const name = row.rawName || row.name || `row ${rowIndex + 1}`;
  if (!window.confirm(`Reject the OCR row "${name}"? It will not be published.`)) return;
  setBusy(true);
  message(`Rejecting OCR row ${name}…`);
  try {
    const payload = await request("/api/delete-row", {
      method: "POST",
      body: JSON.stringify({
        date: $("capture-date").value,
        category,
        rowIndex,
      }),
    });
    state.batch = payload.batch;
    state.corrections = payload.corrections;
    renderBatch();
    message(`OCR row "${name}" rejected. It will not be published.`);
  } catch (error) {
    message(error.message, true);
    await loadBatch().catch(() => {});
  } finally {
    setBusy(false);
  }
}

function editControl(category, rowIndex, row, column) {
  const control = column.options ? document.createElement("select") : document.createElement("input");
  if (column.options) {
    control.replaceChildren(...column.options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
  } else {
    control.type = column.input || "text";
    control.placeholder = column.placeholder || "";
    if (column.input === "number") control.min = "0";
  }
  control.value = row[column.key] ?? "";
  control.className = `cell-editor${column.wide ? " wide" : ""}`;
  control.dataset.editField = column.key;
  control.addEventListener("change", () => saveEdit(category, rowIndex, column.key, control.value));
  return control;
}

async function saveEdit(category, rowIndex, field, value) {
  setBusy(true);
  message(`Saving correction for ${field}…`);
  try {
    const payload = await request("/api/edit", {
      method: "POST",
      body: JSON.stringify({
        date: $("capture-date").value,
        category,
        rowIndex,
        field,
        value,
      }),
    });
    state.batch = payload.batch;
    state.corrections = payload.corrections;
    renderBatch();
    message(`Correction saved: ${field}.`);
  } catch (error) {
    message(error.message, true);
    await loadBatch().catch(() => {});
  } finally {
    setBusy(false);
  }
}

function renderCorrections() {
  const entries = [...(state.corrections?.entries || [])].reverse();
  $("correction-count").textContent = `${entries.length} correction${entries.length === 1 ? "" : "s"}`;
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No manual correction for this extraction.";
    $("correction-list").replaceChildren(empty);
    return;
  }
  $("correction-list").replaceChildren(...entries.map((entry) => {
    const item = document.createElement("article");
    item.className = "correction-item";
    const title = document.createElement("strong");
    title.textContent = entry.action === "delete"
      ? `${entry.category} · rejected row`
      : entry.action === "add"
        ? `${entry.category} · added row`
      : `${entry.category} · ${entry.field}`;
    const source = document.createElement("small");
    source.textContent = entry.source || `row ${entry.rowIndex + 1}`;
    const change = document.createElement("div");
    const before = document.createElement("del");
    before.textContent = entry.action === "delete"
      ? deletedRowLabel(entry.before)
      : entry.action === "add" ? "Not present" : displayValue(entry.before);
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    const after = document.createElement("ins");
    after.textContent = entry.action === "delete"
      ? "Not published"
      : entry.action === "add" ? deletedRowLabel(entry.after) : displayValue(entry.after);
    change.append(before, arrow, after);
    item.append(title, source, change);
    return item;
  }));
}

function deletedRowLabel(row) {
  if (!row || typeof row !== "object") return "OCR row";
  return row.rawName || row.name || row.source || "OCR row";
}

async function clearExtractedData() {
  const captureDate = $("capture-date").value;
  if (!state.batch) {
    message("There is no extracted JSON to clear.", true);
    return;
  }
  if (!window.confirm(`Clear the extracted JSON and correction history for ${captureDate}? Screenshots will be kept.`)) return;
  setBusy(true);
  try {
    await request("/api/clear", {
      method: "POST",
      body: JSON.stringify({ date: captureDate, confirmation: `CLEAR ${captureDate}` }),
    });
    clearBatchView();
    message(`Extracted data for ${captureDate} cleared. Screenshots were kept.`);
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function publishBatch() {
  if (state.preflight?.key !== preflightKey()) {
    message("Check the destination before publishing this batch.", true);
    return;
  }
  setBusy(true);
  message("Destination checked. Publishing the reviewed JSON…");
  try {
    const payload = await request("/api/publish", {
      method: "POST",
      body: JSON.stringify({
        date: $("capture-date").value,
        target: $("target").value,
        confirmation: $("confirmation").value.trim(),
      }),
    });
    $("confirmation").value = "";
    const label = scopeLabel(batchScope(state.batch));
    message(payload.result.import?.replayed ? `${label} batch was already present on the target.` : `${label} batch published successfully.`);
    resetPreflight();
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

function preflightKey() {
  if (!state.batch) return "";
  return [
    $("capture-date").value,
    $("target").value,
    state.batch.idempotencyKey || "",
  ].join(":");
}

function resetPreflight() {
  state.preflight = null;
  $("preflight-state").textContent = "Not checked";
  $("preflight-state").className = "badge neutral";
  $("preflight-help").textContent = "Check connectivity, authentication and batch validity before sending.";
}

async function checkDestination() {
  const target = selectedTarget();
  if (!target || target.mode !== "remote" || !target.configured || !state.batch) {
    message("Choose a configured remote destination and a reviewed batch first.", true);
    return;
  }
  resetPreflight();
  setBusy(true);
  $("preflight-state").textContent = "Checking…";
  $("preflight-help").textContent = "Contacting the destination without importing data…";
  message(`Checking ${target.label} before publication…`);
  try {
    await request("/api/preflight", {
      method: "POST",
      body: JSON.stringify({
        date: $("capture-date").value,
        target: target.key,
      }),
    });
    state.preflight = { key: preflightKey() };
    $("preflight-state").textContent = "Ready to send";
    $("preflight-state").className = "badge pass";
    $("preflight-help").textContent = "Connectivity, authentication and batch validation succeeded. No data was imported.";
    message(`${target.label} check passed. You can now confirm and publish.`);
  } catch (error) {
    resetPreflight();
    $("preflight-state").textContent = "Check failed";
    $("preflight-state").className = "badge review";
    $("preflight-help").textContent = error.message;
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

function batchScope(batch) {
  const kinds = new Set((batch?.sourceImages || []).map((image) => image.kind));
  if (kinds.size !== 1) return "mixed";
  return [...kinds][0];
}

function scopeLabel(scope) {
  if (scope === "guild-members") return "Guild members";
  if (scope === "guild-boss") return "Guild boss";
  return "Mixed";
}

function selectedTarget() {
  return state.status?.targets?.find((target) => target.key === $("target").value);
}

function updateTargetEditor() {
  const target = selectedTarget();
  if (!target) return;
  const local = target.mode === "local";
  $("target-state").textContent = local ? "Local only" : target.configured ? "Ready" : "Needs configuration";
  $("target-state").className = `badge ${target.configured ? "pass" : "neutral"}`;
  $("target-summary").textContent = local
    ? "Local test keeps the reviewed JSON on this PC and never sends data."
    : target.configured
      ? `Configured endpoint: ${target.url}`
      : "This destination is not configured. Update ocr/targets.json before publishing.";
}

function updateTargetControls() {
  const target = selectedTarget();
  if (!target) return;
  const hasPublishableBatch = isLocallyPublishableBatch(state.batch);
  const hasValidPreflight = state.preflight?.key === preflightKey();
  $("preflight").disabled = state.busy || target.mode === "local" || !target.configured || !hasPublishableBatch;
  if (target.mode === "local") {
    $("preflight-state").textContent = "Not required";
    $("preflight-state").className = "badge neutral";
    $("preflight-help").textContent = "Local test does not send data.";
    $("confirmation-help").textContent = "Local test keeps data on this PC. Use Clear or choose a remote destination.";
    $("confirmation").placeholder = "Publication disabled for local test";
    $("confirmation").disabled = true;
    $("publish").disabled = true;
    return;
  }
  const phrase = `PUBLISH ${target.key.toUpperCase()}`;
  const confirmationMatches = $("confirmation").value.trim() === phrase;
  const duplicateMemberIds = duplicateValues(state.batch?.members || [], "playerId");
  const coverage = Number(state.batch?.quality?.coverage);
  const blocker = !target.configured
    ? "Configure this destination in ocr/targets.json."
    : !state.batch
      ? "Complete OCR extraction and review before checking the destination."
    : batchScope(state.batch) === "mixed"
      ? "Guild and Boss must be extracted and published as two separate batches."
    : duplicateMemberIds.size
      ? `Resolve duplicate Player IDs: ${[...duplicateMemberIds].join(", ")}.`
    : Number.isFinite(coverage) && coverage < 1
      ? `Coverage is ${(coverage * 100).toFixed(1)}%. Review or add the missing row before checking the destination.`
    : !hasPublishableBatch
      ? "A linked name is required for every row. Other missing member metrics may stay empty."
      : null;
  if (blocker) {
    $("preflight-state").textContent = "Blocked";
    $("preflight-state").className = "badge review";
    $("preflight-help").textContent = blocker;
  } else if (!hasValidPreflight) {
    $("preflight-state").textContent = "Not checked";
    $("preflight-state").className = "badge neutral";
    $("preflight-help").textContent = "Check connectivity, authentication and batch validity before sending.";
  }
  $("confirmation-help").textContent = blocker
    ?? (!hasValidPreflight
        ? "Check the destination before confirming publication."
        : `Type ${phrase}`);
  $("confirmation").placeholder = phrase;
  $("confirmation").disabled = state.busy || !target.configured || !hasPublishableBatch || !hasValidPreflight;
  $("publish").disabled = state.busy || !target.publishable || !hasPublishableBatch || !hasValidPreflight || !confirmationMatches;
}

function isLocallyPublishableBatch(batch) {
  if (!batch || batchScope(batch) === "mixed" || batch.quality?.coverage !== 1) return false;
  const scope = batchScope(batch);
  if (scope === "guild-members") {
    const rows = batch.members || [];
    return rows.length > 0
      && duplicateValues(rows, "playerId").size === 0
      && rows.every((row) => Boolean(String(row.name || "").trim()));
  }
  if (scope === "guild-boss") {
    const rows = batch.bossRankings || [];
    return rows.length > 0 && rows.every((row) => missingFields(row, "bosses").length === 0);
  }
  return false;
}

function renderReferenceOptions() {
  const previous = $("reference-image").value;
  $("reference-image").replaceChildren(...state.referenceImages.map((image) => {
    const option = document.createElement("option");
    option.value = image.url;
    option.textContent = `${image.kind === "guild-members" ? "Guild" : "Boss"} · ${image.name}`;
    return option;
  }));
  if (state.referenceImages.some((image) => image.url === previous)) $("reference-image").value = previous;
  renderReferenceImage();
}

function renderReferenceImage() {
  const selectedIndex = state.referenceImages.findIndex((image) => image.url === $("reference-image").value);
  const selected = selectedIndex >= 0 ? state.referenceImages[selectedIndex] : null;
  $("reference-preview").hidden = !selected;
  $("reference-empty").hidden = Boolean(selected);
  $("reference-position").textContent = selected
    ? `${selectedIndex + 1} / ${state.referenceImages.length}`
    : `0 / ${state.referenceImages.length}`;
  $("reference-previous").disabled = state.busy || selectedIndex <= 0;
  $("reference-next").disabled = state.busy || selectedIndex < 0 || selectedIndex >= state.referenceImages.length - 1;
  if (selected) {
    $("reference-preview").src = selected.url;
    $("reference-preview").alt = `${selected.kind} ${selected.name}`;
  } else {
    $("reference-preview").removeAttribute("src");
  }
}

function moveReferenceImage(offset) {
  const current = state.referenceImages.findIndex((image) => image.url === $("reference-image").value);
  const next = Math.max(0, Math.min(state.referenceImages.length - 1, current + offset));
  if (current < 0 || next === current) return;
  $("reference-image").value = state.referenceImages[next].url;
  renderReferenceImage();
}

function selectReferenceForTable() {
  const kind = state.table === "members" ? "guild-members" : "guild-boss";
  const image = state.referenceImages.find((item) => item.kind === kind);
  if (image) {
    $("reference-image").value = image.url;
    renderReferenceImage();
  }
}

function goToStep(step) {
  const next = Math.max(1, Math.min(4, Number(step) || 1));
  state.step = next;
  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    panel.classList.toggle("active", Number(panel.dataset.stepPanel) === next);
  });
  document.querySelectorAll("[data-go-step]").forEach((button) => {
    const active = Number(button.dataset.goStep) === next;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  $("previous-step").disabled = next === 1;
  $("next-step").disabled = next === 4;
  $("step-position").textContent = `Step ${next} of 4`;
  if (next === 3) selectReferenceForTable();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function percent(value) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

setCaptureDate(localDate());
$("refresh").addEventListener("click", () => {
  state.images = [];
  state.referenceImages = [];
  loadStatus();
});
function commitCaptureDate() {
  const captureDate = parseFrenchDate($("capture-date-display").value);
  if (!captureDate) {
    message("Enter the data date as DD/MM/YYYY.", true);
    $("capture-date-display").focus();
    return false;
  }
  if ($("capture-date").value === captureDate) return true;
  setCaptureDate(captureDate);
  state.images = [];
  state.referenceImages = [];
  loadDay();
  return true;
}
$("capture-date-display").addEventListener("change", commitCaptureDate);
$("capture-date-display").addEventListener("blur", commitCaptureDate);
$("capture-date-display").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (commitCaptureDate()) $("capture-date-display").blur();
});
$("upload-files").addEventListener("change", renderUploadSelection);
$("upload-kind").addEventListener("change", renderUploadSelection);
$("target").addEventListener("change", () => {
  resetPreflight();
  updateTargetEditor();
  updateTargetControls();
});
$("confirmation").addEventListener("input", updateTargetControls);
$("reference-image").addEventListener("change", renderReferenceImage);
$("reference-previous").addEventListener("click", () => moveReferenceImage(-1));
$("reference-next").addEventListener("click", () => moveReferenceImage(1));
$("upload").addEventListener("click", uploadImages);
$("reset-session").addEventListener("click", resetCaptureSession);
$("scan").addEventListener("click", runScan);
$("clear").addEventListener("click", clearExtractedData);
$("publish").addEventListener("click", publishBatch);
$("preflight").addEventListener("click", checkDestination);
$("add-row").addEventListener("click", () => addReviewedRow());
$("previous-step").addEventListener("click", () => goToStep(state.step - 1));
$("next-step").addEventListener("click", () => goToStep(state.step + 1));
document.querySelectorAll("[data-go-step]").forEach((button) => {
  button.addEventListener("click", () => goToStep(button.dataset.goStep));
});
renderUploadSelection();
renderExtractionSelection();
goToStep(1);
loadStatus();
