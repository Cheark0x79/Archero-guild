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
  editingTargetKey: null,
  sessionDate: null,
  importHistory: [],
  lastImport: null,
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

function activeSessionDate() {
  return state.sessionDate || localDate();
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
    "sync-roster", "add-target", "edit-target", "delete-target", "save-target",
    "load-demo", "refresh-history",
  ].forEach((id) => { $(id).disabled = busy; });
  document.querySelectorAll("[data-edit-field]").forEach((control) => { control.disabled = busy; });
  document.querySelectorAll(".delete-row, .add-missing-member, .link-member, .confirm-departure, .undo-departure").forEach((control) => { control.disabled = busy; });
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
    const visibleTargets = payload.targets.filter((target) => target.mode !== "remote" || target.configured);
    const previous = $("target").value;
    $("target").replaceChildren(...visibleTargets.map((target) => {
      const option = document.createElement("option");
      option.value = target.key;
      const destination = target.mode === "local"
        ? "clear/review only"
        : target.mode === "simulation" ? "no network" : target.url;
      option.textContent = `${target.label} · ${destination}`;
      return option;
    }));
    const selected = visibleTargets.find((target) => target.key === previous)
      ?? visibleTargets.find((target) => target.key === "local")
      ?? visibleTargets[0];
    if (selected) $("target").value = selected.key;
    renderRosterControls();
    updateTargetEditor();
    updateTargetControls();
    await loadDay();
  } catch (error) {
    $("service-label").textContent = "OCR unavailable";
    message(error.message, true);
  }
}

async function loadDay() {
  const captureDate = activeSessionDate();
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

async function loadDemoBatch() {
  if (state.batch && !window.confirm("Replace the current browser review with an isolated demonstration batch? Real OCR files will not be changed.")) return;
  setBusy(true);
  message("Loading deterministic Members + Boss demonstration data…");
  try {
    const payload = await request("/api/demo", {
      method: "POST",
      body: JSON.stringify({ date: activeSessionDate() }),
    });
    state.batch = payload.batch;
    state.corrections = { entries: [] };
    state.images = [];
    state.table = "members";
    $("target").value = "simulation";
    setCaptureDate(activeSessionDate());
    resetPreflight();
    renderBatch();
    goToStep(2);
    message("Demo loaded. You can review, check, confirm and simulate the export without OCR or network access.");
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
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
      : `Upload ${scopeLabel(workflowKind())} screenshots in the current capture step`;
  $("scan").disabled = state.busy || count === 0;
  $("scan-help").textContent = count
    ? `Validate this ${label} session to start local OCR. No destination is contacted.`
    : existingScope
      ? "Upload new screenshots in this capture step to replace its current extraction."
      : "Upload screenshots in the current capture step before extraction.";
}

function workflowKind(step = state.step) {
  return step === 3 || step === 4 ? "guild-boss" : "guild-members";
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
        date: activeSessionDate(),
        kind: $("upload-kind").value,
        files: encoded,
      }),
    });
    const captureDate = activeSessionDate();
    const kind = $("upload-kind").value;
    state.images = payload.files.map((file) => ({
      ...file,
      url: captureImageUrl(captureDate, kind, file.name),
    }));
    state.referenceImages = [...state.images];
    $("upload-files").value = "";
    await loadBatch().catch(() => clearBatchView());
    renderUploadSelection();
    renderExtractionSelection();
    renderReferenceOptions();
    message(`${payload.files.length} ${scopeLabel(kind)} screenshot(s) uploaded. Validate the local extraction below.`);
    document.querySelector('[data-step-panel="2"]').scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function resetCaptureSession() {
  const captureDate = activeSessionDate();
  const kind = workflowKind();
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
    await loadBatch().catch(() => clearBatchView());
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
    message("Select at least one screenshot in the current capture step before extraction.", true);
    goToStep(workflowKind() === "guild-boss" ? 3 : 1);
    return;
  }
  if (new Set(images.map((image) => image.kind)).size !== 1) {
    message("Extract Guild members and Guild boss as two separate batches.", true);
    goToStep(workflowKind() === "guild-boss" ? 3 : 1);
    return;
  }
  setBusy(true);
  state.table = images[0].kind === "guild-boss" ? "bosses" : "members";
  $("extraction-progress").hidden = false;
  $("scan").textContent = "Extracting…";
  message(`Running Tesseract locally on ${images.length} selected screenshot(s)…`);
  try {
    const payload = await request("/api/scan", {
      method: "POST",
      body: JSON.stringify({ date: activeSessionDate(), images }),
    });
    const rosterSource = payload.result?.rosterSource;
    const rosterMessage = rosterSource?.type === "database"
      ? ` IDs were matched against ${rosterSource.label}.`
      : rosterSource ? " The local fallback roster was used for ID matching." : "";
    message(`OCR extraction finished.${rosterMessage} Review this source, then process the other one before export.`);
    await loadBatch();
    goToStep(images[0].kind === "guild-boss" ? 4 : 2);
  } catch (error) {
    message(error.message, true);
  } finally {
    $("extraction-progress").hidden = true;
    $("scan").textContent = "Validate and extract";
    setBusy(false);
  }
}

