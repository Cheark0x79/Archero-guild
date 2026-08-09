"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultRules as bundledDefaultRules } from "../../default-rules.js";
import {
  activityLabel,
  buildSummary,
  dateOnly,
  defaultSortDirection,
  evaluateMember,
  filterMembers,
  formatBossDamageText,
  formatCompact,
  formatNumber,
  formatPowerDetail,
  mergeRosterMetrics,
  newMemberDay,
  sortMembers,
} from "../../metrics.js";
import { acceptedSnapshotDates, latestDataDate, localIsoDate } from "../../date.js";
import { bossDefinitionForDate, bossDefinitionForSnapshot } from "../../lib/boss-identity.js";
import { evaluateWarningHistory, warningHistoryEvents } from "../../warning-history.js";
import AppSidebar from "./AppSidebar.jsx";

const RULES_STORAGE_KEY = "archero-observer-rules";
let captures = {};
let changes = [];
let dailyBossRawSnapshots = [];
let dailyRawSnapshots = [];
let guildRoster = [];
let memberSnapshots = [];
let previousMemberSnapshots = [];
let defaultRules = bundledDefaultRules;
let identityLinks = [];
let members = buildCurrentMembers();
let dashboardDataCache = null;
let dashboardDataCachedAt = 0;
let dashboardDataPromise = null;
const DASHBOARD_DATA_CACHE_MS = 15_000;

function loadDashboardData({ force = false } = {}) {
  const now = Date.now();
  if (!force && dashboardDataCache && now - dashboardDataCachedAt < DASHBOARD_DATA_CACHE_MS) {
    return Promise.resolve(dashboardDataCache);
  }
  if (dashboardDataPromise) return dashboardDataPromise;
  dashboardDataPromise = fetch("/api/dashboard-data", { cache: "no-store" })
    .then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? `Dashboard data returned HTTP ${response.status}.`);
      return payload;
    })
    .then((payload) => {
      if (payload?.data) {
        dashboardDataCache = payload;
        dashboardDataCachedAt = Date.now();
      }
      return payload;
    })
    .finally(() => {
      dashboardDataPromise = null;
    });
  return dashboardDataPromise;
}

function applyDashboardData(data) {
  captures = objectOrDefault(data.captures, {});
  changes = arrayOrDefault(data.changes, []);
  dailyBossRawSnapshots = arrayOrDefault(data.dailyBossRawSnapshots, []);
  dailyRawSnapshots = arrayOrDefault(data.dailyRawSnapshots, []);
  guildRoster = arrayOrDefault(data.guildRoster, []);
  memberSnapshots = arrayOrDefault(data.memberSnapshots, []);
  previousMemberSnapshots = arrayOrDefault(data.previousMemberSnapshots, []);
  identityLinks = arrayOrDefault(data.identityLinks, []);
  defaultRules = { ...bundledDefaultRules, ...(data.rules && typeof data.rules === "object" ? data.rules : {}) };
  members = buildCurrentMembers();
}

function arrayOrDefault(value, fallback) {
  return Array.isArray(value) ? value : fallback;
}

function objectOrDefault(value, fallback) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...fallback, ...value } : fallback;
}

function buildCurrentMembers() {
  const latestDay = [...dailyRawSnapshots].sort((left, right) => left.date.localeCompare(right.date)).at(-1);
  const linkedSnapshots = (latestDay?.rows ?? [])
    .filter((snapshot) => !snapshot.playerId && identityPlayerIdForName(snapshotObservedName(snapshot)))
    .map((snapshot) => ({
      ...snapshot,
      name: snapshotObservedName(snapshot),
      playerId: identityPlayerIdForName(snapshotObservedName(snapshot)),
      metricsCaptured: true,
      metricsVerified: true,
    }));
  const knownRosterIds = new Set(guildRoster.map((entry) => entry.playerId).filter(Boolean));
  const linkedRosterEntries = identityLinks
    .filter((link) => link.playerId && !knownRosterIds.has(link.playerId))
    .map((link) => ({
      playerId: link.playerId,
      name: link.observedName,
      status: "active",
      joinedAt: null,
      identitySource: "manual",
    }));
  const snapshotsById = new Map(memberSnapshots.filter((snapshot) => snapshot.playerId).map((snapshot) => [snapshot.playerId, snapshot]));
  for (const snapshot of linkedSnapshots) snapshotsById.set(snapshot.playerId, snapshot);
  const statusById = new Map(
    identityLinks
      .filter((link) => link.playerId && link.status)
      .map((link) => [link.playerId, link.status]),
  );
  const rosterWithOverrides = [...guildRoster, ...linkedRosterEntries].map((entry) => ({
    ...entry,
    status: statusById.get(entry.playerId) ?? entry.status,
  }));
  const rosterMembers = mergeRosterMetrics(rosterWithOverrides, [...snapshotsById.values()]);
  if (!latestDay) return rosterMembers;

  const rosterNames = new Set(rosterMembers.map((member) => normalizedMemberName(member.name)));
  const unresolvedMembers = (latestDay.rows ?? [])
    .filter(
      (snapshot) =>
        !snapshot.playerId
        && snapshotObservedName(snapshot)
        && !identityPlayerIdForName(snapshotObservedName(snapshot))
        && !rosterNames.has(normalizedMemberName(snapshotObservedName(snapshot))),
    )
    .map((snapshot, index) => {
      const observedName = snapshotObservedName(snapshot);
      return {
        rowId: `unresolved-${latestDay.date}-${index}-${normalizedMemberName(observedName)}`,
        playerId: null,
        name: observedName,
        previousNames: [],
        discord: "",
        discordName: observedName,
        discordLinked: false,
        searchAliases: [],
        role: snapshot.role ?? "member",
        joinedAt: null,
        leftAt: null,
        status: "active",
        absenceUntil: null,
        absenceReason: "",
        warnings: [],
        officerNote: "",
        power: snapshot.power ?? null,
        power7d: null,
        power14dPercent: null,
        contributionToday: null,
        contribution7d: snapshot.contribution7d ?? null,
        contributionDelta: null,
        contributionTotal: null,
        bossDamageToday: snapshot.bossDamageToday ?? null,
        bossDamageTotal: null,
        bossRank: null,
        bossAttacks: snapshot.bossAttacks ?? null,
        bossAttacksDelta: null,
        powerDelta: null,
        previousSnapshot: null,
        lastSeenAt: latestDay.date,
        lastActivityDays: snapshot.lastActivityDays ?? null,
        activityText: snapshot.activityText ?? null,
        metricsCaptured: true,
        metricsVerified: true,
        verificationNote: snapshot.verificationNote ?? "",
      };
    });

  return [...rosterMembers, ...unresolvedMembers];
}

function identityPlayerIdForName(name) {
  const normalized = normalizedMemberName(name);
  return identityLinks.find((link) => link.normalizedName === normalized)?.playerId ?? null;
}

function snapshotObservedName(snapshot) {
  return snapshot?.detectedName || snapshot?.name || "";
}

function normalizedMemberName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US");
}

const BOSS_ROTATION = [
  { key: "treant-guardian", weekday: 1, dayLabel: "Mon", name: "Treant Guardian", icon: "TG", image: "/bosses/treant-guardian.png", stats: { atk: 200, def: 200, spd: 10 } },
  { key: "fire-dragon", weekday: 2, dayLabel: "Tue", name: "Fire Dragon", icon: "FD", image: "/bosses/fire-dragon.png", stats: { atk: 180, def: 200, spd: 10 } },
  { key: "flame-demon", weekday: 3, dayLabel: "Wed", name: "Flame Demon", icon: "FL", image: "/bosses/flame-demon.png", stats: { atk: 250, def: 200, spd: 10 } },
  { key: "medusa", weekday: 4, dayLabel: "Thu", name: "Medusa", icon: "ME", image: "/bosses/medusa.png", stats: { atk: 170, def: 200, spd: 10 } },
  { key: "stoneman", weekday: 5, dayLabel: "Fri", name: "Stoneman", icon: "ST", image: "/bosses/stoneman.png", stats: { atk: 160, def: 200, spd: 10 } },
  { key: "cyclops-mage", weekday: 6, dayLabel: "Sat", name: "Cyclops Mage", icon: "CM", image: "/bosses/cyclops-mage.png", stats: { atk: 225, def: 200, spd: 10 } },
  { key: "grim-reaper", weekday: 0, dayLabel: "Sun", name: "Grim Reaper", icon: "GR", image: "/bosses/grim-reaper.png", stats: { atk: 300, def: 200, spd: 10 } },
];

const routeMeta = {
  dashboard: ["Dashboard", "Operational view of guild checks, boss damage, and alerts."],
  members: ["Members", "Search, status, and individual progression."],
  boss: ["Boss", "Guild boss damage comparison, daily rankings, and records."],
  data: ["Data", "Manual ADB screenshots and imports for the current capture workflow."],
  admin: ["Admin", "Operational tools and local rules."],
  test: ["Test", "Synthetic fixtures and isolated environment controls."],
  member: ["Member detail", "History, progression, boss activity, notes, and alerts."],
  rankings: ["Records", "Quick rankings from current data."],
  activity: ["Member activity", "Review roster events, absences, and warnings."],
  settings: ["Rules", "Local thresholds before backend wiring."],
};

