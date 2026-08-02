"use client";

import { useEffect, useMemo, useState } from "react";
import AppSidebar from "../components/AppSidebar.jsx";
import styles from "./api-docs.module.css";

const endpoints = [
  endpoint("System", "GET", "/api/v1/health", "Health check", "Checks whether the API is available.", false, {}, { status: "ok" }),
  endpoint("Guild", "GET", "/api/v1/guild", "Guild overview", "Compact summary of the guild, its activity, and data freshness.", true, {}, {
    currentMembers: 38, freeSlots: 2, watchCount: 5, lastImportedAt: "2026-07-22T00:00:00+02:00",
  }),
  endpoint("Guild", "GET", "/api/v1/rules", "Guild rules", "Thresholds used for contributions, activity, progression, and bosses.", true, {}, {
    maxInactiveDays: 3, minContribution7d: 500, minBossTries: 2, memberCapacity: 40,
  }),
  endpoint("Guild", "GET", "/api/v1/warnings", "Warnings", "Current members who reached one or more guild warning thresholds.", true, {
    type: "[optional query] game_absence | low_contribution | low_progression | missed_boss",
    flag: "[optional query] absence | contribution | progression | boss",
    playerId: "[optional query] member Player ID",
  }, {
    summary: { totalMembers: 5, warningCountsByType: { low_contribution: 3, game_absence: 2 } },
    members: [{
      playerId: "100000001",
      name: "ExampleMember",
      lastSeenAt: "2026-07-29",
      evaluation: {
        status: "Watch",
        warnings: [{ type: "low_contribution", label: "Low contribution" }],
      },
    }],
  }),
  endpoint("Members", "GET", "/api/v1/members", "List members", "Paginated list and search for current or former members.", true, {
    q: "[optional query] name or Player ID",
    status: "[optional query] active | former | all · default: active",
    limit: "[optional query] 1–100 · default: 25",
    offset: "[optional query] positive integer · default: 0",
  }, [
    { playerId: "100000002", name: "ExampleChampion", role: "member", power: 10550000, contribution7d: 2280 },
  ]),
  endpoint("Members", "GET", "/api/v1/members/resolve", "Resolve a member", "Finds a member by Player ID, name, alias, or a minor typo.", true, {
    q: "[required query] name, alias, or Player ID",
    limit: "[optional query] 1–10 suggestions · default: 5",
  }, {
    query: "ExampleChamp",
    match: { playerId: "100000002", name: "ExampleChampion", confidence: 0.94, matchedBy: "name", webUrl: "/members/100000002" },
    suggestions: [],
  }),
  endpoint("Members", "GET", "/api/v1/members/{playerId}", "Member profile", "Public profile and current metrics for a member.", true, {
    playerId: "[required path] member Player ID",
  }, {
    playerId: "100000002", name: "ExampleChampion", role: "member",
    metrics: { power: 10550000, contribution7d: 2280, bossAttacks: 2 },
    evaluation: { status: "Active", severity: "positive", flags: [] },
  }),
  endpoint("Members", "GET", "/api/v1/members/{playerId}/history", "Member history", "Daily metrics and durable automatic warning history.", true, {
    playerId: "[required path] member Player ID",
    from: "[optional query] earliest date in YYYY-MM-DD format",
    to: "[optional query] latest date in YYYY-MM-DD format",
  }, {
    playerId: "100000002",
    items: [{ date: "2026-07-22", power: 10550000, contribution7d: 2280, bossAttacks: 2, warnings: [] }],
    warningSummary: { total: 4, byType: { missed_boss: 1 }, lastWarningAt: "2026-07-21" },
  }),
  endpoint("Members", "GET", "/api/v1/members/{playerId}/warnings", "Member warnings", "All warning events and totals for one member.", true, {
    playerId: "[required path] member Player ID",
    type: "[optional query] game_absence | low_contribution | low_progression | missed_boss",
    scope: "[optional query] current | history · default: history",
    from: "[optional query] earliest date in YYYY-MM-DD format",
    to: "[optional query] latest date in YYYY-MM-DD format",
    limit: "[optional query] 1–1000 events · default: 200",
  }, {
    playerId: "100000001",
    name: "ExampleMember",
    summary: { totalWarnings: 4, warningCountsByType: { missed_boss: 2 }, lastWarningAt: "2026-07-29" },
    warnings: [{ date: "2026-07-29", type: "missed_boss", label: "Missed boss", value: 0, threshold: 2 }],
    pagination: { limit: 200, totalWarnings: 4, hasMore: false },
  }),
  endpoint("Members", "GET", "/api/v1/members/{playerId}/bosses", "Member boss records", "Records, participation, and guild rank for each of the seven bosses.", true, {
    playerId: "[required path] member Player ID",
  }, {
    member: { playerId: "100000002", name: "ExampleChampion" },
    globalRecord: { bossName: "Fire Dragon", damage: 923010000000, date: "2026-07-21" },
    recordsByBoss: [{ boss: { key: "fire-dragon", name: "Fire Dragon" }, bestDamage: 923010000000, guildRank: 1, participations: 2 }],
  }),
  endpoint("Rankings", "GET", "/api/v1/rankings/members", "Member rankings", "Rankings by power, contribution, progression, attacks, or activity.", true, {
    metric: "[optional query] power | contribution7d | powerDelta | contributionDelta | bossAttacks | activity · default: power",
    order: "[optional query] asc | desc · default: desc (activity: asc)",
    limit: "[optional query] 1–100 · default: 10",
  }, {
    metric: "power", rows: [{ rank: 1, playerId: "100000002", name: "ExampleChampion", value: 10550000 }],
  }),
  endpoint("Rankings", "GET", "/api/v1/rankings/warnings", "Warning ranking", "Members ordered by their accumulated warning count.", true, {
    type: "[optional query] game_absence | low_contribution | low_progression | missed_boss",
    scope: "[optional query] current | history · default: history",
    from: "[optional query] earliest date in YYYY-MM-DD format",
    to: "[optional query] latest date in YYYY-MM-DD format",
    order: "[optional query] asc | desc · default: desc",
    limit: "[optional query] 1–100 members · default: 10",
  }, {
    totalMembers: 5,
    rankings: [{
      rank: 1, playerId: "100000001", name: "ExampleMember", totalWarnings: 7,
      warningCountsByType: { game_absence: 1, missed_boss: 2, low_contribution: 4 },
      lastWarningAt: "2026-07-29",
    }],
  }),
  endpoint("Bosses", "GET", "/api/v1/bosses", "Boss catalogue", "Boss rotation, records, and current record holders.", true, {}, [
    { key: "fire-dragon", name: "Fire Dragon", dayLabel: "Tue", bestDamage: 923010000000 },
  ]),
  endpoint("Bosses", "GET", "/api/v1/boss-results", "Daily boss results", "Daily damage and rankings, filterable by date, boss, or member.", true, {
    date: "[optional query] YYYY-MM-DD · default: all dates",
    boss: "[optional query] boss identifier",
    playerId: "[optional query] member Player ID",
    limit: "[optional query] 1–100 per day · default: 100",
  }, [{
    date: "2026-07-22", boss: { key: "flame-demon", name: "Flame Demon" },
    rows: [{ rank: 1, playerId: "100000002", name: "ExampleChampion", damage: 868570000000, damageText: "868.57B" }],
  }]),
  endpoint("Bosses", "GET", "/api/v1/rankings/boss/all-time", "All-time records", "Best historical score for each member.", true, {
    limit: "[optional query] 1–100 · default: 10",
  }, [{ playerId: "100000002", name: "ExampleChampion", damage: 923010000000, bossName: "Fire Dragon" }]),
  endpoint("Bosses", "GET", "/api/v1/rankings/boss/weekly", "Weekly leaderboard", "Total damage over one week.", true, {
    week: "[optional query] Monday in YYYY-MM-DD format · default: latest week",
    limit: "[optional query] 1–100 · default: 10",
  }, [{ weekStart: "2026-07-20", playerId: "100000002", name: "ExampleChampion", damage: 1791580000000 }]),
  endpoint("Bosses", "GET", "/api/v1/rankings/boss/by-boss", "Records by boss", "Ranked personal records for one boss or the full rotation.", true, {
    boss: "[optional query] boss identifier · default: all bosses",
    limit: "[optional query] 1–100 per boss · default: 10",
  }, [{ boss: { key: "fire-dragon", name: "Fire Dragon" }, rows: [] }]),
];