async function loadBatch() {
  const payload = await request(`/api/batch?date=${encodeURIComponent(activeSessionDate())}`);
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
  $("review-members").disabled = true;
  $("review-boss").disabled = true;
  $("missing-members").hidden = true;
  $("missing-members-list").replaceChildren();
  if (!state.images.length) state.referenceImages = [];
  renderReferenceOptions();
  renderCorrections();
  updateSimulationMode();
  updateTargetControls();
  renderWorkflowProgress();
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
  if (state.table === "members" && !(batch.members || []).length && (batch.bossRankings || []).length) state.table = "bosses";
  if (state.table === "bosses" && !(batch.bossRankings || []).length && (batch.members || []).length) state.table = "members";
  const reviewRows = state.table === "bosses" ? batch.bossRankings || [] : batch.members || [];
  const incompleteRows = reviewRows.filter((row) => missingFields(row, state.table).length > 0).length;
  const duplicateIds = state.table === "members" ? duplicateValues(reviewRows, "playerId") : new Set();
  const duplicateRows = reviewRows.filter((row) => duplicateIds.has(row.playerId)).length;
  $("review-count").textContent = [
    `${reviewRows.length} row${reviewRows.length === 1 ? "" : "s"}`,
    incompleteRows ? `${incompleteRows} incomplete` : "",
    duplicateRows ? `${duplicateRows} duplicate IDs` : "",
  ].filter(Boolean).join(" · ");
  $("publish-scope").textContent = scope === "mixed" ? "Guild members + Guild boss · one atomic export" : `${scopeLabel(scope)} ready · add the other source`;
  $("quality-warnings").replaceChildren(...(quality.warnings || []).map((warning) => {
    const row = document.createElement("span");
    row.textContent = warning;
    return row;
  }));
  if (scope !== "mixed") state.table = scope === "guild-boss" ? "bosses" : "members";
  $("review-scope-label").textContent = state.table === "bosses" ? "Guild boss" : "Guild members";
  $("review-members").disabled = state.busy || !(batch.members || []).length;
  $("review-boss").disabled = state.busy || !(batch.bossRankings || []).length;
  state.referenceImages = batch.simulation ? [] : (batch.sourceImages || []).map((image) => ({
    kind: image.kind,
    name: image.sourceName,
    url: captureImageUrl(activeSessionDate(), image.kind, image.sourceName),
  }));
  renderReferenceOptions();
  renderTable();
  renderCorrections();
  updateSimulationMode();
  renderExtractionSelection();
  updateTargetControls();
  renderWorkflowProgress();
}