export default function DashboardApp({ initialRoute = "dashboard", memberKeyParam = null, initialSessionRole = null }) {
  const [sessionRole, setSessionRole] = useState(initialSessionRole);
  const [rules, setRules] = useStoredRules();
  const [dataVersion, setDataVersion] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataWarning, setDataWarning] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState({ key: null, direction: "asc" });
  const [detailRanges, setDetailRanges] = useState({ progression: "1w", mi: "1w", donation: "1w" });
  const [warningActions, setWarningActions] = useState({});

  useEffect(() => {
    let cancelled = false;
    setDataLoading(true);
    loadDashboardData({ force: true })
      .then((payload) => {
        if (cancelled || !payload?.data) return;
        applyDashboardData(payload.data);
        setWarningActions(payload.data.warningActions ?? {});
        setDataWarning(payload.warning ?? "");
        if (!window.localStorage.getItem(RULES_STORAGE_KEY)) {
          setRules(normalizeRules({ ...defaultRules, currentDate: currentImportDate() }));
        }
        setDataVersion((version) => version + 1);
        setDataLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        applyDashboardData({
          captures: {},
          changes: [],
          dailyBossRawSnapshots: [],
          dailyRawSnapshots: [],
          guildRoster: [],
          memberSnapshots: [],
          previousMemberSnapshots: [],
          identityLinks: [],
        });
        setDataWarning(error instanceof Error ? error.message : "Dashboard data is unavailable.");
        setDataVersion((version) => version + 1);
        setDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialRoute]);

  useEffect(() => {
    if (initialSessionRole) return undefined;
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled) setSessionRole(payload?.role ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialSessionRole]);

  const activeRoute = initialRoute === "member" ? "member" : routeMeta[initialRoute] ? initialRoute : "dashboard";
  const selectedMemberCandidate = activeRoute === "member" ? findMemberByKey(memberKeyParam) : null;
  const selectedMember = selectedMemberCandidate;
  const [title, subtitle] = routeMeta[activeRoute];

  async function updateWarningAction(event, nextAction) {
    const response = await fetch("/api/warning-actions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: event.playerId,
        date: event.date,
        type: event.type,
        status: nextAction.status,
        note: nextAction.note ?? "",
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Unable to save warning status.");
    setWarningActions((current) => ({
      ...current,
      [automaticWarningKey(event.playerId, event.date, event.type)]: payload.action,
    }));
    return payload.action;
  }

  return (
    <div className="app-shell">
      <AppSidebar
        activeRoute={activeRoute}
        sessionRole={sessionRole}
        guildName={captures.guildName || "Archero Guild"}
        checkpointValue={formatDateTime(captures.lastCapturedAt ?? captures.lastImportedAt)}
      />
      <main className="main" data-version={dataVersion}>
        <header className="topbar">
          <div>
            <h1>{selectedMember?.name ?? title}</h1>
            <p>
              {selectedMember
                ? `${selectedMember.playerId ?? "Missing ID"} · ${roleLabel(selectedMember.role)} · ${activityLabel(selectedMember.lastActivityDays, selectedMember.activityText)}`
                : subtitle}
            </p>
          </div>
          <div className="topbar-meta" aria-label="Last update">
            <span>Last update</span>
            <strong>{formatDateTime(captures.lastCapturedAt ?? captures.lastImportedAt)}</strong>
          </div>
        </header>
        {dataWarning ? (
          <div className="data-warning" role="status">
            <strong>Data source warning</strong>
            <span>{dataWarning}</span>
          </div>
        ) : null}
        {dataLoading ? (
          <section className="panel">
            <PanelHeading title="Loading current data" subtitle="Fetching the latest validated guild snapshot." />
          </section>
        ) : null}

        {!dataLoading && activeRoute === "dashboard" && <Dashboard rules={rules} />}
        {!dataLoading && activeRoute === "members" && (
          <MembersView query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} sort={sort} setSort={setSort} rules={rules} />
        )}
        {!dataLoading && activeRoute === "boss" && <BossView />}
        {!dataLoading && activeRoute === "data" && <DataView />}
        {!dataLoading && activeRoute === "admin" && <AdminView dataVersion={dataVersion} />}
        {!dataLoading && activeRoute === "test" && <TestEnvironmentView />}
        {!dataLoading && activeRoute === "member" && selectedMember && (
          <MemberDetail
            member={selectedMember}
            rules={rules}
            ranges={detailRanges}
            setRanges={setDetailRanges}
            sessionRole={sessionRole}
            warningActions={warningActions}
            updateWarningAction={updateWarningAction}
          />
        )}
        {!dataLoading && activeRoute === "member" && !selectedMember && (
          <section className="panel">
            <PanelHeading title="Member not found" subtitle="This member URL does not match the current roster data." />
            <a className="secondary-button" href="/members">
              Back to members
            </a>
          </section>
        )}
        {!dataLoading && activeRoute === "rankings" && <Rankings />}
        {!dataLoading && activeRoute === "activity" && (
          <HistoryView
            rules={rules}
            sessionRole={sessionRole}
            warningActions={warningActions}
            updateWarningAction={updateWarningAction}
          />
        )}
        {!dataLoading && activeRoute === "settings" && <RulesView rules={rules} setRules={setRules} />}
      </main>
    </div>
  );
}

function DataView() {
  const [busyAction, setBusyAction] = useState(null);
  const [importDate, setImportDate] = useState(todayLabel());
  const [messages, setMessages] = useState([]);
  const [bossAudit, setBossAudit] = useState({ loading: true, audit: null, dataAvailable: false, error: null });
  const [adbStatus, setAdbStatus] = useState({ checking: true, connected: false, devices: [], error: null });
  const [captureDialog, setCaptureDialog] = useState(null);
  const [syncSteps, setSyncSteps] = useState(() => buildSyncSteps());
  const [importJob, setImportJob] = useState(null);
  const [importHistory, setImportHistory] = useState([]);
  const reportedImportJobs = useRef(new Set());
  const importRunning = importJob && ["queued", "running"].includes(importJob.status);

  useEffect(() => {
    refreshBossAudit();
    refreshAdbStatus();
    refreshImportJobStatus();
  }, []);

  useEffect(() => {
    if (!importRunning) return undefined;
    const timer = window.setInterval(() => refreshImportJobStatus(importJob.id), 5_000);
    return () => window.clearInterval(timer);
  }, [importRunning, importJob?.id]);

  async function refreshAdbStatus() {
    setAdbStatus((current) => ({ ...current, checking: true }));
    try {
      const response = await fetch("/api/data/status", { headers: dataActionHeaders() });
      const payload = await response.json().catch(() => ({}));
      setAdbStatus({
        checking: false,
        connected: Boolean(payload.adb?.connected),
        devices: payload.adb?.devices ?? [],
        error: payload.adb?.error ?? null,
      });
    } catch (error) {
      setAdbStatus({
        checking: false,
        connected: false,
        devices: [],
        error: error instanceof Error ? error.message : "ADB status unavailable",
      });
    }
  }

  async function refreshBossAudit() {
    setBossAudit((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch("/api/data/boss-history-audit", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.audit) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setBossAudit({ loading: false, audit: payload.audit, dataAvailable: payload.dataAvailable !== false, error: null });
    } catch (error) {
      setBossAudit({ loading: false, audit: null, dataAvailable: false, error: error instanceof Error ? error.message : "Boss history audit unavailable" });
    }
  }

  function openCapture(kind) {
    setCaptureDialog({ kind, phase: "confirm", result: null, error: null });
  }

  async function confirmCapture() {
    if (!captureDialog) return;
    const action = `capture:${captureDialog.kind}`;
    setBusyAction(action);
    setCaptureDialog((current) => ({ ...current, phase: "capturing", error: null }));
    try {
      const response = await fetch(`/api/data/capture/${captureDialog.kind}`, { method: "POST", headers: dataActionHeaders() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        setCaptureDialog((current) => ({ ...current, phase: "error", error: payload.error ?? `HTTP ${response.status}` }));
        return;
      }
      setCaptureDialog((current) => ({ ...current, phase: "review", result: payload.capture }));
    } catch (error) {
      setCaptureDialog((current) => ({
        ...current,
        phase: "error",
        error: error instanceof Error ? error.message : "Unexpected browser error",
      }));
    } finally {
      setBusyAction(null);
      refreshAdbStatus();
    }
  }

  function validateCapture() {
    if (!captureDialog?.result) return;
    addDataMessage(setMessages, dataSuccessMessage(`capture:${captureDialog.kind}`, { capture: captureDialog.result }));
    setCaptureDialog(null);
  }

  async function rejectCapture() {
    if (!captureDialog?.result) {
      setCaptureDialog(null);
      return;
    }
    const action = `capture:${captureDialog.kind}`;
    setBusyAction("discard");
    try {
      const response = await fetch("/api/data/discard", {
        method: "POST",
        headers: dataActionHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ path: captureDialog.result.path }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        setCaptureDialog((current) => ({ ...current, phase: "error", error: payload.error ?? `HTTP ${response.status}` }));
        return;
      }
      addDataMessage(setMessages, {
        action,
        status: "warning",
        title: `${dataActionLabel(action)} discarded`,
        detail: `${captureDialog.result.path} was moved to the recoverable screenshot trash.`,
      });
      setCaptureDialog(null);
    } catch (error) {
      setCaptureDialog((current) => ({
        ...current,
        phase: "error",
        error: error instanceof Error ? error.message : "Unexpected browser error",
      }));
    } finally {
      setBusyAction(null);
    }
  }

  async function importDay() {
    const date = importDate.trim();
    setSyncSteps(importJobToSteps({ status: "queued", stepIndex: 0, detail: "Starting import job." }));
    setBusyAction("import-start");
    try {
      const response = await fetch("/api/data/import", {
        method: "POST",
        headers: dataActionHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(date ? { date } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        setSyncSteps(markSyncStep(buildSyncSteps(), 0, "error"));
        addDataMessage(setMessages, {
          action: "import",
          status: "error",
          title: "Synchronize did not start",
          detail: payload.error ?? `HTTP ${response.status}`,
        });
        return;
      }
      setImportJob(payload.job);
      setSyncSteps(importJobToSteps(payload.job));
      addDataMessage(setMessages, {
        action: "import",
        status: payload.alreadyRunning ? "warning" : "success",
        title: payload.alreadyRunning ? "Synchronize already running" : "Synchronize started",
        detail: importJobDetail(payload.job),
      });
      refreshImportJobStatus(payload.job.id);
    } catch (error) {
      setSyncSteps(markSyncStep(buildSyncSteps(), 0, "error"));
      addDataMessage(setMessages, {
        action: "import",
        status: "error",
        title: "Synchronize did not start",
        detail: error instanceof Error ? error.message : "Unexpected browser error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function refreshImportJobStatus(id = null) {
    const suffix = id ? `?id=${encodeURIComponent(id)}` : "";
    try {
      const response = await fetch(`/api/data/import/status${suffix}`, { headers: dataActionHeaders() });
      const payload = await response.json().catch(() => ({}));
      setImportHistory(payload.jobs ?? []);
      if (!response.ok || payload.ok === false || !payload.job) return;
      setImportJob(payload.job);
      setSyncSteps(importJobToSteps(payload.job));
      if (["succeeded", "failed"].includes(payload.job.status) && !reportedImportJobs.current.has(payload.job.id)) {
        reportedImportJobs.current.add(payload.job.id);
        addDataMessage(
          setMessages,
          payload.job.status === "succeeded"
            ? dataSuccessMessage("import", { import: payload.job.result })
            : {
                action: "import",
                status: "error",
                title: "Synchronize failed",
                detail: payload.job.error ?? "Import stopped without an error message.",
              },
        );
      }
    } catch {
      // Keep the last known job state; the next poll can recover.
    }
  }

  return (
    <div className="data-page">
      <section className="panel data-status-panel">
        <PanelHeading
          title="Boss history audit"
          subtitle="Read-only verification of result dates, exported boss identities, and personal records."
          action={
            <button className="secondary-button compact-action" type="button" onClick={refreshBossAudit} disabled={bossAudit.loading}>
              {bossAudit.loading ? "Checking..." : "Refresh"}
            </button>
          }
        />
        {bossAudit.error ? <p className="muted">Audit unavailable: {bossAudit.error}</p> : null}
        {bossAudit.audit ? (
          <>
            <div className="data-status-row">
              <StatusPill
                label={!bossAudit.dataAvailable ? "No live data" : bossAudit.audit.summary.issues === 0 ? "Aligned" : `${bossAudit.audit.summary.issues} issue${bossAudit.audit.summary.issues === 1 ? "" : "s"}`}
                severity={bossAudit.dataAvailable && bossAudit.audit.summary.issues === 0 ? "positive" : "warning"}
              />
              <span className="muted">
                {!bossAudit.dataAvailable ? "Rotation available, but no database export could be audited." : `${bossAudit.audit.summary.daysChecked} days · ${bossAudit.audit.summary.rowsChecked} results · ${bossAudit.audit.summary.personalBestsAffected} PB affected`}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Day</th><th>Expected boss</th><th>Exported boss</th><th>Impact</th><th>Suggested date</th></tr></thead>
                <tbody>
                  {bossAudit.audit.issues.length ? bossAudit.audit.issues.map((issue, index) => (
                    <tr key={`${issue.type}-${issue.date ?? "unknown"}-${index}`}>
                      <td>{issue.date ?? "Invalid date"}</td>
                      <td>{issue.expectedBoss?.name ?? "Unknown"}</td>
                      <td>{issue.actualBoss?.name ?? issue.bossKeys?.join(", ") ?? "Missing"}</td>
                      <td>{bossAuditIssueLabel(issue)}</td>
                      <td>{issue.suggestedPreviousDate ?? "—"}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5">No date/boss inconsistency detected in the current export.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted">Rotation: {bossAudit.audit.rotation.map((boss) => `${boss.dayLabel} ${boss.name}`).join(" · ")}</p>
          </>
        ) : null}
      </section>

      <section className={`panel data-status-panel ${adbStatus.connected ? "connected" : "disconnected"}`}>
        <PanelHeading
          title="ADB"
          subtitle={adbStatus.checking ? "Checking device connection." : adbStatus.connected ? "Ready for manual screenshots." : "No ready ADB device detected."}
          action={
            <button className="secondary-button compact-action" type="button" onClick={refreshAdbStatus}>
              Refresh
            </button>
          }
        />
        <div className="data-status-row">
          <StatusPill label={adbStatus.connected ? "Connected" : adbStatus.checking ? "Checking" : "Disconnected"} severity={adbStatus.connected ? "positive" : "warning"} />
          <span className="muted">{adbStatus.devices.length > 0 ? adbStatus.devices.map((device) => `${device.serial} ${device.state}`).join(" · ") : adbStatus.error ?? "No device listed"}</span>
        </div>
      </section>

      <section className="panel data-command-panel">
        <PanelHeading title="BlueStacks screenshot" subtitle="Capture only: no OCR, import, or database write runs until you request synchronization." />
        <div className="data-command-grid">
          <DataActionButton
            title="Guild members"
            detail="Current guild member list screen."
            disabled={busyAction !== null}
            onClick={() => openCapture("guild-members")}
          />
          <DataActionButton
            title="Guild boss"
            detail="Current boss ranking screen."
            disabled={busyAction !== null}
            onClick={() => openCapture("guild-boss")}
          />
        </div>
      </section>

      <section className="panel data-import-panel">
        <PanelHeading title="Synchronize data" subtitle="Runs OCR/import on the server. The job continues if this page is reloaded." />
        <div className="data-import-row">
          <label className="data-date-field">
            <span>Capture date</span>
            <input value={importDate} onChange={(event) => setImportDate(event.target.value)} placeholder="YYYY-MM-DD" inputMode="numeric" />
          </label>
          <button className="primary-button" type="button" disabled={busyAction === "import-start" || importRunning} onClick={importDay}>
            {busyAction === "import-start" ? "Starting..." : importRunning ? "Synchronizing..." : "Synchronize"}
          </button>
          <button className="secondary-button" type="button" disabled={busyAction === "import-start"} onClick={() => refreshImportJobStatus(importJob?.id)}>
            Refresh status
          </button>
        </div>
        <SyncSteps steps={syncSteps} />
        {importJob ? (
          <div className={`sync-job-card ${importJob.status}`}>
            <div>
              <strong>{importJob.status === "failed" ? "Import failed" : importJob.status === "succeeded" ? "Import complete" : "Import running"}</strong>
              <span>{importJobDetail(importJob)}</span>
            </div>
            <meter min="0" max="100" value={importJob.progress ?? 0}>
              {importJob.progress ?? 0}%
            </meter>
            {importJob.status === "succeeded" && importJob.result?.quality ? (
              <div className={`import-quality ${importJob.result.quality.status}`}>
                <strong>{importJob.result.quality.status === "accepted" ? "Quality checks passed" : "Accepted with warnings"}</strong>
                <span>
                  Guild {Math.round((importJob.result.quality.roster_coverage ?? importJob.result.quality.member_coverage ?? 0) * 100)}% · Boss{" "}
                  {Math.round((importJob.result.quality.boss_coverage ?? 0) * 100)}%
                </span>
                {(importJob.result.quality.warnings ?? []).map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
                <small>
                  {importJob.result.database_persisted ? "Saved to PostgreSQL." : "PostgreSQL not configured; local data only."}
                  {importJob.result.backup_path ? ` Backup: ${importJob.result.backup_path}` : ""}
                </small>
              </div>
            ) : null}
            <small>{importJob.status === "failed" ? importJob.error : `Updated ${formatDateTime(importJob.updatedAt)}. Status refreshes every 5 seconds while running.`}</small>
          </div>
        ) : (
          <p className="muted">No import job is currently known by the server.</p>
        )}
        {importHistory.length ? (
          <div className="import-history">
            <strong>Recent imports</strong>
            {importHistory.map((job) => (
              <article className={job.status} key={job.id}>
                <span>{job.date ?? "Latest capture"}</span>
                <StatusPill
                  label={importHistoryLabel(job)}
                  severity={importHistorySeverity(job)}
                />
                <small>{job.status === "failed" ? job.error : job.result?.quality?.warnings?.[0] ?? job.detail}</small>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel data-log-panel">
        <PanelHeading title="Action log" subtitle="Latest manual capture and import messages for this browser session." />
        <div className="data-log">
          {messages.length === 0 ? (
            <p className="muted">No manual action has run yet.</p>
          ) : (
            messages.map((message) => (
              <article className={`data-log-item ${message.status}`} key={message.id}>
                <header>
                  <strong>{message.title}</strong>
                  <span>{message.at}</span>
                </header>
                <p>{message.detail}</p>
              </article>
            ))
          )}
        </div>
      </section>
      {captureDialog ? (
        <CaptureDialog
          dialog={captureDialog}
          busyAction={busyAction}
          adbConnected={adbStatus.connected}
          onCancel={() => setCaptureDialog(null)}
          onConfirm={confirmCapture}
          onValidate={validateCapture}
          onReject={rejectCapture}
        />
      ) : null}
    </div>
  );
}

function bossAuditIssueLabel(issue) {
  const impact = `${issue.rowsAffected ?? 0} result${issue.rowsAffected === 1 ? "" : "s"}, ${issue.personalBestsAffected ?? 0} PB`;
  return {
    weekday_mismatch: `Boss does not match weekday · ${impact}`,
    missing_explicit_boss: `Legacy export without boss identity · ${impact}`,
    unknown_boss: `Unknown exported boss · ${impact}`,
    multiple_bosses_for_date: `Several bosses share this date · ${impact}`,
    invalid_date: `Invalid result date · ${impact}`,
  }[issue.type] ?? impact;
}

function DataActionButton({ title, detail, disabled, onClick }) {
  return (
    <button className="data-action-button" type="button" disabled={disabled} onClick={onClick}>
      <span className="data-action-icon" aria-hidden="true">
        PNG
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}

function AdminView({ dataVersion }) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [records, setRecords] = useState({});
  const [loadState, setLoadState] = useState({ loading: true, error: "" });
  const adminMembers = useMemo(
    () => [...members].sort((left, right) => left.name.localeCompare(right.name)),
    [dataVersion],
  );
  const normalizedQuery = normalizedMemberName(query);
  const filteredMembers = adminMembers.filter((member) =>
    !normalizedQuery
    || normalizedMemberName(`${member.name} ${member.playerId ?? ""}`).includes(normalizedQuery),
  );
  const selectedMember = adminMembers.find((member) => memberKey(member) === selectedKey)
    ?? filteredMembers[0]
    ?? null;

  useEffect(() => {
    let active = true;
    fetch("/api/member-admin", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error ?? "Unable to load member administration.");
        if (active) {
          setRecords(payload.records ?? {});
          setLoadState({ loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (active) setLoadState({ loading: false, error: error instanceof Error ? error.message : "Unable to load member administration." });
      });
    return () => {
      active = false;
    };
  }, []);

  function updateRecord(playerId, record) {
    setRecords((current) => ({ ...current, [playerId]: record }));
  }

  const absenceCount = Object.values(records).filter((record) => record?.absenceUntil && record.absenceUntil >= todayLabel()).length;
  const warningCount = Object.values(records).reduce((total, record) => total + (record?.warnings?.length ?? 0), 0);
  const noteCount = Object.values(records).reduce((total, record) => total + (record?.notes?.length ?? 0), 0);
  const missingIdCount = adminMembers.filter((member) => !member.playerId).length;

  return (
    <div className="admin-management">
      <div className="admin-summary-grid">
        <article className="metric-card">
          <span>Announced absences</span>
          <strong>{absenceCount}</strong>
          <small>Currently active</small>
        </article>
        <article className="metric-card">
          <span>Manual warnings</span>
          <strong>{warningCount}</strong>
          <small>Private admin records</small>
        </article>
        <article className="metric-card">
          <span>Officer notes</span>
          <strong>{noteCount}</strong>
          <small>Private admin records</small>
        </article>
        <article className="metric-card">
          <span>Missing IDs</span>
          <strong>{missingIdCount}</strong>
          <small>Identity links to define</small>
        </article>
      </div>

      {loadState.error ? <div className="data-warning" role="alert">{loadState.error}</div> : null}

      <div className="admin-member-layout">
        <section className="panel admin-member-directory">
          <PanelHeading title="Members" subtitle="Select a person to edit private administration data." />
          <label className="admin-member-search">
            <span>Search by name or player ID</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or ID"
            />
          </label>
          <div className="admin-member-list">
            {filteredMembers.map((member) => {
              const record = member.playerId ? records[member.playerId] : null;
              const active = memberKey(member) === memberKey(selectedMember ?? {});
              return (
                <button
                  className={`admin-member-button ${active ? "active" : ""}`}
                  type="button"
                  key={memberKey(member)}
                  onClick={() => setSelectedKey(memberKey(member))}
                >
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.playerId ?? "Missing player ID"}</small>
                  </span>
                  <span className="admin-member-badges">
                    {record?.absenceUntil && record.absenceUntil >= todayLabel() ? <small>Absent</small> : null}
                    {(record?.warnings?.length ?? 0) > 0 ? <small>{record.warnings.length} warning(s)</small> : null}
                  </span>
                </button>
              );
            })}
            {filteredMembers.length === 0 ? <p className="muted">No member matches this search.</p> : null}
          </div>
        </section>

        <section className="panel admin-member-editor">
          {loadState.loading ? <p className="muted">Loading private member data...</p> : null}
          {!loadState.loading && selectedMember ? (
            <AdminMemberEditor
              key={memberKey(selectedMember)}
              member={selectedMember}
              record={selectedMember.playerId ? records[selectedMember.playerId] : null}
              onSaved={updateRecord}
            />
          ) : null}
          {!loadState.loading && !selectedMember ? <p className="muted">Select a member to begin.</p> : null}
        </section>
      </div>
    </div>
  );
}

function TestEnvironmentView() {
  return (
    <div className="admin-management">
      <TestDataPanel />
    </div>
  );
}

function TestDataPanel() {
  const [state, setState] = useState({ operation: "", error: "", success: "" });

  async function loadTestData() {
    const confirmed = window.confirm(
      "Load deterministic synthetic members and boss history into this isolated test database? Existing real data will never be overwritten.",
    );
    if (!confirmed) return;
    setState({ operation: "load", error: "", success: "" });
    try {
      const response = await fetch("/api/data/test-data", {
        method: "POST",
        headers: dataActionHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error ?? "Unable to load synthetic test data.");
      setState({
        operation: "",
        error: "",
        success: `${payload.members} fictional members and ${payload.days} days loaded. Refreshing the Web views…`,
      });
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setState({ operation: "", error: error instanceof Error ? error.message : "Unable to load synthetic test data.", success: "" });
    }
  }

  async function clearTestData() {
    const confirmed = window.confirm(
      "Clear every synthetic member, history day, and boss result from this isolated test database? This cannot clear a database containing non-synthetic data.",
    );
    if (!confirmed) return;
    setState({ operation: "clear", error: "", success: "" });
    try {
      const response = await fetch("/api/data/test-data", {
        method: "DELETE",
        headers: dataActionHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error ?? "Unable to clear synthetic test data.");
      setState({
        operation: "",
        error: "",
        success: `${payload.cleared?.members ?? 0} fictional members cleared. Refreshing the Web views…`,
      });
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setState({ operation: "", error: error instanceof Error ? error.message : "Unable to clear synthetic test data.", success: "" });
    }
  }

  return (
    <section className="panel test-data-panel" aria-labelledby="test-data-title">
      <div>
        <span className="environment-badge">Test environment</span>
        <h2 id="test-data-title">Synthetic database</h2>
        <p>Load fictional members, daily metrics, and boss rankings without contacting OCR or using production data.</p>
      </div>
      <div className="test-data-actions">
        <button className="primary-button" type="button" disabled={Boolean(state.operation)} onClick={loadTestData}>
          {state.operation === "load" ? "Loading test data…" : "Load synthetic test data"}
        </button>
        <button className="secondary-button test-data-clear" type="button" disabled={Boolean(state.operation)} onClick={clearTestData}>
          {state.operation === "clear" ? "Clearing test data…" : "Clear synthetic data"}
        </button>
        {state.error ? <span className="form-error" role="alert">{state.error}</span> : null}
        {state.success ? <span className="form-success" role="status">{state.success}</span> : null}
      </div>
    </section>
  );
}

function AdminMemberEditor({ member, record, onSaved }) {
  const [playerIdDraft, setPlayerIdDraft] = useState("");
  const [absenceUntil, setAbsenceUntil] = useState(record?.absenceUntil ?? "");
  const [absenceReason, setAbsenceReason] = useState(record?.absenceReason ?? "");
  const [warningsText, setWarningsText] = useState((record?.warnings ?? []).map((warning) => warning.reason).join("\n"));
  const [notesText, setNotesText] = useState((record?.notes ?? []).map((note) => note.note).join("\n"));
  const [saveState, setSaveState] = useState({ saving: false, error: "", success: "" });

  async function assignPlayerId(event) {
    event.preventDefault();
    const playerId = playerIdDraft.trim();
    if (!/^\d{6,20}$/.test(playerId)) {
      setSaveState({ saving: false, error: "Player ID must contain 6 to 20 digits.", success: "" });
      return;
    }
    setSaveState({ saving: true, error: "", success: "" });
    try {
      const response = await fetch("/api/data/member-identities", {
        method: "POST",
        headers: dataActionHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ observedName: member.name, playerId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.link) throw new Error(payload?.error ?? "Identity save failed.");
      dashboardDataCache = null;
      window.location.reload();
    } catch (error) {
      setSaveState({ saving: false, error: error instanceof Error ? error.message : "Identity save failed.", success: "" });
    }
  }

  async function updateStatus(status) {
    if (!member.playerId || saveState.saving) return;
    setSaveState({ saving: true, error: "", success: "" });
    try {
      const response = await fetch("/api/data/member-identities", {
        method: "POST",
        headers: dataActionHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "status", playerId: member.playerId, observedName: member.name, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.member) throw new Error(payload?.error ?? "Member status save failed.");
      dashboardDataCache = null;
      window.location.reload();
    } catch (error) {
      setSaveState({ saving: false, error: error instanceof Error ? error.message : "Member status save failed.", success: "" });
    }
  }

  async function savePrivateData(event) {
    event.preventDefault();
    if (!member.playerId) return;
    setSaveState({ saving: true, error: "", success: "" });
    const at = todayLabel();
    const nextRecord = {
      absenceUntil: absenceUntil || null,
      absenceReason,
      warnings: annotationLines(warningsText).map((reason) => ({ reason, at })),
      notes: annotationLines(notesText).map((note) => ({ note, at })),
    };
    try {
      const response = await fetch("/api/member-admin", {
        method: "PUT",
        headers: dataActionHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ playerId: member.playerId, record: nextRecord }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.record) throw new Error(payload?.error ?? "Private member data save failed.");
      onSaved(member.playerId, payload.record);
      setSaveState({ saving: false, error: "", success: "Member administration saved." });
    } catch (error) {
      setSaveState({ saving: false, error: error instanceof Error ? error.message : "Private member data save failed.", success: "" });
    }
  }

  function setAbsenceDays(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    setAbsenceUntil(localIsoDate(date));
  }

  return (
    <>
      <header className="admin-editor-heading">
        <div>
          <h2>{member.name}</h2>
          <p>{member.playerId ?? "Identity not defined"} · {roleLabel(member.role)}</p>
        </div>
        <a className="secondary-button compact-action" href={`/members/${encodeURIComponent(memberKey(member))}`}>
          View profile
        </a>
      </header>

      {!member.playerId ? (
        <form className="admin-control-block" onSubmit={assignPlayerId}>
          <div>
            <strong>Define player ID</strong>
            <p>Link this detected name to its permanent Archero identity.</p>
          </div>
          <div className="admin-inline-controls">
            <input
              inputMode="numeric"
              pattern="[0-9]{6,20}"
              value={playerIdDraft}
              onChange={(event) => setPlayerIdDraft(event.target.value.replace(/\D/g, ""))}
              placeholder="119000000"
            />
            <button className="primary-button" type="submit" disabled={saveState.saving}>Assign ID</button>
          </div>
        </form>
      ) : (
        <>
          <div className="admin-control-block">
            <div>
              <strong>Guild status</strong>
              <p>Manual confirmation overrides incomplete capture assumptions.</p>
            </div>
            <div className="member-status-actions">
              {["active", "left", "kicked"].map((status) => (
                <button
                  className="secondary-button"
                  type="button"
                  key={status}
                  disabled={saveState.saving || member.status === status}
                  onClick={() => updateStatus(status)}
                >
                  {displayLabel(status)}
                </button>
              ))}
            </div>
          </div>

          <form className="admin-private-form" onSubmit={savePrivateData}>
            <div className="admin-control-block">
              <div>
                <strong>Announced absence</strong>
                <p>Record how long the member expects to be unavailable.</p>
              </div>
              <label>
                <span>Until</span>
                <input type="date" value={absenceUntil} onChange={(event) => setAbsenceUntil(event.target.value)} />
              </label>
              <div className="admin-quick-days">
                {[7, 14, 30].map((days) => (
                  <button className="secondary-button compact-action" type="button" key={days} onClick={() => setAbsenceDays(days)}>
                    {days} days
                  </button>
                ))}
                <button className="secondary-button compact-action" type="button" onClick={() => { setAbsenceUntil(""); setAbsenceReason(""); }}>
                  Clear
                </button>
              </div>
              <label>
                <span>Reason or context</span>
                <input value={absenceReason} onChange={(event) => setAbsenceReason(event.target.value)} placeholder="Holiday, exams, travel..." />
              </label>
            </div>

            <div className="admin-control-block">
              <label>
                <strong>Manual warnings</strong>
                <span>One private warning per line.</span>
                <textarea value={warningsText} onChange={(event) => setWarningsText(event.target.value)} placeholder="Reason for a manual warning" rows={4} />
              </label>
            </div>

            <div className="admin-control-block">
              <label>
                <strong>Officer notes</strong>
                <span>One private note per line.</span>
                <textarea value={notesText} onChange={(event) => setNotesText(event.target.value)} placeholder="Private context for officers" rows={4} />
              </label>
            </div>

            <div className="admin-save-row">
              <div>
                {saveState.error ? <span className="form-error" role="alert">{saveState.error}</span> : null}
                {saveState.success ? <span className="form-success" role="status">{saveState.success}</span> : null}
              </div>
              <button className="primary-button" type="submit" disabled={saveState.saving}>
                {saveState.saving ? "Saving..." : "Save member"}
              </button>
            </div>
          </form>
        </>
      )}

      {saveState.error && !member.playerId ? <span className="form-error" role="alert">{saveState.error}</span> : null}
    </>
  );
}

function CaptureDialog({ dialog, busyAction, adbConnected, onCancel, onConfirm, onValidate, onReject }) {
  const title = dataKindLabel(dialog.kind);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="data-modal" role="dialog" aria-modal="true" aria-labelledby="capture-dialog-title">
        <header>
          <div>
            <h2 id="capture-dialog-title">{title} screenshot</h2>
            <p>{dialog.phase === "review" ? "Review the screenshot that was saved." : "Confirm when the emulator is already on the correct screen."}</p>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Close capture dialog">
            ×
          </button>
        </header>

        {dialog.phase === "confirm" ? (
          <div className="data-modal-body">
            <div className="data-confirm-box">
              <StatusPill label={adbConnected ? "Connected" : "Disconnected"} severity={adbConnected ? "positive" : "warning"} />
              <p>Only one BlueStacks screenshot will be taken. No navigation, OCR, import, or database command will run.</p>
            </div>
            <div className="data-modal-actions">
              <button className="secondary-button" type="button" onClick={onCancel}>
                Cancel
              </button>
              <button className="primary-button" type="button" disabled={!adbConnected || busyAction !== null} onClick={onConfirm}>
                Take screenshot
              </button>
            </div>
          </div>
        ) : null}

        {dialog.phase === "capturing" ? (
          <div className="data-modal-body">
            <div className="data-progress-note">Capturing current ADB screen...</div>
          </div>
        ) : null}

        {dialog.phase === "review" ? (
          <div className="data-modal-body">
            <ScreenshotPreview title="Captured screenshot" capture={dialog.result} />
            <div className="data-modal-actions">
              <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={onReject}>
                {busyAction === "discard" ? "Discarding..." : "Discard screenshot"}
              </button>
              <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={onConfirm}>
                Retake
              </button>
              <button className="primary-button" type="button" disabled={busyAction !== null} onClick={onValidate}>
                Keep screenshot
              </button>
            </div>
          </div>
        ) : null}

        {dialog.phase === "error" ? (
          <div className="data-modal-body">
            <div className="data-error-box">{dialog.error}</div>
            <div className="data-modal-actions">
              <button className="secondary-button" type="button" onClick={onCancel}>
                Close
              </button>
              <button className="primary-button" type="button" disabled={!adbConnected} onClick={onConfirm}>
                Try again
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ScreenshotPreview({ title, capture }) {
  if (!capture) return null;
  return (
    <figure className="screenshot-preview">
      <figcaption>
        <strong>{title}</strong>
        <span>{capture.path}</span>
      </figcaption>
      {capture.imageUrl ? <img src={capture.imageUrl} alt={title} /> : <div className="preview-missing">Preview unavailable</div>}
    </figure>
  );
}

function SyncSteps({ steps }) {
  return (
    <ol className="sync-steps">
      {steps.map((step) => (
        <li className={step.status} key={step.label}>
          <span aria-hidden="true" />
          <strong>{step.label}</strong>
        </li>
      ))}
    </ol>
  );
}

function buildSyncSteps(status = "idle") {
  return ["Find raw screenshots", "Extract guild data", "Check imported data", "Update dashboard file"].map((label) => ({ label, status }));
}

function markSyncStep(steps, index, status) {
  return steps.map((step, stepIndex) => ({ ...step, status: stepIndex === index ? status : stepIndex < index ? "done" : "idle" }));
}

function importJobToSteps(job) {
  if (!job) return buildSyncSteps();
  if (job.status === "succeeded") return buildSyncSteps("done");
  const index = Math.max(0, Math.min(3, job.stepIndex ?? 0));
  return buildSyncSteps().map((step, stepIndex) => ({
    ...step,
    status: job.status === "failed" && stepIndex === index ? "error" : stepIndex < index ? "done" : stepIndex === index ? "running" : "idle",
  }));
}

function importJobDetail(job) {
  if (!job) return "";
  const percent = typeof job.progress === "number" ? `${Math.round(job.progress)}%` : "progress unknown";
  const date = job.date ? `${job.date} · ` : "";
  return `${date}${percent} · ${job.detail ?? job.phase ?? job.status}`;
}

function dataKindLabel(kind) {
  return {
    "guild-members": "Guild members",
    "guild-boss": "Guild boss",
  }[kind] ?? kind;
}

function dataActionHeaders(extra = {}) {
  return { "x-archero-dashboard-action": "1", ...extra };
}

function Dashboard({ rules }) {
  const [donationRange, setDonationRange] = useState("1m");
  const summary = buildSummary(members, rules);
  const powerStats = buildDailyPowerStats();
  const medianPowerSeries = powerStats.map((day) => day.median);
  const powerDates = powerStats.map((day) => formatShortDate(day.date));
  const weeklyDonationStats = buildWeeklyDonationStats();
  const donationStats = filterDatedChartRows(weeklyDonationStats, donationRange);
  const donationSeries = donationStats.map((day) => day.total);
  const donationDates = donationStats.map((day) => formatWeekLabel(day.date));
  const latestMemberDay = Array.isArray(dailyRawSnapshots) ? dailyRawSnapshots.at(-1) : null;
  const currentBossDay = filterBossDayToCurrentMembers(Array.isArray(dailyBossRawSnapshots) ? dailyBossRawSnapshots.at(-1) : null);
  const bossRows = currentBossDay?.rows?.filter((row) => isCurrentPlayerId(row.playerId) && typeof row.bossDamageToday === "number") ?? [];
  const topBoss = [...bossRows].sort((left, right) => (right.bossDamageToday ?? 0) - (left.bossDamageToday ?? 0))[0] ?? null;
  const latestCaptureDate = latestMemberDay?.date ?? currentBossDay?.date ?? null;
  const guildCaptureRows = latestMemberDay?.rows?.length ?? 0;
  const bossCaptureRows = currentBossDay?.rows?.filter((row) => !row.playerId || isCurrentPlayerId(row.playerId)) ?? [];
  const kickedCandidates = buildKickedCandidates(latestCaptureDate);
  const cards = [
    ["Members", summary.members, `${summary.freeSlots} free slot(s), ${summary.formerMembers} former`],
    ["Known IDs", summary.knownIds, `${summary.unresolvedIds} missing`],
    ["Discord", summary.discordLinked, `${summary.discordMissing} missing / to verify`],
    ["Verified data", `${summary.verifiedMetrics}/${summary.currentMembers}`, `${summary.reviewRequired} need review`],
    ["Donation", formatNumber(summary.totalContribution), deltaDetail(summary.totalContributionDelta)],
    ["Boss tries", formatNumber(summary.bossAttacks), deltaDetail(summary.bossAttacksDelta)],
    ["Watch list", summary.watchCount, "Automatic rules"],
  ];
  const watched = currentMembersList()
    .map((member) => ({ member, evaluation: evaluateMember(member, rules) }))
    .filter(({ member, evaluation }) => member.metricsVerified && ["warning", "danger"].includes(evaluation.severity))
    .slice(0, 5);

  return (
    <>
      <div className="dashboard-command-grid">
        <section className="panel command-panel">
          <PanelHeading title="Today snapshot" subtitle="Latest captured data available in the app." />
          <div className="snapshot-grid">
            <div>
              <span>Date</span>
              <strong>{latestCaptureDate ?? "No capture"}</strong>
            </div>
            <div>
              <span>Guild captures</span>
              <strong>{guildCaptureRows}/{summary.currentMembers}</strong>
            </div>
            <div>
              <span>Boss captures</span>
              <strong>{bossRows.length}/{bossCaptureRows.length}</strong>
            </div>
          </div>
        </section>
        <section className="panel command-panel">
          <PanelHeading
            title="Roster status"
            subtitle="Current member status and possible departures."
          />
          <div className="review-list">
            <a href="/members">
              <span>Kicked candidates</span>
              <strong>{kickedCandidates.length}</strong>
            </a>
          </div>
        </section>
      </div>
      <div className="action-strip">
        <a className="action-tile" href="/boss">
          <span>Boss</span>
          <strong>{topBoss ? formatBossDamageText(topBoss.bossDamageToday, topBoss.damageText) : "Not recorded"}</strong>
          <small>{topBoss?.name ?? "No boss damage"}</small>
        </a>
        <a className="action-tile" href="/members">
          <span>Alerts</span>
          <strong>{summary.watchCount}</strong>
          <small>Members to watch</small>
        </a>
      </div>
      <div className="metrics-grid">
        {cards.map(([label, value, detail]) => (
          <article className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <ChartPanel
          title="Weekly donation peak"
          subtitle="Best captured donation total per week"
          action={<DashboardRangeSelector value={donationRange} onChange={setDonationRange} />}
          values={donationSeries}
          xLabels={donationDates}
          label="Weekly donation"
          value={formatOptionalNumber(donationSeries.at(-1))}
          showPoints
          pointValueMode="auto"
        />
        <ChartPanel
          title="Median power"
          subtitle="Middle active member power, not max or growth"
          badge="Median"
          values={medianPowerSeries}
          xLabels={powerDates}
          label="Median power"
          value={formatOptionalCompact(medianPowerSeries.at(-1))}
          positive
          showPoints
        />
        <section className="panel">
          <PanelHeading title="Members to watch" subtitle="Game absence, low donation, or missed boss" />
          <div className="watch-list">
            {watched.length === 0 ? (
              <p className="muted">No verified alerts yet.</p>
            ) : (
              watched.map(({ member, evaluation }) => (
                <article className="watch-item" key={memberKey(member)}>
                  <header>
                    <strong>{member.name}</strong>
                    <StatusPill label={evaluation.status} severity={evaluation.severity} />
                  </header>
                  <span className="muted">{evaluation.flags.join(" · ")}</span>
                  <span className="muted">{deltaLine(member)}</span>
                </article>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHeading title="Recent changes" subtitle="Captures, joins, departures, and renames" />
          <EventList events={changes} />
        </section>
      </div>
    </>
  );
}

function MembersView({ query, setQuery, statusFilter, setStatusFilter, sort, setSort, rules }) {
  const summary = buildSummary(members, rules);
  const [showFormerMembers, setShowFormerMembers] = useState(false);
  const [exporting, setExporting] = useState(false);
  const historyDates = memberHistoryDates(members);
  const latestHistoryDate = historyDates.at(-1) ?? currentImportDate();
  const [selectedMembersDate, setSelectedMembersDate] = useState(latestHistoryDate);
  useEffect(() => {
    setSelectedMembersDate(latestHistoryDate);
  }, [latestHistoryDate]);
  const selectedMembersDateIndex = Math.max(0, historyDates.indexOf(selectedMembersDate));
  const previousMembersDate = selectedMembersDateIndex > 0 ? historyDates[selectedMembersDateIndex - 1] : null;
  const datedMembers = members.map((member) => memberSnapshotForDate(member, selectedMembersDate));
  const membersForView = datedMembers.filter((member) => showFormerMembers || statusFilter === "former" || !isFormerStatus(member.status));
  const visibleMembers = sortMembers(filterMembers(membersForView, rules, query, statusFilter), rules, sort);
  const cards = [
    ["Current guild", `${summary.currentMembers} members`, `${summary.formerMembers} former record(s)`],
    ["Known IDs", summary.knownIds, `${summary.unresolvedIds} name(s) without ID`],
    ["Discord", `${summary.discordLinked} members`, `${summary.discordMissing} missing / to verify`],
    ["Verified stats", `${summary.verifiedMetrics} members`, `${summary.reviewRequired} need review`],
  ];

  function toggleSort(key) {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: defaultSortDirection(key) },
    );
  }

  function selectPreviousMembersDate() {
    if (historyDates.length === 0) return;
    const nextIndex = Math.max(0, selectedMembersDateIndex - 1);
    setSelectedMembersDate(historyDates[nextIndex]);
  }

  function selectNextMembersDate() {
    if (historyDates.length === 0) return;
    const nextIndex = Math.min(historyDates.length - 1, selectedMembersDateIndex + 1);
    setSelectedMembersDate(historyDates[nextIndex]);
  }

  async function exportMembers() {
    setExporting(true);
    try {
      await exportMembersImage(visibleMembers, rules, {
        selectedDate: selectedMembersDate,
        query,
        statusFilter,
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <label className="search-field">
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Name, Discord, or ID" />
        </label>
        <label className="select-field">
          <span>Filter</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {[
              ["all", "All"],
              ["active", "Active"],
              ["watch", "Watch"],
              ["absent", "Game absence"],
              ["officer", "Officers"],
              ["discord-linked", "On Discord"],
              ["discord-missing", "Missing Discord"],
              ["review", "Needs review"],
              ["missing", "Missing stats"],
              ["unresolved", "Missing ID"],
              ["former", "Former members"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <HistoryDateSelector
          rows={historyDates.map((date) => ({ date }))}
          selectedDate={selectedMembersDate}
          selectedIndex={selectedMembersDateIndex}
          previousRow={previousMembersDate ? { date: previousMembersDate } : null}
          onSelect={setSelectedMembersDate}
          onPrevious={selectPreviousMembersDate}
          onNext={selectNextMembersDate}
        />
        <label className="toggle-field">
          <input type="checkbox" checked={showFormerMembers} onChange={(event) => setShowFormerMembers(event.target.checked)} />
          <span>Show former members</span>
        </label>
        <button className="secondary-button" type="button" onClick={exportMembers} disabled={exporting || visibleMembers.length === 0}>
          {exporting ? "Exporting..." : "Export image"}
        </button>
      </div>
      <div className="identity-metrics">
        {cards.map(([label, value, detail]) => (
          <article className="metric-card compact" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <section className="panel table-panel">
        <div className="table-wrap">
          <table className="members-table">
            <colgroup>
              <col className="col-player-id" />
              <col className="col-name" />
              <col className="col-discord" />
              <col className="col-role" />
              <col className="col-absence" />
              <col className="col-donation" />
              <col className="col-boss-tries" />
              <col className="col-power" />
              <col className="col-capture" />
              <col className="col-alerts" />
            </colgroup>
            <thead>
              <tr>
                {[
                  ["playerId", "Player ID"],
                  ["name", "Name"],
                  ["discord", "Discord"],
                  ["role", "Role"],
                  ["activity", "Last connection"],
                  ["donation", "Donation"],
                  ["bossTries", "Boss tries"],
                  ["power", "Power"],
                  ["capture", "Last seen"],
                  ["alerts", "Status"],
                ].map(([key, label]) => (
                  <th key={key}>
                    <button className={`sort-button ${sort.key === key ? `active ${sort.direction}` : ""}`} type="button" onClick={() => toggleSort(key)}>
                      {label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((member) => (
                <MemberRow member={member} rules={rules} key={memberKey(member)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function BossView() {
  const bossData = useMemo(() => buildBossDashboardData(), []);
  const [selectedPlayers, setSelectedPlayers] = useState(() => bossPlayerSelection(bossData.players, 10));
  const [bossFilter, setBossFilter] = useState(() => bossData.activeBoss.key);
  const [bossSection, setBossSection] = useState("weekly");
  const selectedBossKey = bossFilter === "all" ? null : bossFilter;
  const selectedBoss = selectedBossKey ? bossForKey(selectedBossKey) : null;
  const selectedDates = selectedBossKey ? bossData.dates.filter((date) => bossData.bossesByDate.get(date)?.key === selectedBossKey) : bossData.dates;
  const selectedSeries = bossData.players
    .filter((player) => selectedPlayers.has(player.playerId))
    .map((player) => ({ ...player, points: selectedBossKey ? player.points.filter((point) => point.bossKey === selectedBossKey) : player.points }))
    .filter((player) => player.points.length > 0);
  const selectedLabel = selectedBoss ? selectedBoss.name : "All bosses";

  function togglePlayer(playerId) {
    setSelectedPlayers((current) => {
      const next = new Set(current);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedPlayers(new Set(bossData.players.map((player) => player.playerId)));
  }

  function selectTop(limit) {
    setSelectedPlayers(bossPlayerSelection(bossData.players, limit));
  }

  function clearAll() {
    setSelectedPlayers(new Set());
  }

  function selectOnly(playerId) {
    setSelectedPlayers(new Set([playerId]));
  }

  function selectBoss(bossKey) {
    setBossFilter((current) => (current === bossKey ? "all" : bossKey));
  }

  return (
    <div className="boss-page">
      <div className="boss-section-tabs" role="tablist" aria-label="Boss views">
        <button className={bossSection === "weekly" ? "active" : ""} type="button" role="tab" aria-selected={bossSection === "weekly"} onClick={() => setBossSection("weekly")}>
          Weekly
        </button>
        <button className={bossSection === "alltime" ? "active" : ""} type="button" role="tab" aria-selected={bossSection === "alltime"} onClick={() => setBossSection("alltime")}>
          All-time ranking
        </button>
        <button className={bossSection === "byBoss" ? "active" : ""} type="button" role="tab" aria-selected={bossSection === "byBoss"} onClick={() => setBossSection("byBoss")}>
          By boss
        </button>
      </div>

      {bossSection === "weekly" ? (
        <>
          <section className="panel boss-context-panel">
            <div className="boss-current-card">
              <BossIcon boss={bossData.activeBoss} />
              <div>
                <span className="eyebrow">Boss today</span>
                <h2>{bossData.activeBoss.name}</h2>
                <p>
                  {bossData.activeBoss.dayLabel} - ATK {bossData.activeBoss.stats.atk} - DEF {bossData.activeBoss.stats.def} - SPD {bossData.activeBoss.stats.spd}
                </p>
              </div>
            </div>
            <button className={bossFilter === "all" ? "boss-all-filter active" : "boss-all-filter"} type="button" onClick={() => setBossFilter("all")}>
              All bosses
            </button>
            <BossRotationStrip activeKey={selectedBossKey} todayKey={bossData.activeBoss.key} onSelectBoss={selectBoss} />
          </section>

          <section className="panel boss-chart-panel">
            <PanelHeading
              title="Guild boss damage"
              subtitle={`${selectedSeries.length}/${bossData.players.length} members visible for ${selectedLabel} across ${selectedDates.length} captured day(s).`}
              action={
                <div className="boss-chart-actions">
                  <button className="secondary-button compact-action" type="button" onClick={() => selectTop(10)}>
                    Top 10
                  </button>
                  <button className="secondary-button compact-action" type="button" onClick={() => selectTop(20)}>
                    Top 20
                  </button>
                  <button className="secondary-button compact-action" type="button" onClick={selectAll}>
                    All
                  </button>
                  <button className="secondary-button compact-action" type="button" onClick={clearAll}>
                    None
                  </button>
                </div>
              }
            />
            <BossMultiLineChart dates={selectedDates} series={selectedSeries} />
          </section>

          <section className="panel boss-selector-panel">
            <PanelHeading title="Members" subtitle="Check members to display them in the graph." />
            <div className="boss-player-grid">
              {bossData.players.map((player) => (
                <label className="boss-player-toggle" key={player.playerId}>
                  <input type="checkbox" checked={selectedPlayers.has(player.playerId)} onChange={() => togglePlayer(player.playerId)} />
                  <span className="boss-color-dot" style={{ background: player.color }} aria-hidden="true" />
                  <span>
                    <strong>{player.name}</strong>
                    <small>{formatBossDamageText(player.latestDamage)} latest</small>
                  </span>
                  <button className="secondary-button compact-action" type="button" onClick={(event) => { event.preventDefault(); selectOnly(player.playerId); }}>
                    Solo
                  </button>
                </label>
              ))}
            </div>
          </section>

          <BossDailyRankingPanel days={selectedBossKey ? bossData.dailyRankings.filter((day) => day.boss.key === selectedBossKey) : bossData.dailyRankings} />
        </>
      ) : null}

      {bossSection === "alltime" ? (
        <BossAllTimePanel rows={bossData.bestDayRecords} />
      ) : null}

      {bossSection === "byBoss" ? <BossByBossRecordsPanel records={bossData.bestByBossRecords} limit={bossData.players.length} /> : null}
    </div>
  );
}

function BossIcon({ boss }) {
  return (
    <span className="boss-icon" aria-hidden="true">
      {boss.image ? <img src={boss.image} alt="" /> : boss.icon}
    </span>
  );
}

function BossRotationStrip({ activeKey, todayKey, onSelectBoss }) {
  return (
    <div className="boss-rotation-strip" aria-label="Weekly boss rotation">
      {BOSS_ROTATION.map((boss) => (
        <button className={bossRotationClassName(boss.key, activeKey, todayKey)} type="button" onClick={() => onSelectBoss(boss.key)} key={boss.key}>
          <BossIcon boss={boss} />
          <span>{boss.dayLabel}</span>
          <strong>{boss.name}</strong>
        </button>
      ))}
    </div>
  );
}

function bossRotationClassName(bossKey, activeKey, todayKey) {
  return ["boss-rotation-item", bossKey === activeKey ? "active" : "", bossKey === todayKey ? "today" : ""].filter(Boolean).join(" ");
}

function BossMultiLineChart({ dates, series }) {
  if (dates.length === 0 || series.length === 0) {
    return <div className="boss-chart-empty">Select at least one member with boss damage history.</div>;
  }

  const width = 1080;
  const height = 430;
  const padding = { top: 28, right: 36, bottom: 46, left: 64 };
  const values = series.flatMap((player) => player.points.map((point) => point.damage));
  const max = Math.max(...values, 1);
  const scaleMax = max * 1.08;
  const xForDate = (date) => {
    const index = dates.indexOf(date);
    return dates.length === 1 ? width / 2 : padding.left + (index * (width - padding.left - padding.right)) / (dates.length - 1);
  };
  const yForDamage = (value) => height - padding.bottom - (value / scaleMax) * (height - padding.top - padding.bottom);
  const gridValues = [0.25, 0.5, 0.75, 1].map((ratio) => scaleMax * ratio);

  return (
    <div className="boss-multi-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Guild boss damage comparison">
        {gridValues.map((value) => {
          const y = yForDamage(value);
          return (
            <g key={value}>
              <path className="chart-grid-line" d={`M ${padding.left} ${y.toFixed(1)} L ${width - padding.right} ${y.toFixed(1)}`} />
              <text className="chart-axis-label" x={padding.left - 10} y={(y + 4).toFixed(1)} textAnchor="end">
                {formatBossDamageText(value)}
              </text>
            </g>
          );
        })}
        <path className="chart-grid-line" d={`M ${padding.left} ${height - padding.bottom} L ${width - padding.right} ${height - padding.bottom}`} />
        {dates.map((date) => {
          const x = xForDate(date);
          return (
            <g key={date}>
              <path className="chart-tick-line" d={`M ${x.toFixed(1)} ${height - padding.bottom - 5} L ${x.toFixed(1)} ${height - padding.bottom + 5}`} />
              <text className="chart-axis-label" x={x.toFixed(1)} y={height - 14} textAnchor="middle">
                {formatShortDate(date)}
              </text>
            </g>
          );
        })}
        {series.map((player) => {
          const path = player.points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${xForDate(point.date).toFixed(1)} ${yForDamage(point.damage).toFixed(1)}`)
            .join(" ");
          return (
            <g key={player.playerId}>
              {player.points.length > 1 ? <path className="boss-series-line" d={path} style={{ stroke: player.color }} /> : null}
              {player.points.map((point) => (
                <circle
                  className={`boss-series-point ${point.isGlobalPb ? "global-pb" : point.isBossPb ? "boss-pb" : ""}`}
                  cx={xForDate(point.date).toFixed(1)}
                  cy={yForDamage(point.damage).toFixed(1)}
                  r={point.isGlobalPb ? "6" : point.isBossPb ? "5" : "4"}
                  style={{ stroke: player.color }}
                  key={`${point.date}-${point.bossKey}`}
                >
                  <title>{bossPointTitle(player, point)}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BossRankingPanel({ title, subtitle, rows, valueKey, showDate = false, showBoss = false, limit = 10, wide = false }) {
  return (
    <section className={wide ? "panel boss-ranking-panel-wide" : "panel"}>
      <PanelHeading title={title} subtitle={subtitle} />
      <div className="boss-ranking-list">
        {rows.length === 0 ? (
          <p className="muted">No boss damage recorded.</p>
        ) : (
          rows.slice(0, limit).map((row, index) => (
            <div className="boss-ranking-row" key={`${title}-${row.playerId}-${row.date ?? row.weekStart ?? index}`}>
              <span className="rank-number">{index + 1}</span>
              <div>
                <strong>{row.name}</strong>
                <small>{[showDate ? row.date : null, showBoss ? row.bossName : null].filter(Boolean).join(" - ")}</small>
              </div>
              <span>{formatBossDamageText(row[valueKey])}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function BossAllTimePanel({ rows }) {
  const [exporting, setExporting] = useState(false);
  const podium = rows.slice(0, 3);
  const remaining = rows.slice(3);

  async function exportRankingImage() {
    setExporting(true);
    try {
      await exportBossAllTimeRanking(rows);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="panel boss-alltime-panel">
      <PanelHeading
        title="All-time ranking"
        subtitle="Best single-day boss score for each guild member."
        action={
          <button className="secondary-button compact-action" type="button" disabled={exporting || rows.length === 0} onClick={exportRankingImage}>
            {exporting ? "Exporting..." : "Export image"}
          </button>
        }
      />
      <div className="boss-podium">
        {podium.map((row, index) => (
          <article className={`boss-podium-card rank-${index + 1}`} key={`podium-${row.playerId}`}>
            <div className="boss-medal">{index + 1}</div>
            <BossIcon boss={row.boss} />
            <div className="boss-podium-copy">
              <strong>{row.name}</strong>
              <small>
                <span>{row.bossName}</span>
                <span>{row.date}</span>
              </small>
            </div>
            <span className="boss-podium-score">{formatBossDamageText(row.damage)}</span>
          </article>
        ))}
      </div>
      <div className="boss-table-wrap">
        <table className="boss-ranking-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Member</th>
              <th>Boss</th>
              <th>Date</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {remaining.map((row, index) => (
              <tr key={`alltime-${row.playerId}-${row.date}`}>
                <td>{index + 4}</td>
                <td>{row.name}</td>
                <td>
                  <span className="boss-table-boss">
                    <BossIcon boss={row.boss} />
                    <span>{row.bossName}</span>
                  </span>
                </td>
                <td>{row.date}</td>
                <td>{formatBossDamageText(row.damage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function exportBossAllTimeRanking(rows) {
  const exportRows = rows.map((row, index) => ({ ...row, rank: index + 1 }));
  const width = 1800;
  const margin = 64;
  const rowHeight = 70;
  const headerHeight = 128;
  const podiumTop = 170;
  const podiumHeight = 280;
  const tableTop = podiumTop + podiumHeight + 54;
  const tableHeaderHeight = 58;
  const footerHeight = 56;
  const height = tableTop + tableHeaderHeight + exportRows.length * rowHeight + footerHeight + margin;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const images = await loadBossExportImages(exportRows);
  drawExportBackground(ctx, width, height);
  drawExportHeader(ctx, exportRows.length);

  const podium = exportRows.slice(0, 3);
  const podiumCards = [
    { row: podium[1], rankClass: 2, x: margin, y: podiumTop + 42, w: 500, h: 210 },
    { row: podium[0], rankClass: 1, x: 590, y: podiumTop, w: 620, h: 252 },
    { row: podium[2], rankClass: 3, x: 1236, y: podiumTop + 42, w: 500, h: 210 },
  ];
  for (const card of podiumCards) {
    if (card.row) drawExportPodiumCard(ctx, card, images.get(card.row.bossKey));
  }

  drawExportTable(ctx, exportRows, images, margin, tableTop, width - margin * 2, tableHeaderHeight, rowHeight);
  downloadCanvas(canvas, `archero-boss-all-time-ranking-${currentIsoDate()}.png`);
}

async function loadBossExportImages(rows) {
  const byKey = new Map();
  const bosses = new Map(rows.filter((row) => row.boss?.image).map((row) => [row.bossKey, row.boss]));
  await Promise.all(
    [...bosses.values()].map(
      (boss) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => {
            byKey.set(boss.key, image);
            resolve();
          };
          image.onerror = () => resolve();
          image.src = boss.image;
        }),
    ),
  );
  return byKey;
}

function drawExportBackground(ctx, width, height) {
  ctx.fillStyle = "#f2f5f8";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfd";
  roundedRect(ctx, 32, 32, width - 64, height - 64, 18);
  ctx.fill();
  ctx.strokeStyle = "#c8d2dc";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawExportHeader(ctx, rowCount) {
  drawText(ctx, "Archero Guild", 64, 74, { size: 26, weight: 800, color: "#435062" });
  drawText(ctx, "All-time boss ranking", 64, 124, { size: 48, weight: 900, color: "#111a25" });
  drawText(ctx, `Best single-day boss score for ${rowCount} guild member${rowCount > 1 ? "s" : ""}.`, 64, 164, { size: 24, weight: 600, color: "#4b5b6d" });
  drawText(ctx, currentIsoDate(), 1736, 124, { size: 22, weight: 800, color: "#435062", align: "right" });
}

function drawExportPodiumCard(ctx, { row, rankClass, x, y, w, h }, image) {
  const palette = {
    1: { fill: "#fff0c9", border: "#eca900", medal: "#ffbd24", orb: "#d9d0ba" },
    2: { fill: "#e9eef4", border: "#aeb9c5", medal: "#dfe7ef", orb: "#ccd7e5" },
    3: { fill: "#f7e4d5", border: "#c78355", medal: "#e8ad7b", orb: "#d8cbc7" },
  }[rankClass];

  ctx.fillStyle = palette.fill;
  roundedRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  roundedRect(ctx, x, y, w, h, 12);
  ctx.clip();
  ctx.fillStyle = palette.orb;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(x + w - 68, y + h + 18, 112, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.fillStyle = palette.medal;
  roundedRect(ctx, x + 24, y + 24, 54, 54, 12);
  ctx.fill();
  drawText(ctx, String(row.rank), x + 51, y + 61, { size: 26, weight: 900, align: "center", color: "#101820" });

  drawBossExportImage(ctx, image, x + (rankClass === 1 ? 104 : 118), y + 24, rankClass === 1 ? 96 : 70);
  drawText(ctx, row.name, x + 24, y + h - (rankClass === 1 ? 106 : 88), { size: rankClass === 1 ? 34 : 30, weight: 900, color: "#101820", maxWidth: w - 48 });
  drawText(ctx, `${row.bossName}  ${row.date}`, x + 24, y + h - (rankClass === 1 ? 68 : 54), { size: 18, weight: 800, color: "#435062", maxWidth: w - 48 });
  drawText(ctx, formatBossDamageText(row.damage), x + w - 24, y + h - (rankClass === 1 ? 34 : 24), { size: rankClass === 1 ? 44 : 38, weight: 950, align: "right", color: "#101820" });
}

function drawExportTable(ctx, rows, images, x, y, w, headerHeight, rowHeight) {
  roundedRect(ctx, x, y, w, headerHeight + rows.length * rowHeight, 12);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#c8d2dc";
  ctx.lineWidth = 2;
  ctx.stroke();

  const columns = {
    rank: x + 90,
    member: x + 210,
    boss: x + 690,
    date: x + 1190,
    score: x + w - 28,
  };
  drawText(ctx, "Rank", columns.rank, y + 38, { size: 17, weight: 900, color: "#435062", align: "right" });
  drawText(ctx, "Member", columns.member, y + 38, { size: 17, weight: 900, color: "#435062" });
  drawText(ctx, "Boss", columns.boss, y + 38, { size: 17, weight: 900, color: "#435062" });
  drawText(ctx, "Date", columns.date, y + 38, { size: 17, weight: 900, color: "#435062" });
  drawText(ctx, "Score", columns.score, y + 38, { size: 17, weight: 900, color: "#435062", align: "right" });

  ctx.strokeStyle = "#c8d2dc";
  drawLine(ctx, x, y + headerHeight, x + w, y + headerHeight);

  rows.forEach((row, index) => {
    const rowY = y + headerHeight + index * rowHeight;
    if (index % 2 === 1) {
      ctx.fillStyle = "#f7f9fb";
      ctx.fillRect(x + 1, rowY, w - 2, rowHeight);
    }
    drawLine(ctx, x, rowY + rowHeight, x + w, rowY + rowHeight);
    drawText(ctx, String(row.rank), columns.rank, rowY + 43, { size: 20, weight: 800, color: "#111a25", align: "right" });
    drawText(ctx, row.name, columns.member, rowY + 43, { size: 22, weight: 800, color: "#111a25", maxWidth: 380 });
    drawBossExportImage(ctx, images.get(row.bossKey), columns.boss, rowY + 14, 40);
    drawText(ctx, row.bossName, columns.boss + 54, rowY + 43, { size: 20, weight: 700, color: "#111a25", maxWidth: 360 });
    drawText(ctx, row.date, columns.date, rowY + 43, { size: 20, weight: 700, color: "#111a25" });
    drawText(ctx, formatBossDamageText(row.damage), columns.score, rowY + 43, { size: 21, weight: 850, color: "#111a25", align: "right" });
  });
}

function drawBossExportImage(ctx, image, x, y, size) {
  if (!image) {
    ctx.fillStyle = "#e5ebf2";
    roundedRect(ctx, x, y, size, size, 10);
    ctx.fill();
    return;
  }
  const ratio = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  const drawWidth = image.naturalWidth * ratio;
  const drawHeight = image.naturalHeight * ratio;
  ctx.drawImage(image, x + (size - drawWidth) / 2, y + (size - drawHeight) / 2, drawWidth, drawHeight);
}

function drawText(ctx, text, x, y, { size, weight = 400, color = "#111a25", align = "left", maxWidth = null }) {
  ctx.font = `${weight} ${size}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  const value = maxWidth ? ellipsizeCanvasText(ctx, String(text), maxWidth) : String(text);
  ctx.fillText(value, x, y);
}

function ellipsizeCanvasText(ctx, value, maxWidth) {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && ctx.measureText(`${result}...`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function drawLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function BossDailyRankingPanel({ days }) {
  return (
    <section className="panel boss-daily-panel">
      <PanelHeading title="Daily ranking" subtitle="Damage ranking for each captured day." />
      <div className="boss-day-list">
        {days.length === 0 ? (
          <p className="muted">No boss damage recorded.</p>
        ) : (
          days.map((day) => (
            <article className="boss-day-card" key={day.date}>
              <header>
                <div>
                  <h3>{day.date}</h3>
                  <span className="muted">{day.boss.name}</span>
                </div>
                <span className="muted">{day.rows.length} records</span>
              </header>
              <div className="boss-ranking-list compact">
                {day.rows.slice(0, 10).map((row, index) => (
                  <div className="boss-ranking-row" key={`${day.date}-${row.playerId}`}>
                    <span className="rank-number">{index + 1}</span>
                    <div>
                      <strong>{row.name}</strong>
                      <small>{row.bossRank ? `Game rank ${row.bossRank}` : "No game rank"}</small>
                    </div>
                    <span>{formatBossDamageText(row.damage)}</span>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function BossByBossRecordsPanel({ records, limit = 3 }) {
  return (
    <section className="panel boss-by-boss-panel">
      <PanelHeading title="PB by boss" subtitle="Best single-day score per boss." />
      <div className="boss-by-boss-grid">
        {records.map(({ boss, rows }) => (
          <article className={rows.length === 0 ? "boss-record-card empty" : "boss-record-card"} key={boss.key}>
            <header>
              <BossIcon boss={boss} />
              <div>
                <h3>{boss.name}</h3>
                <span className="muted">{boss.dayLabel}</span>
              </div>
            </header>
            <div className="boss-ranking-list compact">
              {rows.length === 0 ? (
                <p className="muted">No record yet.</p>
              ) : (
                rows.slice(0, limit).map((row, index) => (
                  <div className="boss-ranking-row" key={`${boss.key}-${row.playerId}`}>
                    <span className="rank-number">{index + 1}</span>
                    <div>
                      <strong>{row.name}</strong>
                      <small>{row.date}</small>
                    </div>
                    <span>{formatBossDamageText(row.damage)}</span>
                  </div>
                ))
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MemberRow({ member, rules }) {
  const router = useRouter();
  const evaluation = evaluateMember(member, rules);
  return (
    <tr
      className={`member-row ${rowStateClass(evaluation)} ${isFormerStatus(member.status) ? "row-former" : ""} clickable-row`}
      onClick={() => navigateToMember(member, router)}
    >
      <td>
        <div className="player-cell">
          <strong>{member.playerId ?? "Missing ID"}</strong>
        </div>
      </td>
      <td>
        <a className="member-link" href={`/members/${encodeURIComponent(memberKey(member))}`} onClick={(event) => event.stopPropagation()}>
          <strong>{member.name}</strong>
          <NewMemberBadge member={member} rules={rules} />
        </a>
      </td>
      <td>
        <DiscordDot member={member} />
      </td>
      <td>{roleLabel(member.role)}</td>
      <td>{activityLabel(member.lastActivityDays, member.activityText)}</td>
      <td className="numeric">
        <ValueWithDelta value={formatOptionalNumber(member.contribution7d)} delta={member.contributionDelta} formatter={formatNumber} />
      </td>
      <td className="numeric">
        <ValueWithDelta value={formatOptionalNumber(member.bossAttacks)} delta={member.bossAttacksDelta} formatter={formatNumber} />
      </td>
      <td className="numeric">
        <ValueWithDelta value={formatOptionalCompact(member.power)} delta={member.powerDelta} formatter={formatCompact} />
      </td>
      <td>
        <CapturePill member={member} />
      </td>
      <td>
        <StatusPill label={evaluation.status} severity={evaluation.severity} />
      </td>
    </tr>
  );
}

function MemberDetail({
  member,
  rules,
  ranges,
  setRanges,
  sessionRole,
  warningActions,
  updateWarningAction,
}) {
  const rawEvaluation = evaluateMember(member, rules);
  const history = evaluateWarningHistory(dailyHistory(member), rules, member);
  const automaticWarnings = history.flatMap((row) =>
    row.warnings.map((warning) => ({
      ...warning,
      date: row.date,
      id: `${row.date}:${warning.type}`,
      playerId: member.playerId,
      action: warningActions[automaticWarningKey(member.playerId, row.date, warning.type)] ?? defaultWarningAction(),
    })),
  ).sort((left, right) => right.date.localeCompare(left.date));
  const latestWarningDate = history.at(-1)?.date;
  const latestAutomaticWarnings = automaticWarnings.filter((warning) => warning.date === latestWarningDate);
  const actionableWarnings = latestAutomaticWarnings.filter((warning) => !warningActionClosed(warning.action?.status));
  const evaluation = latestAutomaticWarnings.length > 0 && actionableWarnings.length === 0
    ? {
        status: latestAutomaticWarnings.some((warning) => warning.action?.status === "excused") ? "Excused" : "Active",
        severity: "positive",
        flags: [],
      }
    : rawEvaluation;
  const currentHistory = history.find((row) => row.date === currentImportDate());
  const weeklyHistory = filterHistoryByRange(history, "1w");
  const needs = latestAutomaticWarnings.length > 0
    ? actionableWarnings.map((warning) => ({ label: warning.label, severity: warning.severity, detail: warning.detail }))
    : evaluation.flags.map((flag) => ({ label: flag, severity: evaluation.severity, detail: needDetail(flag, member, rules) }));
  const [playerIdDraft, setPlayerIdDraft] = useState("");
  const [identitySaveState, setIdentitySaveState] = useState({ saving: false, error: "" });
  const [statusSaveState, setStatusSaveState] = useState({ saving: false, error: "" });

  function setRange(chart, range) {
    setRanges((current) => ({ ...current, [chart]: range }));
  }

  async function assignPlayerId(event) {
    event.preventDefault();
    const playerId = playerIdDraft.trim();
    if (!/^\d{6,20}$/.test(playerId)) {
      setIdentitySaveState({ saving: false, error: "Player ID must contain 6 to 20 digits." });
      return;
    }
    setIdentitySaveState({ saving: true, error: "" });
    try {
      const response = await fetch("/api/data/member-identities", {
        method: "POST",
        headers: dataActionHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ observedName: member.name, playerId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.link) throw new Error(payload?.error || "Identity save failed.");
      identityLinks = [
        ...identityLinks.filter((link) => link.normalizedName !== payload.link.normalizedName),
        payload.link,
      ];
      members = buildCurrentMembers();
      dashboardDataCache = null;
      window.location.assign(`/members/${encodeURIComponent(playerId)}`);
    } catch (error) {
      setIdentitySaveState({ saving: false, error: error instanceof Error ? error.message : "Identity save failed." });
    }
  }

  async function updateMemberStatus(status) {
    if (!member.playerId || statusSaveState.saving) return;
    setStatusSaveState({ saving: true, error: "" });
    try {
      const response = await fetch("/api/data/member-identities", {
        method: "POST",
        headers: dataActionHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          action: "status",
          playerId: member.playerId,
          observedName: member.name,
          status,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.member) throw new Error(payload?.error || "Member status save failed.");
      dashboardDataCache = null;
      window.location.reload();
    } catch (error) {
      setStatusSaveState({ saving: false, error: error instanceof Error ? error.message : "Member status save failed." });
    }
  }

  return (
    <>
      <div className="detail-actions">
        <a className="secondary-button" href="/members">
          Back to members
        </a>
        <StatusPill label={evaluation.status} severity={evaluation.severity} />
      </div>
      <div className="member-detail-grid">
        <section className="panel detail-hero">
          <div className="detail-title">
            <div>
              <h2>
                {member.name} <NewMemberBadge member={member} rules={rules} />
              </h2>
              <p>
                {member.playerId ?? "Missing ID"} · {roleLabel(member.role)}
              </p>
            </div>
            <DiscordDot member={member} />
          </div>
          <div className="detail-metrics">
            <DetailMetric label="Power" value={formatOptionalCompact(member.power)} delta={member.powerDelta} formatter={formatCompact} />
            <DetailMetric label="Donation" value={formatOptionalNumber(member.contribution7d)} delta={member.contributionDelta} formatter={formatNumber} />
            <DetailMetric label="Boss tries" value={formatOptionalNumber(member.bossAttacks)} delta={member.bossAttacksDelta} formatter={formatNumber} />
            <DetailMetric
              label="Boss damage"
              value={formatOptionalBossDamage(currentHistory?.bossDamage ?? member.bossDamageToday, currentHistory?.bossDamageText ?? member.bossDamageText)}
            />
            <DetailMetric label="Activity" value={activityLabel(member.lastActivityDays, member.activityText)} />
            <DetailMetric label="Joined guild" value={member.joinedAt ?? "Not recorded"} />
          </div>
          {!member.playerId && sessionRole === "admin" ? (
            <form className="identity-assignment" onSubmit={assignPlayerId}>
              <div>
                <strong>Unmatched OCR member</strong>
                <span>Assign the permanent Archero player ID. Existing history with the same observed name will be linked.</span>
              </div>
              <label>
                <span>Player ID</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{6,20}"
                  value={playerIdDraft}
                  onChange={(event) => setPlayerIdDraft(event.target.value.replace(/\D/g, ""))}
                  placeholder="119000000"
                  aria-describedby={identitySaveState.error ? "identity-save-error" : undefined}
                />
              </label>
              <button className="primary-button" type="submit" disabled={identitySaveState.saving}>
                {identitySaveState.saving ? "Saving..." : "Assign ID"}
              </button>
              {identitySaveState.error ? (
                <small className="form-error" id="identity-save-error" role="alert">
                  {identitySaveState.error}
                </small>
              ) : null}
            </form>
          ) : null}
          {member.playerId && sessionRole === "admin" ? (
            <div className="identity-assignment member-status-assignment">
              <div>
                <strong>Guild membership</strong>
                <span>Confirm departures manually so an incomplete screenshot never removes somebody automatically.</span>
              </div>
              <div className="member-status-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={statusSaveState.saving || member.status === "active"}
                  onClick={() => updateMemberStatus("active")}
                >
                  Active
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={statusSaveState.saving || member.status === "left"}
                  onClick={() => updateMemberStatus("left")}
                >
                  Left
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={statusSaveState.saving || member.status === "kicked"}
                  onClick={() => updateMemberStatus("kicked")}
                >
                  Kicked
                </button>
              </div>
              {statusSaveState.error ? <small className="form-error" role="alert">{statusSaveState.error}</small> : null}
            </div>
          ) : null}
        </section>
        <section className="panel">
          <PanelHeading title="Needs" subtitle="Automatic checks against the current rules" />
          <div className="need-list">
            {needs.length === 0 ? (
              <p className="muted">No current rule issue.</p>
            ) : (
              needs.map((need) => (
                <div className="need-row" key={need.label}>
                  <StatusPill label={need.label} severity={need.severity} />
                  <span>{need.detail}</span>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHeading title="Progression graph" subtitle="Power from first captured snapshot to latest" action={<RangeSelector chart="progression" ranges={ranges} setRange={setRange} />} />
          <HistoryChart rows={filterHistoryByRange(history, ranges.progression)} dataKey="power" formatter={formatPowerDetail} emptyText="No power history captured yet." />
        </section>
        <section className="panel">
          <PanelHeading title="Boss damage graph" subtitle="Guild boss damage from first captured snapshot to latest" action={<RangeSelector chart="mi" ranges={ranges} setRange={setRange} />} />
          <HistoryChart rows={filterHistoryByRange(history, ranges.mi)} dataKey="bossDamage" formatter={formatBossDamageText} emptyText="No boss damage captured for this member yet." />
        </section>
        <MemberBossPersonalBests member={member} />
        <section className="panel wide">
          <PanelHeading title="Daily history" subtitle="Captured days in the current week." />
          <HistoryTable rows={weeklyHistory} />
        </section>
        {sessionRole === "admin" ? (
          <AutomaticWarningHistory
            events={automaticWarnings}
            title="Automatic warning history"
            canManage
            onUpdate={updateWarningAction}
          />
        ) : null}
      </div>
    </>
  );
}

function MemberBossPersonalBests({ member }) {
  const rows = memberBossPersonalBests(member);
  const recordedCount = rows.filter((row) => row.record).length;
  return (
    <section className="panel wide">
      <PanelHeading title="PB by boss" subtitle={`${recordedCount}/${BOSS_ROTATION.length} bosses with a recorded personal best.`} />
      <div className="member-boss-pb-grid">
        {rows.map(({ boss, record }) => (
          <article className={record ? "member-boss-pb-card" : "member-boss-pb-card empty"} key={boss.key}>
            <header>
              <BossIcon boss={boss} />
              <div>
                <h3>{boss.name}</h3>
                <span className="muted">{boss.dayLabel}</span>
              </div>
            </header>
            {record ? (
              <div className="member-boss-pb-score">
                <strong>{formatBossDamageText(record.damage, record.damageText)}</strong>
                <span>{record.date}</span>
                <small>{record.rank ? `Game rank ${record.rank}` : "No game rank"}</small>
              </div>
            ) : (
              <p className="muted">No record yet.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Rankings() {
  const latestWeeklyDonation = latestWeeklyDonationLeaders();
  const groups = [
    { title: "Top donation", subtitle: latestWeeklyDonation.label, rows: latestWeeklyDonation.rows, valueKey: "peak", formatter: formatCompact },
    { title: "Top boss damage", subtitle: "Best single-day boss damage", rows: topBossDamageRecords(), valueKey: "bossDamageToday", formatter: formatBossDamageText },
    { title: "Top progression", subtitle: "Latest captured day vs previous capture", rows: topDailyPowerProgression(), valueKey: "powerDelta", formatter: signedCompact },
  ];
  return (
    <div className="rankings-grid">
      {groups.map(({ title, subtitle, rows, valueKey, formatter }) => (
        <section className="panel" key={title}>
          <PanelHeading title={title} subtitle={subtitle} />
          <div className="ranking-list">
            {rows.length === 0 ? (
              <p className="muted">No verified ranking data yet.</p>
            ) : (
              rows.map((member, index) => (
                <div className="ranking-row" key={`${title}-${memberKey(member)}`}>
                  <span className="rank-number">{index + 1}</span>
                  <strong>{member.name}</strong>
                  <span>{formatter(member[valueKey])}</span>
                </div>
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function HistoryView({ rules, sessionRole, warningActions, updateWarningAction }) {
  const currentMembers = currentMembersList();
  const automaticWarnings = currentMembers
    .flatMap((member) =>
      warningHistoryEvents(dailyHistory(member), rules, member).map((warning) => ({
        ...warning,
        member,
        playerId: member.playerId,
        action: warningActions[automaticWarningKey(member.playerId, warning.date, warning.type)] ?? defaultWarningAction(),
      })),
    )
    .sort((left, right) => right.date.localeCompare(left.date) || left.member.name.localeCompare(right.member.name));
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <PanelHeading title="Roster history" subtitle="Human review to confirm by an officer" />
        <EventList events={changes} />
      </section>
      <section className="panel">
        <PanelHeading title="Announced absences" subtitle="Excused members are not pushed into the watch list" />
        <p className="muted">No announced absences recorded yet.</p>
      </section>
      {sessionRole === "admin" ? (
        <AutomaticWarningHistory
          events={automaticWarnings}
          title="Automatic warning history"
          showMember
          canManage
          onUpdate={updateWarningAction}
        />
      ) : null}
    </div>
  );
}

function RulesView({ rules, setRules }) {
  const ruleRows = [
    ["maxInactiveDays", "Absent", "days without activity", "High alert", "number"],
    ["minContribution7d", "Low donation", "minimum 7-day donation", "Medium alert", "number"],
    ["minPowerGrowth14dPercent", "Low progression", "minimum 14-day power growth %", "Medium alert", "number"],
    ["minBossTries", "Missed boss", "minimum boss tries per event day", "High alert", "number"],
    ["newMemberGraceDays", "New member", "grace period in days", "Rule pause", "number"],
    ["memberCapacity", "Capacity", "guild member slots", "Free slot tracking", "number"],
  ];
  return (
    <div className="settings-grid">
      {ruleRows.map(([key, name, label, effect]) => (
        <section className="panel" key={key}>
          <label className="rule-row">
            <strong>{name}</strong>
            <span>{label}</span>
            <input
              className="rule-input"
              type="number"
              min="0"
              step={key === "minPowerGrowth14dPercent" ? "0.1" : "1"}
              value={rules[key]}
              onChange={(event) => setRules((current) => ({ ...current, [key]: Number(event.target.value) }))}
            />
            <span className="muted">{effect}</span>
          </label>
        </section>
      ))}
    </div>
  );
}

function ChartPanel({ title, subtitle, badge, action, values, label, value, positive, xLabels = [], showPoints = false, pointValueMode = "all" }) {
  const { line, area, points } = chartGeometry(values, 720, 230);
  const pointRadius = values.length > 12 ? 3 : 5;
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {action ?? <StatusPill label={badge} severity={positive ? "positive" : "neutral"} />}
      </div>
      <div className="chart">
        {values.length === 0 ? (
          <div className="chart-empty">No captured data for this range.</div>
        ) : (
          <svg viewBox="0 0 720 230" role="img" aria-label={`${label}: ${value}`}>
            {xLabels.length > 0 && <path className="chart-grid-line" d="M 34 196 L 686 196" />}
            <path className="chart-area" d={area} />
            <path className="chart-line" d={line} />
            {showPoints &&
              points.map((point, index) => (
                <g key={`${xLabels[index] ?? index}-${values[index]}`}>
                  <circle className="chart-point" cx={point.x} cy={point.y} r={pointRadius} />
                  {shouldShowPointValue(index, points.length, pointValueMode) && (
                    <text className="chart-value-label" x={point.x} y={chartPointValueY(point.y)} textAnchor={chartPointTextAnchor(index, points.length)}>
                      {formatCompact(values[index])}
                    </text>
                  )}
                  {xLabels[index] && (
                    <text className="chart-axis-label" x={point.x} y="216" textAnchor={chartPointTextAnchor(index, points.length)}>
                      {xLabels[index]}
                    </text>
                  )}
                </g>
              ))}
            <text className="chart-label" x="22" y="24">
              {label}
            </text>
            {!showPoints && (
              <text className="chart-label" x="698" y="24" textAnchor="end">
                {value}
              </text>
            )}
          </svg>
        )}
      </div>
    </section>
  );
}

function chartPointTextAnchor(index, pointCount) {
  if (index === 0) return "start";
  if (index === pointCount - 1) return "end";
  return "middle";
}

function chartPointValueY(pointY) {
  return pointY < 60 ? pointY + 24 : pointY - 12;
}

function shouldShowPointValue(index, pointCount, mode) {
  if (mode === "none") return false;
  if (mode === "last") return index === pointCount - 1;
  if (mode === "auto") return pointCount <= 7 || index === pointCount - 1;
  return true;
}

function chartGeometry(values, width, height) {
  if (values.length === 0) return { line: "", area: "", points: [] };

  const padding = { left: 34, right: 34, top: 42, bottom: 34 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const drawableWidth = width - padding.left - padding.right;
  const drawableHeight = height - padding.top - padding.bottom;
  const step = values.length > 1 ? drawableWidth / (values.length - 1) : 0;
  const points = values.map((chartValue, index) => ({
    x: padding.left + index * step,
    y: padding.top + ((max - chartValue) / range) * drawableHeight,
  }));
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points.at(-1);
  const baseline = height - padding.bottom;
  const area = `${line} L ${last.x.toFixed(1)} ${baseline} L ${first.x.toFixed(1)} ${baseline} Z`;
  return { line, area, points };
}

function HistoryChart({ rows, dataKey, formatter, emptyText }) {
  const points = rows
    .map((row, index) => ({ date: row.date, value: row[dataKey], slotIndex: index }))
    .filter((point) => typeof point.value === "number");
  if (points.length === 0) return <div className="chart-empty">{emptyText}</div>;
  const width = 720;
  const height = 230;
  const padding = 28;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const paddingValue = Math.max(1, Math.abs(average) * 0.01, (max - min) * 0.25);
  const scaleMin = Math.max(0, min - paddingValue);
  const scaleMax = max + paddingValue;
  const range = Math.max(1, scaleMax - scaleMin);
  const slots = Math.max(rows.length, points.length, 1);
  const coordinates = points.map((point) => {
    const x = slots === 1 ? width / 2 : padding + (point.slotIndex * (width - padding * 2)) / (slots - 1);
    const y = height - padding - ((point.value - scaleMin) / range) * (height - padding * 2);
    return { ...point, x, y };
  });
  const valueDates = new Set(points.map((point) => point.date));
  const line = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const latest = coordinates.at(-1);
  return (
    <div className="detail-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${formatter(latest.value)} on ${latest.date}`}>
        <path className="chart-grid-line" d={`M ${padding} ${height - padding} L ${width - padding} ${height - padding}`} />
        {rows.map((row, index) => {
          const x = rows.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (rows.length - 1);
          return (
            <g key={row.date}>
              <path className="chart-tick-line" d={`M ${x.toFixed(1)} ${height - padding - 4} L ${x.toFixed(1)} ${height - padding + 4}`} />
              {!valueDates.has(row.date) ? <circle className="chart-missing-point" cx={x.toFixed(1)} cy={height - padding} r="3" /> : null}
              <text className="chart-axis-label" x={x.toFixed(1)} y={height - 8} textAnchor="middle">
                {formatShortDate(row.date)}
              </text>
            </g>
          );
        })}
        {coordinates.length > 1 ? <path className="chart-area" d={`${line} L ${latest.x.toFixed(1)} ${height - padding} L ${coordinates[0].x.toFixed(1)} ${height - padding} Z`} /> : null}
        <path className="chart-line" d={line} />
        {coordinates.map((point) => (
          <circle className="chart-point" cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r="5" key={point.date} />
        ))}
        {coordinates.map((point, index) => (
          <text className="chart-value-label" x={point.x.toFixed(1)} y={chartValueLabelY(point, index).toFixed(1)} textAnchor="middle" key={`${point.date}-value`}>
            {formatter(point.value)}
          </text>
        ))}
        <text className="chart-label" x={padding} y="24">
          {rows[0]?.date ?? points[0].date}
        </text>
        <text className="chart-label" x={width - padding} y="24" textAnchor="end">
          {rows.at(-1)?.date ?? latest.date}
        </text>
      </svg>
    </div>
  );
}

function chartValueLabelY(point, index) {
  return Math.max(18, point.y - 12 - (index % 2) * 8);
}

function HistoryTable({ rows }) {
  if (rows.length === 0) return <p className="muted">No captured daily history for this member yet.</p>;
  return (
    <div className="table-wrap compact-table-wrap">
      <table className="detail-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Power</th>
            <th>Donation</th>
            <th>Boss tries</th>
            <th>Boss damage</th>
            <th>Activity</th>
            <th>Warnings</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <td>{row.date}</td>
              <td>
                <ValueWithDelta value={formatOptionalPower(row.power)} delta={row.powerDelta} formatter={formatCompact} />
              </td>
              <td>
                <ValueWithDelta value={formatOptionalNumber(row.donation)} delta={row.donationDelta} formatter={formatNumber} />
              </td>
              <td>
                <ValueWithDelta value={formatOptionalNumber(row.bossAttacks)} delta={row.bossAttacksDelta} formatter={formatNumber} />
              </td>
              <td>
                <ValueWithDelta value={formatOptionalBossDamage(row.bossDamage, row.bossDamageText)} delta={row.bossDamageDelta} formatter={formatBossDamageText} />
              </td>
              <td>{row.activity}</td>
              <td>
                <div className="warning-tag-list">
                  {(row.warnings ?? []).length > 0
                    ? row.warnings.map((warning) => (
                        <StatusPill label={warning.label} severity={warning.severity} key={warning.type} />
                      ))
                    : <span className="muted">—</span>}
                </div>
              </td>
              <td>
                <span className="muted">{row.source}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutomaticWarningHistory({ events, title, showMember = false, canManage = false, onUpdate }) {
  const visibleEvents = events.slice(0, 100);
  return (
    <section className="panel wide">
      <PanelHeading
        title={title}
        subtitle={`${events.length} rule warning(s) recorded; they remain visible after the current status is resolved.`}
      />
      <div className="event-list">
        {events.length === 0 ? (
          <p className="muted">No automatic warnings recorded yet.</p>
        ) : (
          visibleEvents.map((event) => (
            <AutomaticWarningEvent
              event={event}
              showMember={showMember}
              canManage={canManage}
              onUpdate={onUpdate}
              key={`${showMember ? memberKey(event.member) : "member"}-${event.id}`}
            />
          ))
        )}
      </div>
    </section>
  );
}

function AutomaticWarningEvent({ event, showMember, canManage, onUpdate }) {
  const action = event.action ?? defaultWarningAction();
  const [note, setNote] = useState(action.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setNote(action.note ?? "");
  }, [action.note]);

  async function save(nextAction) {
    if (!canManage || !onUpdate || saving) return;
    setSaving(true);
    setError("");
    try {
      await onUpdate(event, nextAction);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save warning status.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="event-item warning-history-item">
      <header>
        <strong>{showMember ? event.member.name : event.label}</strong>
        <span className="muted">{event.date}</span>
      </header>
      <div className="warning-history-labels">
        {showMember ? <StatusPill label={event.label} severity={event.severity} /> : null}
        <StatusPill label={warningActionLabel(action.status)} severity={warningActionSeverity(action.status)} />
      </div>
      <span>{event.detail}</span>
      {canManage ? (
        <div className="warning-action-editor">
          <button
            type="button"
            className="secondary-button"
            disabled={saving}
            onClick={() => save({
              ...action,
              status: action.status === "ignored" ? "pending" : "ignored",
              note,
            })}
          >
            {saving ? "Saving…" : action.status === "ignored" ? "Restore warning" : "Ignore warning"}
          </button>
          <label>
            Officer follow-up
            <select
              value={action.status}
              disabled={saving}
              onChange={(changeEvent) => save({ ...action, status: changeEvent.target.value, note })}
            >
              <option value="pending">To review</option>
              <option value="noted">Noted</option>
              <option value="contacted">Member contacted</option>
              <option value="excused">Excused / announced</option>
              <option value="resolved">Resolved</option>
              <option value="ignored">Ignored</option>
            </select>
          </label>
          <label>
            Note
            <input
              value={note}
              maxLength={500}
              placeholder="Optional officer note"
              onChange={(changeEvent) => setNote(changeEvent.target.value)}
            />
          </label>
          <button type="button" className="secondary-button" disabled={saving} onClick={() => save({ ...action, note })}>
            {saving ? "Saving…" : "Save note"}
          </button>
        </div>
      ) : action.note ? <small className="muted">{action.note}</small> : null}
      {action.updatedAt ? <small className="muted">Follow-up updated {formatDateTime(action.updatedAt)}</small> : null}
      {error ? <small className="form-error">{error}</small> : null}
    </article>
  );
}

function PanelHeading({ title, subtitle, action }) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function RangeSelector({ chart, ranges, setRange }) {
  return (
    <div className="range-selector" aria-label="Chart range">
      {[
        ["1w", "1W"],
        ["1m", "1M"],
        ["all", "All"],
      ].map(([value, label]) => (
        <button className={ranges[chart] === value ? "active" : ""} type="button" onClick={() => setRange(chart, value)} key={value}>
          {label}
        </button>
      ))}
    </div>
  );
}

function DashboardRangeSelector({ value, onChange }) {
  return (
    <div className="range-selector" aria-label="Dashboard chart range">
      {[
        ["1w", "1W"],
        ["1m", "30D"],
        ["all", "All"],
      ].map(([range, label]) => (
        <button className={value === range ? "active" : ""} type="button" onClick={() => onChange(range)} key={range}>
          {label}
        </button>
      ))}
    </div>
  );
}

function EventList({ events }) {
  return (
    <div className="event-list">
      {events.map((event) => (
        <article className="event-item" key={event.title}>
          <header>
            <strong>{event.title}</strong>
            <span className="muted">{event.at}</span>
          </header>
          <span>{event.detail}</span>
        </article>
      ))}
    </div>
  );
}

function StatusPill({ label, severity }) {
  return <span className={`status-pill ${severity}`}>{displayLabel(label)}</span>;
}

function HistoryDateSelector({ rows, selectedDate, selectedIndex, previousRow, onSelect, onPrevious, onNext }) {
  const hasRows = rows.length > 0;
  return (
    <div className="history-date-selector" aria-label="Member history date selector">
      <button className="secondary-button compact-action" type="button" onClick={onPrevious} disabled={!hasRows || selectedIndex <= 0}>
        Previous
      </button>
      <label>
        <span>Date</span>
        <select value={selectedDate} onChange={(event) => onSelect(event.target.value)} disabled={!hasRows}>
          {hasRows ? (
            rows.map((row) => (
              <option key={row.date} value={row.date}>
                {row.date}
              </option>
            ))
          ) : (
            <option value={selectedDate}>No capture</option>
          )}
        </select>
      </label>
      <button className="secondary-button compact-action" type="button" onClick={onNext} disabled={!hasRows || selectedIndex >= rows.length - 1}>
        Next
      </button>
      <small>{previousRow ? `Compared with ${previousRow.date}` : "First captured day"}</small>
    </div>
  );
}

function CapturePill({ member }) {
  if (["inactive", "left", "kicked"].includes(member.status)) return <span className="muted">Former</span>;
  if (!member.playerId) return <span className="muted">Missing ID</span>;
  if (!member.lastSeenAt) return <span className="muted">Not seen</span>;
  return <time dateTime={member.lastSeenAt}>{member.lastSeenAt}</time>;
}

function DiscordDot({ member }) {
  const label = member.discordLinked ? "Member is on Discord" : "Member is not linked on Discord";
  return (
    <span className={`discord-dot ${member.discordLinked ? "linked" : "missing"}`} title={label} aria-label={label}>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function displayLabel(label) {
  return {
    Active: "Active",
    Watch: "Watch",
    Absent: "Absent",
    Left: "Left",
    Kicked: "Kicked",
    Excused: "Excused",
    "Needs review": "Needs review",
    "Not recorded": "Not recorded",
    "Missing ID": "Missing ID",
    "Not in current guild": "Not in current guild",
    "Game absence": "Game absence",
    "Low contribution": "Low contribution",
    "Low progression": "Low progression",
    "Missed boss": "Missed boss",
    "New member grace period": "New member grace period",
    "OCR only": "OCR only",
    "Damage only": "Damage only",
    Matched: "Match",
  }[label] ?? label;
}

function DetailMetric({ label, value, delta, formatter }) {
  return (
    <div className="detail-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {typeof delta === "number" ? <small className={`delta ${delta > 0 ? "positive" : "neutral"}`}>{signedFormatted(delta, formatter)}</small> : null}
    </div>
  );
}

function ValueWithDelta({ value, delta, formatter }) {
  if (typeof delta !== "number") return value;
  return (
    <span className="value-stack">
      <span>{value}</span>
      <span className={`delta ${delta > 0 ? "positive" : "neutral"}`}>{signedFormatted(delta, formatter)}</span>
    </span>
  );
}

function NewMemberBadge({ member, rules }) {
  const day = newMemberDay(member, rules);
  return day == null ? null : <span className="new-member-tag">New +{day}j</span>;
}

function useStoredRules() {
  const initialRules = useMemo(() => normalizeRules({ ...defaultRules, currentDate: currentImportDate() }), []);
  const [rules, setRules] = useState(initialRules);
  const hydrated = useRef(false);
  useEffect(() => {
    let browserRules = initialRules;
    try {
      const stored = JSON.parse(localStorage.getItem(RULES_STORAGE_KEY) ?? "{}");
      browserRules = normalizeRules({ ...defaultRules, ...stored, currentDate: currentImportDate() });
      setRules(browserRules);
    } catch {
      setRules(initialRules);
    }
    let active = true;
    fetch("/api/data/rules")
      .then((response) => (response.ok ? response.json() : null))
      .then(async (payload) => {
        if (active && payload?.rules) {
          setRules(normalizeRules({ ...defaultRules, ...payload.rules, currentDate: currentImportDate() }));
          return;
        }
        if (active && payload?.ok && window.location.pathname.startsWith("/admin")) {
          const { currentDate, ...persistedRules } = browserRules;
          const response = await fetch("/api/data/rules", {
            method: "PUT",
            headers: { "content-type": "application/json", "x-archero-dashboard-action": "1" },
            body: JSON.stringify({ rules: persistedRules }),
          });
          if (!response.ok) return;
          const saved = await response.json();
          if (active && saved?.rules) {
            setRules(normalizeRules({ ...defaultRules, ...saved.rules, currentDate: currentImportDate() }));
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) hydrated.current = true;
      });
    return () => {
      active = false;
    };
  }, [initialRules]);
  useEffect(() => {
    if (!hydrated.current) return;
    const { currentDate, ...persistedRules } = rules;
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(persistedRules));
    if (window.location.pathname.startsWith("/admin")) {
      fetch("/api/data/rules", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-archero-dashboard-action": "1" },
        body: JSON.stringify({ rules: persistedRules }),
      }).catch(() => {});
    }
  }, [rules]);
  return [rules, setRules];
}

function buildKickedCandidates(latestDate) {
  if (!latestDate) return [];
  return members
    .map((member) => memberSnapshotForDate(member, latestDate))
    .filter((member) => member.status === "kicked" && member.verificationNote?.startsWith("Missing from latest import"));
}

function buildDailyPowerStats() {
  const dailyStats = Array.isArray(dailyRawSnapshots)
    ? dailyRawSnapshots
        .slice()
        .sort((left, right) => left.date.localeCompare(right.date))
        .map((day) => {
          const powers = (day.rows ?? [])
            .filter((row) => isCurrentPlayerId(row.playerId) && typeof row.power === "number")
            .map((row) => row.power);
          return powers.length > 0
            ? {
                date: day.date,
                average: Math.round(powers.reduce((sum, power) => sum + power, 0) / powers.length),
                median: medianNumber(powers),
                count: powers.length,
              }
            : null;
        })
        .filter(Boolean)
    : [];

  if (dailyStats.length > 0) return dailyStats;

  const currentPowers = memberSnapshots
    .filter((member) => isCurrentPlayerId(member.playerId) && typeof member.power === "number")
    .map((member) => member.power);
  if (currentPowers.length === 0) {
    return (captures.averagePower8w ?? []).map((value, index) => ({
      date: `Point ${index + 1}`,
      average: value,
      median: value,
      count: 0,
    }));
  }
  return [
    {
      date: currentImportDate(),
      average: Math.round(currentPowers.reduce((sum, power) => sum + power, 0) / currentPowers.length),
      median: medianNumber(currentPowers),
      count: currentPowers.length,
    },
  ];
}

function medianNumber(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function buildDailyDonationStats() {
  return (Array.isArray(dailyRawSnapshots) ? dailyRawSnapshots : [])
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => {
      const rows = (day.rows ?? []).filter((row) => isCurrentPlayerId(row.playerId) && typeof row.contribution7d === "number");
      return rows.length > 0
        ? {
            date: day.date,
            total: rows.reduce((sum, row) => sum + row.contribution7d, 0),
            count: rows.length,
          }
        : null;
    })
    .filter(Boolean);
}

function buildWeeklyDonationStats() {
  const weeks = weeklyDonationBuckets();
  return [...weeks.values()]
    .map((week) => {
      const peaks = [...week.members.values()];
      const leader = [...peaks].sort((left, right) => right.peak - left.peak || left.name.localeCompare(right.name))[0] ?? null;
      return {
        date: week.weekStart,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        total: peaks.reduce((sum, member) => sum + member.peak, 0),
        count: peaks.length,
        leader,
      };
    })
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart));
}

function latestWeeklyDonationLeaders(limit = 5) {
  const weeks = buildWeeklyDonationStats();
  const latest = weeks.at(-1);
  if (!latest) return { label: "No weekly donation capture", rows: [] };
  const bucket = weeklyDonationBuckets().get(latest.weekStart);
  const rows = [...(bucket?.members.values() ?? [])]
    .sort((left, right) => right.peak - left.peak || left.name.localeCompare(right.name))
    .slice(0, limit);
  return {
    label: `Week of ${formatShortDate(latest.weekStart)} - ${formatShortDate(latest.weekEnd)}`,
    rows,
  };
}

function weeklyDonationBuckets() {
  const weeks = new Map();
  const rosterNames = new Map(guildRoster.filter((entry) => isCurrentPlayerId(entry.playerId)).map((entry) => [entry.playerId, entry.name]));
  for (const day of Array.isArray(dailyRawSnapshots) ? dailyRawSnapshots : []) {
    const weekStart = weekStartIso(day.date);
    if (!weekStart) continue;
    const weekEnd = addDaysIso(weekStart, 6);
    const week = weeks.get(weekStart) ?? { weekStart, weekEnd, members: new Map() };
    for (const row of day.rows ?? []) {
      if (!isCurrentPlayerId(row.playerId) || typeof row.contribution7d !== "number") continue;
      const previous = week.members.get(row.playerId);
      if (!previous || row.contribution7d > previous.peak || (row.contribution7d === previous.peak && day.date.localeCompare(previous.date) > 0)) {
        week.members.set(row.playerId, {
          playerId: row.playerId,
          name: rosterNames.get(row.playerId) ?? row.playerId,
          peak: row.contribution7d,
          date: day.date,
          metricsVerified: true,
        });
      }
    }
    weeks.set(weekStart, week);
  }
  return weeks;
}

function filterDatedChartRows(rows, range) {
  if (range === "all" || rows.length === 0) return rows;
  const latest = Math.max(...rows.map((row) => Date.parse(`${row.date}T00:00:00`)));
  const cutoff =
    range === "1w"
      ? startOfWeek(new Date(latest)).getTime()
      : latest - 29 * 86_400_000;
  return rows.filter((row) => Date.parse(`${row.date}T00:00:00`) >= cutoff);
}

function buildBossDashboardData() {
  const dates = Array.isArray(dailyBossRawSnapshots) ? dailyBossRawSnapshots.map((day) => day.date).sort((left, right) => left.localeCompare(right)) : [];
  const rosterNames = new Map(guildRoster.filter((entry) => isCurrentPlayerId(entry.playerId)).map((entry) => [entry.playerId, entry.name]));
  const playersById = new Map();
  const latestDate = dates.at(-1) ?? currentIsoDate();
  const bossesByDate = new Map((dailyBossRawSnapshots ?? []).map((day) => [day.date, bossForSnapshot(day)]));
  const activeBoss = bossesByDate.get(latestDate) ?? bossForDate(latestDate);

  for (const day of dailyBossRawSnapshots ?? []) {
    const boss = bossForSnapshot(day);
    for (const row of day.rows ?? []) {
      if (!isCurrentPlayerId(row.playerId) || typeof row.bossDamageToday !== "number") continue;
      const current = playersById.get(row.playerId) ?? {
        playerId: row.playerId,
        name: row.name ?? rosterNames.get(row.playerId) ?? row.playerId,
        pointsByDate: new Map(),
      };
      current.name = row.name ?? current.name;
      const existingDamage = current.pointsByDate.get(day.date)?.damage;
      if (typeof existingDamage !== "number" || row.bossDamageToday > existingDamage) {
        current.pointsByDate.set(day.date, {
          date: day.date,
          damage: row.bossDamageToday,
          rank: row.bossRank ?? null,
          bossKey: boss.key,
          bossName: boss.name,
          bossIcon: boss.icon,
        });
      }
      playersById.set(row.playerId, current);
    }
  }

  const players = [...playersById.values()]
    .map((player, index) => {
      const points = [...player.pointsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
      return {
        playerId: player.playerId,
        name: player.name,
        color: bossSeriesColor(index),
        points,
        latestDamage: points.at(-1)?.damage ?? null,
      };
    })
    .sort((left, right) => (right.latestDamage ?? 0) - (left.latestDamage ?? 0) || left.name.localeCompare(right.name));

  players.forEach((player, index) => {
    player.color = bossSeriesColor(index);
    player.globalBest = [...player.points].sort((left, right) => right.damage - left.damage || left.date.localeCompare(right.date))[0] ?? null;
    player.bestByBoss = bossBestPointsByBoss(player.points);
    player.points = player.points.map((point) => {
      const bossBest = player.bestByBoss.get(point.bossKey);
      return {
        ...point,
        isGlobalPb: player.globalBest?.date === point.date && player.globalBest?.damage === point.damage,
        isBossPb: bossBest?.date === point.date && bossBest?.damage === point.damage,
      };
    });
  });

  return {
    dates,
    latestDate,
    activeBoss,
    bossesByDate,
    players,
    dailyRankings: bossDailyRankings(players),
    bestDayRecords: bossBestDayRecords(players),
    bestByBossRecords: bossBestByBossRecords(players),
  };
}

function currentIsoDate() {
  return localIsoDate();
}

function bossForKey(key) {
  return BOSS_ROTATION.find((boss) => boss.key === key) ?? BOSS_ROTATION[0];
}

function bossForDate(date) {
  return bossDefinitionForDate(date, BOSS_ROTATION) ?? BOSS_ROTATION[0];
}

function bossForSnapshot(snapshot) {
  return bossDefinitionForSnapshot(snapshot, BOSS_ROTATION) ?? BOSS_ROTATION[0];
}

function bossBestPointsByBoss(points) {
  const bestByBoss = new Map();
  for (const point of points) {
    const previous = bestByBoss.get(point.bossKey);
    if (!previous || point.damage > previous.damage || (point.damage === previous.damage && point.date.localeCompare(previous.date) < 0)) {
      bestByBoss.set(point.bossKey, point);
    }
  }
  return bestByBoss;
}

function bossPlayerSelection(players, limit) {
  return new Set(players.slice(0, limit).map((player) => player.playerId));
}

function bossDailyRankings(players) {
  const rowsByDate = new Map();
  for (const player of players) {
    for (const point of player.points) {
      rowsByDate.set(point.date, [
        ...(rowsByDate.get(point.date) ?? []),
        {
          playerId: player.playerId,
          name: player.name,
          damage: point.damage,
          bossRank: point.rank,
          bossKey: point.bossKey,
          bossName: point.bossName,
          isGlobalPb: point.isGlobalPb,
          isBossPb: point.isBossPb,
        },
      ]);
    }
  }
  return [...rowsByDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, rows]) => ({
      date,
      boss: bossForKey(rows[0]?.bossKey),
      rows: rows.sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name)),
    }));
}

function topBossDamageRecords(limit = 5) {
  const bestByPlayer = new Map();
  for (const day of Array.isArray(dailyBossRawSnapshots) ? dailyBossRawSnapshots : []) {
    for (const row of day.rows ?? []) {
      if (!isCurrentPlayerId(row.playerId) || !row.name || typeof row.bossDamageToday !== "number") continue;
      const previous = bestByPlayer.get(row.playerId);
      if (!previous || row.bossDamageToday > previous.bossDamageToday) {
        bestByPlayer.set(row.playerId, {
          playerId: row.playerId,
          rowId: `${day.date}-${row.playerId}`,
          name: row.name,
          bossDamageToday: row.bossDamageToday,
          date: day.date,
          metricsVerified: true,
        });
      }
    }
  }
  return [...bestByPlayer.values()]
    .sort((left, right) => right.bossDamageToday - left.bossDamageToday || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function memberBossPersonalBests(member) {
  if (!member?.playerId) return BOSS_ROTATION.map((boss) => ({ boss, record: null }));

  const bestByBoss = new Map();
  for (const day of Array.isArray(dailyBossRawSnapshots) ? dailyBossRawSnapshots : []) {
    const boss = bossForSnapshot(day);
    for (const row of day.rows ?? []) {
      if (row.playerId !== member.playerId || typeof row.bossDamageToday !== "number") continue;
      const previous = bestByBoss.get(boss.key);
      if (!previous || row.bossDamageToday > previous.damage || (row.bossDamageToday === previous.damage && day.date.localeCompare(previous.date) > 0)) {
        bestByBoss.set(boss.key, {
          bossKey: boss.key,
          bossName: boss.name,
          date: day.date,
          damage: row.bossDamageToday,
          damageText: row.damageText ?? null,
          rank: row.bossRank ?? null,
        });
      }
    }
  }

  return BOSS_ROTATION.map((boss) => ({ boss, record: bestByBoss.get(boss.key) ?? null }));
}

function topDailyPowerProgression(limit = 5) {
  const latestDate = memberHistoryDates(members).at(-1);
  if (!latestDate) return [];
  return currentMembersList()
    .map((member) => memberSnapshotForDate(member, latestDate))
    .filter((member) => typeof member.powerDelta === "number")
    .sort((left, right) => right.powerDelta - left.powerDelta || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function bossBestDayRecords(players) {
  return players
    .map((player) => {
      const best = [...player.points].sort((left, right) => right.damage - left.damage)[0];
      return best
        ? {
            playerId: player.playerId,
            name: player.name,
            date: best.date,
            damage: best.damage,
            bossKey: best.bossKey,
            bossName: best.bossName,
            boss: bossForKey(best.bossKey),
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name));
}

function bossBestByBossRecords(players) {
  return BOSS_ROTATION.map((boss) => ({
    boss,
    rows: players
      .map((player) => {
        const best = player.bestByBoss?.get(boss.key);
        return best
          ? {
              playerId: player.playerId,
              name: player.name,
              date: best.date,
              damage: best.damage,
              bossKey: boss.key,
              bossName: boss.name,
            }
          : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name)),
  }));
}

function bossPointTitle(player, point) {
  return [
    player.name,
    `${point.bossName} - ${point.date}`,
    `Damage: ${formatBossDamageText(point.damage)}`,
    point.rank ? `Game rank: ${point.rank}` : "Game rank: unknown",
    point.isGlobalPb ? "Global PB" : null,
    point.isBossPb ? `PB on ${point.bossName}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function bossSeriesColor(index) {
  const colors = [
    "oklch(52% 0.15 225)",
    "oklch(52% 0.14 155)",
    "oklch(58% 0.17 35)",
    "oklch(50% 0.15 300)",
    "oklch(56% 0.15 80)",
    "oklch(48% 0.12 190)",
    "oklch(56% 0.16 15)",
    "oklch(44% 0.12 265)",
    "oklch(60% 0.14 135)",
    "oklch(46% 0.12 25)",
  ];
  return colors[index % colors.length];
}

function memberHistoryDates(memberRows) {
  const acceptedDates = acceptedSnapshotDates(dailyRawSnapshots.map((snapshot) => snapshot?.date));
  if (acceptedDates.length > 0) return acceptedDates;
  return acceptedSnapshotDates(memberRows.flatMap((member) => dailyHistory(member).map((row) => row.date)));
}

function memberSnapshotForDate(member, date) {
  const row = dailyHistory(member).find((historyRow) => historyRow.date === date);
  if (!row) {
    const status = member.status;
    return {
      ...member,
      status,
      metricsCaptured: false,
      metricsVerified: false,
      power: null,
      powerDelta: null,
      contribution7d: null,
      contributionDelta: null,
      bossAttacks: null,
      bossAttacksDelta: null,
      bossDamageToday: null,
      bossDamageDelta: null,
      lastActivityDays: null,
      activityText: null,
      lastSeenAt: null,
      verificationNote: isFormerStatus(status) ? `Missing from latest import on ${date}` : `No capture on ${date}`,
    };
  }
  return {
    ...member,
    metricsCaptured: true,
    metricsVerified: true,
    power: row.power,
    powerDelta: row.powerDelta,
    contribution7d: row.donation,
    contributionDelta: row.donationDelta,
    bossAttacks: row.bossAttacks,
    bossAttacksDelta: row.bossAttacksDelta,
    bossDamageToday: row.bossDamage,
    bossDamageText: row.bossDamageText,
    bossDamageDelta: row.bossDamageDelta,
    lastActivityDays: row.lastActivityDays,
    activityText: row.activityText ?? null,
    lastSeenAt: row.date,
    verificationNote: row.source,
  };
}

function dailyHistory(member) {
  const rawHistory = dailySnapshotHistory(member);
  if (rawHistory.length > 0) return rawHistory;
  if (!member.metricsCaptured) return [];
  const snapshotDate = latestDataDate({
    preferred: member.lastSeenAt,
    snapshotDates: [...dailyRawSnapshots, ...dailyBossRawSnapshots].map((snapshot) => snapshot?.date),
    fallbacks: [captures.lastCapturedAt, captures.lastImportedAt],
  });
  if (!snapshotDate) return [];
  const rows = [];
  if (member.previousSnapshot) {
    rows.push({
      date: captureDate(),
      power: member.previousSnapshot.power,
      powerDelta: null,
      donation: member.previousSnapshot.contribution7d,
      donationDelta: null,
      bossAttacks: member.previousSnapshot.bossAttacks,
      bossAttacksDelta: null,
      bossDamage: null,
      bossDamageDelta: null,
      lastActivityDays: member.previousSnapshot.lastActivityDays,
      activityText: member.previousSnapshot.activityText ?? null,
      activity: activityLabel(member.previousSnapshot.lastActivityDays, member.previousSnapshot.activityText),
      source: member.previousSnapshot.verificationNote || "Previous snapshot",
    });
  }
  rows.push(
    {
      date: snapshotDate,
      power: member.power,
      powerDelta: member.powerDelta,
      donation: member.contribution7d,
      donationDelta: member.contributionDelta,
      bossAttacks: member.bossAttacks,
      bossAttacksDelta: member.bossAttacksDelta,
      bossDamage: member.bossDamageToday,
      bossDamageDelta: null,
      lastActivityDays: member.lastActivityDays,
      activityText: member.activityText ?? null,
      activity: activityLabel(member.lastActivityDays, member.activityText),
      source: member.verificationNote || "Current snapshot",
    },
  );
  return rows;
}

function dailySnapshotHistory(member) {
  if (!member.playerId || !Array.isArray(dailyRawSnapshots)) return [];
  const rows = [];
  const bossSnapshotsByDate = dailyBossSnapshotsByDate(member.playerId);
  for (const day of dailyRawSnapshots) {
    const snapshot = day.rows?.find((row) => resolvedSnapshotPlayerId(row) === member.playerId);
    if (!snapshot) continue;
    const previous = rows.at(-1);
    const bossSnapshot = bossSnapshotsByDate.get(day.date);
    const bossDamage = bossSnapshot?.bossDamageToday ?? snapshot.bossDamageToday;
    rows.push({
      date: day.date,
      power: snapshot.power,
      powerDelta: metricDelta(snapshot.power, previous?.power),
      donation: snapshot.contribution7d,
      donationDelta: donationDelta(snapshot.contribution7d, previous?.donation, day.date, previous?.date),
      bossAttacks: snapshot.bossAttacks,
      bossAttacksDelta: metricDelta(snapshot.bossAttacks, previous?.bossAttacks),
      bossDamage,
      bossDamageDelta: metricDelta(bossDamage, previous?.bossDamage),
      bossDamageText: bossSnapshot?.damageText ?? null,
      lastActivityDays: snapshot.lastActivityDays,
      activityText: snapshot.activityText ?? null,
      activity: activityLabel(snapshot.lastActivityDays, snapshot.activityText),
      source: snapshot.verificationNote || "Daily raw snapshot",
    });
  }
  return rows;
}

function dailyBossSnapshotsByDate(playerId) {
  const snapshots = new Map();
  if (!playerId || !Array.isArray(dailyBossRawSnapshots)) return snapshots;
  for (const day of dailyBossRawSnapshots) {
    const snapshot = day.rows?.find(
      (row) => resolvedSnapshotPlayerId(row) === playerId && typeof row.bossDamageToday === "number",
    );
    if (snapshot) snapshots.set(day.date, snapshot);
  }
  return snapshots;
}

function resolvedSnapshotPlayerId(snapshot) {
  return snapshot?.playerId ?? identityPlayerIdForName(snapshot?.name ?? snapshot?.rawName);
}

function metricDelta(current, previous) {
  return typeof current === "number" && typeof previous === "number" ? current - previous : null;
}

function donationDelta(current, previous, currentDate, previousDate) {
  if (typeof current !== "number" || typeof previous !== "number") return null;
  if (previousDate && weekStartIso(currentDate) !== weekStartIso(previousDate) && current < previous) return null;
  return current - previous;
}

function filterHistoryByRange(rows, range) {
  if (range === "all" || rows.length === 0) return rows;
  const days = range === "1m" ? 30 : 7;
  const latest = Math.max(...rows.map((row) => Date.parse(`${row.date}T00:00:00`)));
  const cutoff = range === "1w" ? startOfWeek(new Date(latest)).getTime() : latest - (days - 1) * 86_400_000;
  return rows.filter((row) => Date.parse(`${row.date}T00:00:00`) >= cutoff);
}

function startOfWeek(date) {
  const start = new Date(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
}

function weekStartIso(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return "";
  const current = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - weekday + 1);
  return current.toISOString().slice(0, 10);
}

function addDaysIso(value, days) {
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return value;
  const current = new Date(Date.UTC(year, month - 1, day + days, 12));
  return current.toISOString().slice(0, 10);
}

function formatWeekLabel(value) {
  return `W ${formatShortDate(value)}`;
}

function formatShortDate(date) {
  return date.slice(5);
}

function findMemberByKey(key) {
  return members.find((member) => memberKey(member) === key) ?? null;
}

function memberKey(member) {
  return member.playerId ?? member.rowId;
}

function navigateToMember(member, router) {
  router.push(`/members/${encodeURIComponent(memberKey(member))}`);
}

function roleLabel(role) {
  return { leader: "Leader", officer: "Vice-leader", elder: "Elder", member: "Guild member", boss: "Guild boss" }[role] ?? "Guild member";
}

function rowStateClass(evaluation) {
  if (evaluation.severity === "danger") return "row-danger";
  if (evaluation.severity === "warning") return "row-warning";
  if (evaluation.severity === "positive") return "row-positive";
  return "row-neutral";
}

function isFormerStatus(status) {
  return ["inactive", "left", "kicked"].includes(status);
}

function isCurrentPlayerId(playerId) {
  return typeof playerId === "string" && currentPlayerIds().has(playerId);
}

function currentMembersList() {
  return members.filter((member) => !isFormerStatus(member.status));
}

function currentPlayerIds() {
  return new Set(currentMembersList().filter((member) => member.playerId).map((member) => member.playerId));
}

function filterBossDayToCurrentMembers(day) {
  if (!day) return null;
  return {
    ...day,
    rows: (day.rows ?? []).filter((row) => !row.playerId || isCurrentPlayerId(row.playerId)),
  };
}

function formatOptionalNumber(value) {
  return value == null ? "Not recorded" : formatNumber(value);
}

function formatOptionalCompact(value) {
  return value == null ? "Not recorded" : formatCompact(value);
}

function formatOptionalPower(value) {
  return value == null ? "Not recorded" : formatPowerDetail(value);
}

function formatOptionalBossDamage(value, fallbackText = null) {
  return value == null && !fallbackText ? "Not recorded" : formatBossDamageText(value, fallbackText);
}

function signedCompact(value) {
  if (value == null) return "Not recorded";
  return `${value >= 0 ? "+" : ""}${formatCompact(value)}`;
}

function signedNumber(value) {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function signedFormatted(value, formatter) {
  return `${value >= 0 ? "+" : ""}${formatter(value)}`;
}

function deltaDetail(value) {
  return typeof value === "number" ? `${signedNumber(value)} today` : "No previous snapshot";
}

function deltaLine(member) {
  const parts = [];
  if (typeof member.contributionDelta === "number") parts.push(`Donation ${signedNumber(member.contributionDelta)}`);
  if (typeof member.bossAttacksDelta === "number") parts.push(`Boss tries ${signedNumber(member.bossAttacksDelta)}`);
  if (typeof member.powerDelta === "number") parts.push(`Power ${signedFormatted(member.powerDelta, formatCompact)}`);
  return parts.length > 0 ? parts.join(" · ") : "No previous snapshot";
}

function needDetail(flag, member, rules) {
  if (flag === "Missed boss") return `${member.bossAttacks ?? 0} boss tries recorded, below the ${rules.minBossTries} minimum.`;
  if (flag === "Low contribution") return `${formatNumber(member.contribution7d ?? 0)} donations, below the ${formatNumber(rules.minContribution7d)} rule.`;
  if (flag === "Game absence") return `Last activity is ${activityLabel(member.lastActivityDays, member.activityText)}.`;
  if (flag === "Low progression") return `${member.power14dPercent}% power growth over 14 days.`;
  if (flag === "Not in current guild") return "This record is kept for history but excluded from current guild metrics.";
  if (flag === "Excused absence") return member.absenceReason || "Officer-marked absence.";
  return flag;
}


function annotationLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function automaticWarningKey(playerId, date, type) {
  return `${playerId}:${date}:${type}`;
}

function defaultWarningAction() {
  return { status: "pending", note: "", updatedAt: null };
}

function warningActionLabel(status) {
  return {
    pending: "To review",
    noted: "Noted",
    contacted: "Member contacted",
    excused: "Excused",
    resolved: "Resolved",
    ignored: "Ignored",
  }[status] ?? "To review";
}

function warningActionSeverity(status) {
  if (status === "excused" || status === "resolved" || status === "ignored") return "positive";
  if (status === "contacted") return "warning";
  return "neutral";
}

function warningActionClosed(status) {
  return status === "excused" || status === "resolved" || status === "ignored";
}

function todayLabel() {
  return currentIsoDate();
}

function dataActionLabel(action) {
  return {
    "capture:guild-members": "Guild members capture",
    "capture:guild-boss": "Guild boss capture",
    import: "Synchronize",
    upload: "Upload",
  }[action] ?? action;
}

function dataSuccessMessage(action, payload) {
  const now = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (action.startsWith("capture:")) {
    const capture = payload.capture ?? {};
    return {
      action,
      status: "success",
      title: `${dataActionLabel(action)} saved`,
      detail: capture.path ? `${capture.path} · index ${capture.index ?? "?"}` : "Screenshot saved.",
      at: now,
    };
  }

  const report = payload.import ?? {};
  return {
    action,
    status: "success",
    title: `Synchronized ${report.date ?? "completed"}`,
    detail: `${report.detected_member_rows ?? 0} guild row(s), ${report.detected_boss_rows ?? 0} boss row(s), ${report.extracted_member_metrics ?? 0} member metric(s).`,
    at: now,
  };
}

function addDataMessage(setMessages, message) {
  const at = message.at ?? new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  setMessages((current) => [{ ...message, id: `${Date.now()}-${message.action}`, at }, ...current].slice(0, 8));
}

function importHistoryLabel(job) {
  if (job.status === "failed") return "Rejected";
  if (["queued", "running"].includes(job.status)) return "Running";
  if (!job.result?.quality) return "Legacy / unscored";
  return job.result.quality.status === "accepted_with_warnings" ? "Accepted with warnings" : "Accepted";
}

function importHistorySeverity(job) {
  if (job.status === "failed") return "danger";
  if (!job.result?.quality || job.result.quality.status === "accepted_with_warnings") return "warning";
  return "positive";
}

async function exportMembersImage(rows, rules, filters) {
  const width = 1800;
  const margin = 64;
  const headerHeight = 190;
  const summaryTop = 208;
  const summaryHeight = 112;
  const tableTop = 354;
  const tableHeaderHeight = 58;
  const rowHeight = 58;
  const footerHeight = 76;
  const height = tableTop + tableHeaderHeight + rows.length * rowHeight + footerHeight + margin;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  drawExportBackground(ctx, width, height);
  drawText(ctx, "Archero Guild", margin, 78, { size: 26, weight: 800, color: "#435062" });
  drawText(ctx, "Guild members", margin, 132, { size: 48, weight: 900, color: "#111a25" });
  const filterParts = [
    filters.selectedDate,
    filters.statusFilter !== "all" ? `Filter: ${filters.statusFilter}` : "Current guild",
    filters.query ? `Search: ${filters.query}` : null,
  ].filter(Boolean);
  drawText(ctx, filterParts.join("  -  "), margin, 174, { size: 22, weight: 650, color: "#4b5b6d", maxWidth: 1500 });
  drawText(ctx, `${rows.length} visible member${rows.length === 1 ? "" : "s"}`, width - margin, 132, { size: 22, weight: 850, color: "#435062", align: "right" });

  const evaluations = rows.map((member) => evaluateMember(member, rules));
  const linkedCount = rows.filter((member) => member.discordLinked).length;
  const reviewCount = evaluations.filter((evaluation) => evaluation.severity === "warning" || evaluation.severity === "danger").length;
  const capturedCount = rows.filter((member) => member.metricsCaptured).length;
  const cards = [
    ["Visible members", rows.length],
    ["Discord linked", linkedCount],
    ["Stats captured", capturedCount],
    ["Need attention", reviewCount],
  ];
  const cardGap = 20;
  const cardWidth = (width - margin * 2 - cardGap * 3) / 4;
  cards.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + cardGap);
    ctx.fillStyle = "#ffffff";
    roundedRect(ctx, x, summaryTop, cardWidth, summaryHeight, 12);
    ctx.fill();
    ctx.strokeStyle = "#c8d2dc";
    ctx.lineWidth = 2;
    ctx.stroke();
    drawText(ctx, label, x + 24, summaryTop + 36, { size: 18, weight: 800, color: "#566577" });
    drawText(ctx, String(value), x + 24, summaryTop + 86, { size: 38, weight: 950, color: "#111a25" });
  });

  drawMembersExportTable(ctx, rows, evaluations, margin, tableTop, width - margin * 2, tableHeaderHeight, rowHeight);
  drawText(ctx, `Generated by Archero Observer on ${new Date().toLocaleString("en-GB")}`, margin, height - 52, { size: 18, weight: 650, color: "#667588" });
  downloadCanvas(canvas, `archero-members-${filters.selectedDate || currentIsoDate()}.png`);
}

function drawMembersExportTable(ctx, rows, evaluations, x, y, width, headerHeight, rowHeight) {
  const columns = {
    number: x + 28,
    member: x + 92,
    discord: x + 430,
    role: x + 650,
    activity: x + 850,
    donation: x + 1130,
    bossTries: x + 1320,
    power: x + 1510,
    status: x + width - 24,
  };
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, x, y, width, headerHeight + rows.length * rowHeight, 12);
  ctx.fill();
  ctx.strokeStyle = "#c8d2dc";
  ctx.lineWidth = 2;
  ctx.stroke();

  const headers = [
    ["#", columns.number, "left"],
    ["Member", columns.member, "left"],
    ["Discord", columns.discord, "left"],
    ["Role", columns.role, "left"],
    ["Activity", columns.activity, "left"],
    ["Donation", columns.donation, "right"],
    ["Boss tries", columns.bossTries, "right"],
    ["Power", columns.power, "right"],
    ["Status", columns.status, "right"],
  ];
  headers.forEach(([label, columnX, align]) => drawText(ctx, label, columnX, y + 38, { size: 17, weight: 900, color: "#435062", align }));
  drawLine(ctx, x, y + headerHeight, x + width, y + headerHeight);

  rows.forEach((member, index) => {
    const rowY = y + headerHeight + index * rowHeight;
    const evaluation = evaluations[index];
    if (index % 2 === 1) {
      ctx.fillStyle = "#f7f9fb";
      ctx.fillRect(x + 1, rowY, width - 2, rowHeight);
    }
    drawLine(ctx, x, rowY + rowHeight, x + width, rowY + rowHeight);
    const baseline = rowY + 37;
    drawText(ctx, String(index + 1), columns.number, baseline, { size: 18, weight: 750, color: "#667588" });
    drawText(ctx, member.name, columns.member, baseline, { size: 20, weight: 850, color: "#111a25", maxWidth: 300 });
    drawText(ctx, member.discordName || (member.discordLinked ? "Linked" : "Missing"), columns.discord, baseline, {
      size: 18,
      weight: 700,
      color: member.discordLinked ? "#18794e" : "#b54708",
      maxWidth: 190,
    });
    drawText(ctx, roleLabel(member.role), columns.role, baseline, { size: 18, weight: 700, maxWidth: 170 });
    drawText(ctx, activityLabel(member.lastActivityDays, member.activityText), columns.activity, baseline, { size: 18, weight: 700, maxWidth: 230 });
    drawText(ctx, formatOptionalNumber(member.contribution7d), columns.donation, baseline, { size: 18, weight: 750, align: "right" });
    drawText(ctx, formatOptionalNumber(member.bossAttacks), columns.bossTries, baseline, { size: 18, weight: 750, align: "right" });
    drawText(ctx, formatOptionalCompact(member.power), columns.power, baseline, { size: 18, weight: 750, align: "right" });
    drawText(ctx, evaluation.status, columns.status, baseline, {
      size: 18,
      weight: 850,
      align: "right",
      color: evaluation.severity === "danger" ? "#b42318" : evaluation.severity === "warning" ? "#b54708" : "#18794e",
      maxWidth: 190,
    });
  });
}

function currentImportDate() {
  return latestRawSnapshotDate() ?? dateOnly(captures.lastImportedAt, captures.lastCapturedAt) ?? currentIsoDate();
}

function captureDate() {
  return latestRawSnapshotDate() ?? dateOnly(captures.lastCapturedAt, captures.lastImportedAt) ?? currentIsoDate();
}

function latestRawSnapshotDate() {
  return latestDataDate({
    snapshotDates: [...dailyRawSnapshots, ...dailyBossRawSnapshots].map((snapshot) => snapshot?.date),
  });
}

function formatDateTime(value) {
  if (!value) return "Loading…";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(parsed);
}

function normalizeRules(value) {
  const normalized = { ...value };
  if (typeof normalized.minBossTries !== "number") normalized.minBossTries = defaultRules.minBossTries;
  delete normalized.bossRequiredOnEventDay;
  return normalized;
}