const categories = ["All", "System", "Guild", "Members", "Rankings", "Bosses"];

export default function ApiDocsClient({ publicOrigin }) {
  const [sessionRole, setSessionRole] = useState(null);
  const [browserOrigin, setBrowserOrigin] = useState("");
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(endpoints[1].id);
  const [codeMode, setCodeMode] = useState("javascript");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
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
  }, []);

  const apiBaseUrl = String(publicOrigin || browserOrigin).replace(/\/+$/, "");
  const visibleEndpoints = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return endpoints.filter((item) =>
      (category === "All" || item.category === category) &&
      (!normalized || `${item.path} ${item.title} ${item.description}`.toLowerCase().includes(normalized)),
    );
  }, [category, query]);

  const selected = endpoints.find((item) => item.id === selectedId) ?? visibleEndpoints[0] ?? endpoints[0];
  const example = codeExample(selected, codeMode, apiBaseUrl);
  const requestUrl = `${apiBaseUrl}${selected.path}`;

  async function copy(value, key) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1400);
  }

  return (
    <div className="app-shell">
      <AppSidebar
        activeRoute="api-docs"
        sessionRole={sessionRole}
        checkpointLabel="Documentation"
        checkpointValue="API v1"
      />
      <main className={styles.page}>
        <div className={styles.glowOne} />
        <div className={styles.glowTwo} />

        <header className={styles.pageHeader}>
          <div>
            <span>Developer reference</span>
            <h1>API documentation</h1>
            <p>Endpoints, authentication and ready-to-use integration examples.</p>
          </div>
          <div className={styles.baseUrl}>
            <span>Base URL</span>
            <code>{apiBaseUrl || "Loading…"}</code>
            <button type="button" onClick={() => copy(apiBaseUrl, "base-url")}>
              {copied === "base-url" ? "Copied!" : "Copy"}
            </button>
          </div>
        </header>

        <section className={styles.reference} id="reference">
        <div className={styles.sectionTitle}>
          <div><span>API ROUTES</span></div>
          <label className={styles.search}>
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search endpoints…" />
            <kbd>/</kbd>
          </label>
        </div>

        <div className={styles.filterRow}>
          {categories.map((item) => (
            <button key={item} className={category === item ? styles.selectedFilter : ""} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </div>

        <div className={styles.docsGrid}>
          <aside className={styles.endpointList}>
            <span className={styles.resultCount}>{visibleEndpoints.length} ENDPOINT{visibleEndpoints.length === 1 ? "" : "S"}</span>
            {visibleEndpoints.map((item) => (
              <button key={item.id} className={selected.id === item.id ? styles.selectedEndpoint : ""} onClick={() => setSelectedId(item.id)}>
                <span className={styles.method}>{item.method}</span>
                <span><strong>{item.path}</strong><small>{item.title}</small></span>
                <b>›</b>
              </button>
            ))}
            {visibleEndpoints.length === 0 && <p className={styles.empty}>No endpoints match this search.</p>}
          </aside>

          <article className={styles.endpointDetail}>
            <div className={styles.detailHeader}>
              <div>
                <span className={styles.categoryLabel}>{selected.category}</span>
                <h3>{selected.title}</h3>
                <p>{selected.description}</p>
              </div>
              <span className={selected.secured ? styles.secured : styles.public}>{selected.secured ? "● API key" : "● Public"}</span>
            </div>

            <div className={styles.requestBar}>
              <span className={styles.method}>{selected.method}</span>
              <code>{requestUrl}</code>
              <button onClick={() => copy(requestUrl, "path")}>{copied === "path" ? "Copied!" : "Copy URL"}</button>
            </div>

            <div className={styles.detailColumns}>
              <section>
                <h4>Parameters</h4>
                {Object.entries(selected.parameters).length ? (
                  <div className={styles.parameters}>
                    {Object.entries(selected.parameters).map(([name, value]) => (
                      <div key={name}>
                        <div className={styles.parameterHeading}>
                          <code>{name}</code>
                          <span className={parameterMeta(value).required ? styles.requiredBadge : styles.optionalBadge}>
                            {parameterMeta(value).required ? "Required" : "Optional"}
                          </span>
                          <small>{parameterMeta(value).location}</small>
                        </div>
                        <span>{parameterMeta(value).description}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className={styles.muted}>No parameters required.</p>}

                <h4>Authentication</h4>
                {selected.secured
                  ? <p className={styles.authLine}><span>Authorization</span><code>Bearer &lt;api_token&gt;</code></p>
                  : <p className={styles.muted}>Public endpoint. No API key required.</p>}
                <h4>Possible responses</h4>
                <div className={styles.statusList}>
                  <span><b>200</b> Success</span>
                  {Object.values(selected.parameters).some((value) => parameterMeta(value).required || parameterMeta(value).location === "query") && <span><b>400</b> Invalid parameter</span>}
                  {selected.path.includes("{playerId}") && <span><b>404</b> Member not found</span>}
                  {selected.secured && <span><b>401</b> Missing or invalid API key</span>}
                </div>
              </section>

              <section className={styles.examplePanel}>
                <div className={styles.exampleTabs}>
                  <span className={styles.terminalDots}><i /><i /><i /></span>
                  <button className={codeMode === "javascript" ? styles.activeTab : ""} onClick={() => setCodeMode("javascript")}>JavaScript</button>
                  <button className={codeMode === "python" ? styles.activeTab : ""} onClick={() => setCodeMode("python")}>Python</button>
                  <button className={codeMode === "curl" ? styles.activeTab : ""} onClick={() => setCodeMode("curl")}>cURL</button>
                  <button className={codeMode === "response" ? styles.activeTab : ""} onClick={() => setCodeMode("response")}>JSON</button>
                  <button className={styles.copyExample} onClick={() => copy(example, "example")}>{copied === "example" ? "Copied!" : "Copy"}</button>
                </div>
                <pre><code>{highlightCode(example)}</code></pre>
              </section>
            </div>
          </article>
        </div>
        </section>

        <footer className={styles.footer}>
          <span>Archero Observer API · v1</span>
          <div><a href="/dashboard">Dashboard</a><a href="/openapi.yaml">OpenAPI YAML</a><a href="/api/v1/health">Status</a></div>
        </footer>
      </main>
    </div>
  );
}

function endpoint(category, method, path, title, description, secured, parameters, response) {
  return { id: `${method}-${path}`, category, method, path, title, description, secured, parameters, response };
}

function requestParts(item) {
  const parameterEntries = Object.keys(item.parameters);
  const query = parameterEntries.filter((name) => parameterMeta(item.parameters[name]).location === "query").slice(0, 2);
  const suffix = query.length ? `?${query.map((name) => `${name}=value`).join("&")}` : "";
  const path = item.path.replace("{playerId}", "100000002");
  return { path, suffix };
}

function parameterMeta(value) {
  const raw = String(value);
  const marker = raw.match(/^\[(required|optional)\s+(path|query)\]\s*/);
  return {
    required: marker?.[1] === "required",
    location: marker?.[2] ?? "query",
    description: raw.replace(/^\[(required|optional)\s+(path|query)\]\s*/, ""),
  };
}

function codeExample(item, mode, apiBaseUrl) {
  if (mode === "response") {
    return JSON.stringify({
      data: item.response,
      meta: {
        apiVersion: "v1",
        generatedAt: "2026-07-26T12:00:00.000Z",
        lastImportDate: "2026-07-25",
        source: "database",
      },
    }, null, 2);
  }

  const { path, suffix } = requestParts(item);
  const url = `${apiBaseUrl}${path}${suffix}`;
  if (mode === "javascript") {
    const options = item.secured ? `, {\n  headers: {\n    Authorization: \`Bearer \${process.env.ARCHERO_API_TOKEN}\`\n  }\n}` : "";
    return `const response = await fetch("${url}"${options});\nconst { data } = await response.json();`;
  }
  if (mode === "python") {
    const headers = item.secured ? `,\n    headers={\n        "Authorization": f"Bearer {os.environ['ARCHERO_API_TOKEN']}"\n    }` : "";
    return `import os\nimport requests\n\nresponse = requests.get(\n    "${url}"${headers}\n)\ndata = response.json()["data"]`;
  }
  const auth = item.secured ? ` \\\n  -H "Authorization: Bearer $ARCHERO_API_TOKEN"` : "";
  return `curl "${url}"${auth}`;
}

function highlightCode(code) {
  return code.split("\n").map((line, lineIndex) => (
    <span className={styles.codeLine} key={`${lineIndex}-${line}`}>
      {highlightLine(line, lineIndex)}
      {"\n"}
    </span>
  ));
}

function highlightLine(line, lineIndex) {
  const pattern = /(\/\/.*$|#.*$|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b(?:const|await|import|from|fetch|requests|curl|null|true|false)\b|\b\d[\d_.]*\b)/g;
  const parts = [];
  let cursor = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > cursor) parts.push(line.slice(cursor, match.index));
    const token = match[0];
    const className =
      token.startsWith("//") || token.startsWith("#")
        ? styles.syntaxComment
        : /^["'`]/.test(token)
          ? styles.syntaxString
          : /^\d/.test(token)
            ? styles.syntaxNumber
            : styles.syntaxKeyword;
    parts.push(<span className={className} key={`${lineIndex}-${match.index}`}>{token}</span>);
    cursor = pattern.lastIndex;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}