async function loadMissingMembers() {
  if (!state.batch || state.batch.simulation || state.table !== "members" || !(state.batch.members || []).length) {
    $("missing-members").hidden = true;
    $("missing-members-list").replaceChildren();
    return;
  }
  try {
    const payload = await request(`/api/missing-members?date=${encodeURIComponent(activeSessionDate())}`);
    const members = payload.members || [];
    const unlinkedRows = payload.unlinkedRows || [];
    const confirmedDepartures = payload.confirmedDepartures || [];
    $("missing-members").hidden = members.length === 0 && confirmedDepartures.length === 0;
    $("missing-members-title").textContent = members.length
      ? "Roster differences to review"
      : "Roster review complete";
    $("missing-members-count").textContent = [
      members.length ? `${members.length} to review` : "",
      confirmedDepartures.length ? `${confirmedDepartures.length} departure${confirmedDepartures.length === 1 ? "" : "s"} confirmed` : "",
    ].filter(Boolean).join(" · ") || "No difference";
    $("missing-members-source").textContent = payload.target
      ? `Compared with ${payload.target.label}. A confirmed departure does not block export.`
      : "";
    const pendingItems = members.map((member) => {
      const item = document.createElement("article");
      item.className = "missing-member";
      const identity = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = member.name;
      const id = document.createElement("small");
      id.textContent = member.playerId;
      identity.append(name, id);
      if (unlinkedRows.length) {
        const linkControls = document.createElement("div");
        linkControls.className = "identity-link-controls";
        const select = document.createElement("select");
        select.setAttribute("aria-label", `OCR row to link to ${member.name}`);
        select.replaceChildren(...unlinkedRows.map((row) => {
          const option = document.createElement("option");
          option.value = String(row.rowIndex);
          const staleId = row.stalePlayerId ? ` · old ID ${row.stalePlayerId}` : "";
          option.textContent = `${row.rawName || row.name || `Row ${row.rowIndex + 1}`} · ${row.powerText || "power unknown"}${staleId}`;
          return option;
        }));
        const link = document.createElement("button");
        link.type = "button";
        link.className = "button primary compact link-member";
        link.textContent = "Link this row";
        link.disabled = state.busy;
        link.addEventListener("click", () => linkReviewedMember(Number(select.value), member));
        linkControls.append(select, link);
        item.append(identity, linkControls);
      } else {
        const actions = document.createElement("div");
        actions.className = "missing-member-actions";
        const departure = document.createElement("button");
        departure.type = "button";
        departure.className = "button primary compact confirm-departure";
        departure.textContent = "Confirm departure";
        departure.disabled = state.busy;
        departure.addEventListener("click", () => setDepartureDecision(member, true));
        const add = document.createElement("button");
        add.type = "button";
        add.className = "button secondary compact add-missing-member";
        add.textContent = "Still a member: add row";
        add.disabled = state.busy;
        add.addEventListener("click", () => addReviewedRow(member));
        actions.append(departure, add);
        item.append(identity, actions);
      }
      return item;
    });
    const confirmedItems = confirmedDepartures.map((member) => {
      const item = document.createElement("article");
      item.className = "missing-member departure-confirmed";
      const identity = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = member.name;
      const status = document.createElement("small");
      status.textContent = `${member.playerId} · Departure confirmed for this import`;
      identity.append(name, status);
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "button secondary compact undo-departure";
      undo.textContent = "Undo";
      undo.disabled = state.busy;
      undo.addEventListener("click", () => setDepartureDecision(member, false));
      item.append(identity, undo);
      return item;
    });
    $("missing-members-list").replaceChildren(...pendingItems, ...confirmedItems);
  } catch (error) {
    $("missing-members").hidden = false;
    $("missing-members-count").textContent = "Check unavailable";
    $("missing-members-source").textContent = error.message;
    $("missing-members-list").replaceChildren();
  }
}

async function setDepartureDecision(member, confirmed) {
  if (confirmed && !window.confirm(
    `Confirm that ${member.name} (${member.playerId}) is no longer in the current guild? No OCR row will be added, and a complete export can mark this member as former.`,
  )) return;
  setBusy(true);
  message(confirmed ? `Confirming ${member.name} as a departure…` : `Restoring ${member.name} to roster review…`);
  try {
    const payload = await request("/api/missing-member-decision", {
      method: "POST",
      body: JSON.stringify({
        date: activeSessionDate(),
        simulation: false,
        playerId: member.playerId,
        confirmed,
      }),
    });
    state.corrections = payload.corrections;
    renderCorrections();
    await loadMissingMembers();
    message(confirmed
      ? `${member.name} confirmed as departed. This roster difference no longer requires a row and does not block export.`
      : `${member.name} returned to the roster review list.`);
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function linkReviewedMember(rowIndex, member) {
  const row = state.batch?.members?.[rowIndex];
  if (!row) {
    message("The selected OCR row no longer exists.", true);
    return;
  }
  const observed = row.rawName || row.name || `row ${rowIndex + 1}`;
  if (!window.confirm(`Link OCR row "${observed}" to ${member.name} (${member.playerId})? Its extracted statistics will be kept.`)) return;
  setBusy(true);
  message(`Linking ${observed} to ${member.name}…`);
  try {
    const payload = await request("/api/link-member", {
      method: "POST",
      body: JSON.stringify({
        date: activeSessionDate(),
        simulation: false,
        rowIndex,
        playerId: member.playerId,
      }),
    });
    state.batch = payload.batch;
    state.corrections = payload.corrections;
    renderBatch();
    await loadMissingMembers();
    const learning = payload.learnedAliases
      ? " The OCR spelling was remembered locally for future scans."
      : "";
    message(`${member.name} linked without creating a duplicate.${learning}`);
  } catch (error) {
    message(error.message, true);
    await loadBatch().catch(() => {});
  } finally {
    setBusy(false);
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
        date: activeSessionDate(),
        simulation: state.batch?.simulation === true,
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
        date: activeSessionDate(),
        simulation: state.batch?.simulation === true,
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
    if (!state.batch?.simulation) await loadBatch().catch(() => {});
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
        date: activeSessionDate(),
        simulation: state.batch?.simulation === true,
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
    if (!state.batch?.simulation) await loadBatch().catch(() => {});
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
        : entry.action === "link"
          ? `${entry.category} · linked identity`
        : entry.action === "departure"
          ? `${entry.category} · roster departure ${entry.confirmed ? "confirmed" : "undone"}`
      : `${entry.category} · ${entry.field}`;
    const source = document.createElement("small");
    source.textContent = entry.source || `row ${entry.rowIndex + 1}`;
    const change = document.createElement("div");
    const before = document.createElement("del");
    before.textContent = entry.action === "delete"
      ? deletedRowLabel(entry.before)
      : entry.action === "add" ? "Not present"
        : entry.action === "link" ? identityLabel(entry.before)
          : displayValue(entry.before);
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    const after = document.createElement("ins");
    after.textContent = entry.action === "delete"
      ? "Not published"
      : entry.action === "add" ? deletedRowLabel(entry.after)
        : entry.action === "link" ? identityLabel(entry.after)
          : displayValue(entry.after);
    change.append(before, arrow, after);
    item.append(title, source, change);
    return item;
  }));
}

function identityLabel(identity) {
  if (!identity || typeof identity !== "object") return "Unlinked";
  return [identity.name, identity.playerId].filter(Boolean).join(" · ") || "Unlinked";
}

function deletedRowLabel(row) {
  if (!row || typeof row !== "object") return "OCR row";
  return row.rawName || row.name || row.source || "OCR row";
}

async function clearExtractedData() {
  const captureDate = activeSessionDate();
  if (!state.batch) {
    message("There is no extracted JSON to clear.", true);
    return;
  }
  if (!window.confirm(`Clear the extracted JSON and correction history for ${captureDate}? Screenshots will be kept.`)) return;
  setBusy(true);
  try {
    await request("/api/clear", {
      method: "POST",
      body: JSON.stringify({ date: captureDate, simulation: state.batch?.simulation === true, confirmation: `CLEAR ${captureDate}` }),
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
  message("Destination checked. Exporting Members and Boss together…");
  try {
    const payload = await request("/api/publish", {
      method: "POST",
      body: JSON.stringify({
        date: $("capture-date").value,
        sessionDate: activeSessionDate(),
        target: $("target").value,
        confirmation: `PUBLISH ${$("target").value.toUpperCase()}`,
      }),
    });
    const label = scopeLabel(batchScope(state.batch));
    const imported = payload.result.import || {};
    const result = imported.result || {};
    state.lastImport = {
      id: imported.id,
      status: imported.status,
      replayed: imported.replayed === true,
      captureDate: payload.result.captureDate,
      targetLabel: selectedTarget()?.label || $("target").value,
      members: Number(result.members ?? state.batch?.members?.length ?? 0),
      bossRankings: Number(result.bossRankings ?? state.batch?.bossRankings?.length ?? 0),
    };
    renderPublishSuccess();
    message(imported.replayed ? `${label} batch was already present on the target.` : `${label} exported successfully in one transaction.`);
    resetPreflight();
    await loadImportHistory({ quiet: true });
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

function importFacts(item) {
  return [
    ["Data date", formatFrenchDate(item.captureDate)],
    ["Members", String(item.members ?? 0)],
    ["Boss rankings", String(item.bossRankings ?? 0)],
  ];
}

function renderFactGrid(container, facts) {
  container.replaceChildren(...facts.map(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("small");
    const detail = document.createElement("strong");
    term.textContent = label;
    detail.textContent = value;
    item.append(term, detail);
    return item;
  }));
}

function renderPublishSuccess() {
  const panel = $("publish-success");
  const item = state.lastImport;
  panel.hidden = !item;
  if (!item) return;
  $("publish-success-title").textContent = item.replayed
    ? `Already imported on ${item.targetLabel}`
    : `Published to ${item.targetLabel}`;
  $("publish-success-state").textContent = item.replayed ? "Already present" : "Published";
  renderFactGrid($("publish-success-details"), [
    ...importFacts(item),
    ["Import", item.id ? `#${item.id}` : item.status || "confirmed"],
  ]);
}

async function loadImportHistory({ quiet = false } = {}) {
  const target = selectedTarget();
  if (!target || !["remote", "simulation"].includes(target.mode) || !target.configured) {
    state.importHistory = [];
    renderImportHistory();
    if (!quiet) message("Choose a configured remote destination to view its history.", true);
    return;
  }
  $("history-help").textContent = `Loading ${target.label} history…`;
  try {
    const payload = await request(`/api/import-history?target=${encodeURIComponent(target.key)}`);
    state.importHistory = payload.history;
    renderImportHistory();
    if (!quiet) message(`${target.label} import history refreshed. No data was sent.`);
  } catch (error) {
    $("history-help").textContent = error.message;
    if (!quiet) message(error.message, true);
  }
}

function renderImportHistory() {
  const target = selectedTarget();
  const list = $("import-history");
  if (!target || !["remote", "simulation"].includes(target.mode) || !target.configured) {
    $("history-help").textContent = "Choose a configured remote destination, then refresh. Nothing is sent.";
    list.replaceChildren();
    return;
  }
  $("history-help").textContent = state.importHistory.length
    ? `Last ${state.importHistory.length} imports reported by ${target.label}.`
    : `No import is recorded on ${target.label}.`;
  list.replaceChildren(...state.importHistory.map((entry) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const heading = document.createElement("div");
    const title = document.createElement("strong");
    const status = document.createElement("span");
    title.textContent = formatFrenchDate(entry.captureDate);
    status.className = `badge ${entry.status === "published" ? "pass" : "review"}`;
    status.textContent = entry.status;
    heading.append(title, status);
    const details = document.createElement("div");
    details.className = "import-summary compact-summary";
    renderFactGrid(details, [
      ["Members", String(entry.members ?? 0)],
      ["Boss rankings", String(entry.bossRankings ?? 0)],
      ["Import", `#${entry.id}`],
    ]);
    item.append(heading, details);
    return item;
  }));
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
  renderWorkflowProgress();
}

async function checkDestination() {
  const target = selectedTarget();
  if (!target || !["remote", "simulation"].includes(target.mode) || !target.configured || !state.batch) {
    message("Choose a configured remote destination and a reviewed batch first.", true);
    return;
  }
  resetPreflight();
  setBusy(true);
  $("preflight-state").textContent = "Checking…";
  $("preflight-help").textContent = target.mode === "simulation"
    ? "Checking the batch locally without any network request…"
    : "Contacting the destination without importing data…";
  message(`Checking ${target.label} before publication…`);
  try {
    await request("/api/preflight", {
      method: "POST",
      body: JSON.stringify({
        date: $("capture-date").value,
        sessionDate: activeSessionDate(),
        target: target.key,
      }),
    });
    state.preflight = { key: preflightKey() };
    renderWorkflowProgress();
    $("preflight-state").textContent = "Ready to send";
    $("preflight-state").className = "badge pass";
    $("preflight-help").textContent = target.mode === "simulation"
      ? "Local simulation validation succeeded. No network request was made."
      : "Connectivity, authentication and batch validation succeeded. No data was imported.";
    message(`${target.label} check passed. You can now open the export confirmation.`);
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
  return "Members + Boss";
}

function selectedTarget() {
  return state.status?.targets?.find((target) => target.key === $("target").value);
}

function updateSimulationMode() {
  const active = state.batch?.simulation === true;
  $("simulation-banner").hidden = !active;
  [...$("target").options].forEach((option) => {
    option.disabled = active && option.value !== "simulation";
  });
  if (active && $("target").value !== "simulation") $("target").value = "simulation";
  $("load-demo").textContent = active ? "Reload demo batch" : "Load demo batch";
  updateTargetEditor();
}

function remoteTargets() {
  return (state.status?.targets || []).filter((target) => target.mode === "remote" && target.configured);
}

function renderRosterControls() {
  const previous = $("roster-source").value;
  const targets = remoteTargets();
  $("roster-source").replaceChildren(...targets.map((target) => {
    const option = document.createElement("option");
    option.value = target.key;
    option.textContent = `${target.label} · ${target.url}`;
    return option;
  }));
  if (targets.some((target) => target.key === previous)) $("roster-source").value = previous;
  const cache = state.status?.rosterCache;
  $("sync-roster").disabled = state.busy || targets.length === 0;
  $("roster-cache-state").textContent = cache?.configured ? `${cache.count} IDs cached` : "Not synchronized";
  $("roster-cache-state").className = `badge ${cache?.configured ? "pass" : "neutral"}`;
  if (cache?.configured) {
    const updated = cache.updatedAt ? new Date(cache.updatedAt).toLocaleString() : "unknown date";
    $("roster-cache-summary").textContent = `Last synchronized from ${cache.source?.label || "a remote application"} on ${updated}. Local OCR can reuse this cache offline.`;
  } else {
    $("roster-cache-summary").textContent = targets.length
      ? "No remote IDs have been cached. Choose a source and synchronize explicitly, or keep using the bundled local fallback."
      : "No remote destination is configured. Local OCR uses the bundled fallback and previously reviewed identities.";
  }
}

function updateTargetEditor() {
  const target = selectedTarget();
  if (!target) return;
  const local = target.mode === "local";
  const simulation = target.mode === "simulation";
  $("target-state").textContent = local ? "Local only" : simulation ? "No network" : target.configured ? "Ready" : "Needs configuration";
  $("target-state").className = `badge ${target.configured ? "pass" : "neutral"}`;
  $("target-summary").textContent = local
    ? "Local test keeps the reviewed JSON on this PC and never sends data."
    : simulation
      ? "Simulation reproduces validation, confirmation, success and history entirely on this PC."
    : target.configured
      ? `Configured endpoint: ${target.url}`
      : "This destination is not configured.";
  $("edit-target").disabled = state.busy || local || simulation;
  $("delete-target").disabled = state.busy || local || simulation;
  $("add-target").disabled = state.busy;
}

function slugifyTarget(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function openTargetForm(target = null) {
  state.editingTargetKey = target?.key || null;
  $("target-dialog").showModal();
  $("target-form-title").textContent = target ? `Edit ${target.label}` : "Add destination";
  $("target-label").value = target?.label || "";
  $("target-key").value = target?.key || "";
  $("target-key").disabled = Boolean(target);
  $("target-url").value = target?.url || "";
  $("target-token").value = "";
  $("target-token").required = !target;
  $("target-cf-id").value = "";
  $("target-cf-secret").value = "";
  $("target-cf-clear").checked = false;
  $("target-label").focus();
}

function closeTargetForm() {
  state.editingTargetKey = null;
  $("target-dialog").close();
  $("target-form").reset();
}

async function saveTarget(event) {
  event.preventDefault();
  const key = state.editingTargetKey || $("target-key").value.trim();
  setBusy(true);
  message("Saving the private destination…");
  try {
    await request("/api/targets", {
      method: "POST",
      body: JSON.stringify({
        key,
        label: $("target-label").value,
        url: $("target-url").value,
        ingestionToken: $("target-token").value,
        cfAccessClientId: $("target-cf-id").value,
        cfAccessClientSecret: $("target-cf-secret").value,
        clearCloudflareAccess: $("target-cf-clear").checked,
        createOnly: !state.editingTargetKey,
      }),
    });
    closeTargetForm();
    await loadStatus();
    $("target").value = key;
    updateTargetEditor();
    updateTargetControls();
    message("Destination saved locally. Its secret was not returned to the browser.");
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function deleteTarget() {
  const target = selectedTarget();
  if (!target || target.mode !== "remote") return;
  if (!window.confirm(`Delete the local destination “${target.label}”? OCR batches and captures are kept.`)) return;
  setBusy(true);
  try {
    await request("/api/targets/delete", { method: "POST", body: JSON.stringify({ key: target.key }) });
    closeTargetForm();
    await loadStatus();
    message(`Destination “${target.label}” deleted. OCR data was kept.`);
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function synchronizeRoster() {
  const target = remoteTargets().find((item) => item.key === $("roster-source").value);
  if (!target) return;
  setBusy(true);
  message(`Synchronizing player IDs from ${target.label}…`);
  try {
    const payload = await request("/api/roster/sync", {
      method: "POST",
      body: JSON.stringify({ target: target.key }),
    });
    state.status.rosterCache = payload.rosterCache;
    renderRosterControls();
    message(`${payload.rosterCache.count} player IDs cached locally. No OCR batch was published.`);
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
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
    $("publish").disabled = true;
    return;
  }
  if (target.mode === "simulation" && !state.batch?.simulation) {
    $("preflight").disabled = true;
    $("preflight-state").textContent = "Load demo first";
    $("preflight-state").className = "badge review";
    $("preflight-help").textContent = "Load the isolated demonstration batch before starting a simulation.";
    $("publish").disabled = true;
    return;
  }
  const duplicateMemberIds = duplicateValues(state.batch?.members || [], "playerId");
  const coverage = Number(state.batch?.quality?.coverage);
  const missingBoss = missingBossRanks(state.batch?.bossRankings || []);
  const blocker = !target.configured
    ? "Configure this destination from the local destination editor."
    : !state.batch
      ? "Complete OCR extraction and review before checking the destination."
    : batchScope(state.batch) !== "mixed"
      ? "Review both Guild members and Guild boss before exporting them together."
    : duplicateMemberIds.size
      ? `Resolve duplicate Player IDs: ${[...duplicateMemberIds].join(", ")}.`
    : Number.isFinite(coverage) && coverage < 1
      ? missingBoss.length
        ? `Boss rank${missingBoss.length === 1 ? "" : "s"} ${missingBoss.join(", ")} ${missingBoss.length === 1 ? "is" : "are"} missing. Review or add the missing Boss row before checking the destination.`
        : `Coverage is ${(coverage * 100).toFixed(1)}%. Review the incomplete OCR rows before checking the destination.`
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
  $("publish").disabled = state.busy || !target.publishable || !hasPublishableBatch || !hasValidPreflight;
}

function missingBossRanks(rows) {
  const ranks = rows
    .map((row) => row?.rank)
    .filter((rank) => Number.isInteger(rank) && rank > 0);
  const highest = Math.max(0, ...ranks);
  const present = new Set(ranks);
  return Array.from({ length: highest }, (_, index) => index + 1)
    .filter((rank) => !present.has(rank));
}

function isLocallyPublishableBatch(batch) {
  if (!batch || batchScope(batch) !== "mixed" || batch.quality?.coverage !== 1) return false;
  const scope = batchScope(batch);
  const members = batch.members || [];
  const bosses = batch.bossRankings || [];
  return scope === "mixed"
    && members.length > 0
    && duplicateValues(members, "playerId").size === 0
    && members.every((row) => Boolean(String(row.name || "").trim()))
    && bosses.length > 0
    && bosses.every((row) => missingFields(row, "bosses").length === 0);
}

function renderReferenceOptions() {
  const images = visibleReferenceImages();
  const previous = $("reference-image").value;
  $("reference-image").replaceChildren(...images.map((image) => {
    const option = document.createElement("option");
    option.value = image.url;
    option.textContent = image.name;
    return option;
  }));
  if (images.some((image) => image.url === previous)) $("reference-image").value = previous;
  renderReferenceImage();
}

function renderReferenceImage() {
  const images = visibleReferenceImages();
  const selectedIndex = images.findIndex((image) => image.url === $("reference-image").value);
  const selected = selectedIndex >= 0 ? images[selectedIndex] : null;
  $("reference-preview").hidden = !selected;
  $("reference-empty").hidden = Boolean(selected);
  $("reference-position").textContent = selected
    ? `${selectedIndex + 1} / ${images.length}`
    : `0 / ${images.length}`;
  $("reference-previous").disabled = state.busy || selectedIndex <= 0;
  $("reference-next").disabled = state.busy || selectedIndex < 0 || selectedIndex >= images.length - 1;
  if (selected) {
    $("reference-preview").src = selected.url;
    $("reference-preview").alt = `${selected.kind} ${selected.name}`;
  } else {
    $("reference-preview").removeAttribute("src");
  }
}

function moveReferenceImage(offset) {
  const images = visibleReferenceImages();
  const current = images.findIndex((image) => image.url === $("reference-image").value);
  const next = Math.max(0, Math.min(images.length - 1, current + offset));
  if (current < 0 || next === current) return;
  $("reference-image").value = images[next].url;
  renderReferenceImage();
}

function visibleReferenceImages() {
  const kind = state.table === "members" ? "guild-members" : "guild-boss";
  return state.referenceImages.filter((image) => image.kind === kind);
}

function selectReferenceForTable() {
  renderReferenceOptions();
}

function goToStep(step) {
  const next = Math.max(1, Math.min(5, Number(step) || 1));
  state.step = next;
  const visiblePanels = next === 1 || next === 3
    ? new Set([1, 2])
    : next === 2 || next === 4 ? new Set([3]) : new Set([4]);
  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    panel.classList.toggle("active", visiblePanels.has(Number(panel.dataset.stepPanel)));
  });
  document.querySelectorAll("[data-go-step]").forEach((button) => {
    const active = Number(button.dataset.goStep) === next;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  if (next === 1 || next === 3) {
    const kind = workflowKind(next);
    $("upload-kind").value = kind;
    const members = kind === "guild-members";
    $("capture-step-label").textContent = members ? "STEP 01 · MEMBERS" : "STEP 03 · BOSS";
    $("capture-title").textContent = members ? "Add Guild member screenshots" : "Add Guild boss screenshots";
    $("capture-scope").textContent = members ? "Guild members" : "Guild boss";
    $("capture-order-help").textContent = members
      ? "Extract and review these rows before moving to Guild boss."
      : "The reviewed member rows stay saved while you process the boss screenshots.";
    $("extract-step-label").textContent = members ? "STEP 01 · LOCAL EXTRACTION" : "STEP 03 · LOCAL EXTRACTION";
    $("extract-title").textContent = members ? "Extract Guild members locally" : "Extract Guild boss locally";
    if (selectedImageKind() !== kind) {
      $("upload-files").value = "";
      state.images = [];
    }
    renderUploadSelection();
    renderExtractionSelection();
  }
  $("reset-session").hidden = next === 5;
  $("reset-session").textContent = workflowKind(next) === "guild-boss" ? "Clear Boss…" : "Clear Members…";
  if (next === 2 || next === 4) {
    state.table = next === 2 ? "members" : "bosses";
    $("review-step-label").textContent = next === 2 ? "STEP 02 · REVIEW MEMBERS" : "STEP 04 · REVIEW BOSS";
    $("review-title").textContent = next === 2 ? "Review and correct Guild members" : "Review and correct Guild boss";
    if (state.batch) {
      renderBatch();
      loadMissingMembers();
    }
    selectReferenceForTable();
  }
  renderWorkflowProgress();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderWorkflowProgress() {
  const kinds = new Set((state.batch?.sourceImages || []).map((image) => image.kind));
  const completed = new Set();
  if (kinds.has("guild-members")) completed.add(1);
  if ((state.batch?.members || []).length) completed.add(2);
  if (kinds.has("guild-boss")) completed.add(3);
  if ((state.batch?.bossRankings || []).length) completed.add(4);
  if (state.preflight?.key === preflightKey()) completed.add(5);
  document.querySelectorAll("[data-go-step]").forEach((button) => {
    button.classList.toggle("complete", completed.has(Number(button.dataset.goStep)));
  });
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function percent(value) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

setCaptureDate(localDate());
state.sessionDate = localStorage.getItem("archero-ocr-session-date") || localDate();
localStorage.setItem("archero-ocr-session-date", state.sessionDate);
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
  resetPreflight();
  updateTargetControls();
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
  state.importHistory = [];
  renderImportHistory();
  updateTargetEditor();
  updateTargetControls();
});
$("target-label").addEventListener("input", () => {
  if (!state.editingTargetKey) $("target-key").value = slugifyTarget($("target-label").value);
});
$("add-target").addEventListener("click", () => openTargetForm());
$("edit-target").addEventListener("click", () => openTargetForm(selectedTarget()));
$("delete-target").addEventListener("click", deleteTarget);
$("cancel-target").addEventListener("click", closeTargetForm);
$("target-form").addEventListener("submit", saveTarget);
$("sync-roster").addEventListener("click", synchronizeRoster);
$("reference-image").addEventListener("change", renderReferenceImage);
$("reference-previous").addEventListener("click", () => moveReferenceImage(-1));
$("reference-next").addEventListener("click", () => moveReferenceImage(1));
$("upload").addEventListener("click", uploadImages);
$("load-demo").addEventListener("click", loadDemoBatch);
$("reset-session").addEventListener("click", resetCaptureSession);
$("scan").addEventListener("click", runScan);
$("clear").addEventListener("click", clearExtractedData);
$("publish").addEventListener("click", () => {
  const target = selectedTarget();
  const date = formatFrenchDate($("capture-date").value);
  const members = state.batch?.members?.length ?? 0;
  const bosses = state.batch?.bossRankings?.length ?? 0;
  $("export-confirmation-summary").textContent = `Export to “${target?.label || "destination"}”?`;
  renderFactGrid($("export-confirmation-details"), [
    ["DATA DATE", date],
    ["Members", String(members)],
    ["Boss rankings", String(bosses)],
  ]);
  $("confirm-export-date-label").textContent = `I confirm the data date ${date}.`;
  $("confirm-export-date").checked = false;
  $("confirm-export").disabled = true;
  $("export-dialog").showModal();
});
$("confirm-export-date").addEventListener("change", () => {
  $("confirm-export").disabled = !$("confirm-export-date").checked;
});
$("confirm-export").addEventListener("click", async (event) => {
  event.preventDefault();
  $("export-dialog").close();
  await publishBatch();
});
$("preflight").addEventListener("click", checkDestination);
$("refresh-history").addEventListener("click", () => loadImportHistory());
$("add-row").addEventListener("click", () => addReviewedRow());
$("review-members").addEventListener("click", () => {
  state.table = "members";
  renderBatch();
  loadMissingMembers();
});
$("review-boss").addEventListener("click", () => {
  state.table = "bosses";
  renderBatch();
  loadMissingMembers();
});
document.querySelectorAll("[data-go-step]").forEach((button) => {
  button.addEventListener("click", () => goToStep(button.dataset.goStep));
});
renderUploadSelection();
renderExtractionSelection();
goToStep(1);
loadStatus();
