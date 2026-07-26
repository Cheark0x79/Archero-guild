"use client";

import { useMemo, useState } from "react";
import styles from "./api-docs.module.css";

const endpoints = [
  endpoint("System", "GET", "/api/v1/health", "Health check", "Vérifie que l’API est disponible.", false, {}, { status: "ok" }),
  endpoint("Guild", "GET", "/api/v1/guild", "Guild overview", "Résumé compact de la guilde, de son activité et de la fraîcheur des données.", true, {}, {
    currentMembers: 38, freeSlots: 2, watchCount: 5, lastImportedAt: "2026-07-22T00:00:00+02:00",
  }),
  endpoint("Guild", "GET", "/api/v1/rules", "Guild rules", "Seuils utilisés pour la contribution, l’activité, la progression et les boss.", true, {}, {
    maxInactiveDays: 3, minContribution7d: 500, minBossTries: 2, memberCapacity: 40,
  }),
  endpoint("Guild", "GET", "/api/v1/violations", "Watchlist", "Membres ayant un warning ou une violation critique.", true, {
    severity: "[optional query] warning | danger", flag: "[optional query] absence | contribution | boss",
  }, {
    summary: { total: 5, warning: 3, danger: 2 },
    members: [{ playerId: "119974403", name: "Ac1s", severity: "warning", flags: ["Low contribution"] }],
  }),
  endpoint("Members", "GET", "/api/v1/members", "List members", "Liste paginée et recherche des membres actifs ou anciens.", true, {
    q: "[optional query] nom ou Player ID",
    status: "[optional query] active | former | all · défaut: active",
    limit: "[optional query] 1–100 · défaut: 25",
    offset: "[optional query] entier positif · défaut: 0",
  }, [
    { playerId: "119934456", name: "Sendrock", role: "member", power: 10550000, contribution7d: 2280 },
  ]),
  endpoint("Members", "GET", "/api/v1/members/resolve", "Resolve a member", "Retrouve un membre depuis son Player ID, son nom, un alias ou une faute légère.", true, {
    q: "[required query] nom, alias ou Player ID",
    limit: "[optional query] 1–10 suggestions · défaut: 5",
  }, {
    query: "Sendrok",
    match: { playerId: "119934456", name: "Sendrock", confidence: 0.94, matchedBy: "name", webUrl: "/members/119934456" },
    suggestions: [],
  }),
  endpoint("Members", "GET", "/api/v1/members/{playerId}", "Member profile", "Profil public et métriques actuelles d’un membre.", true, {
    playerId: "[required path] Player ID du membre",
  }, {
    playerId: "119934456", name: "Sendrock", role: "member",
    metrics: { power: 10550000, contribution7d: 2280, bossAttacks: 2 },
    evaluation: { status: "Active", severity: "positive", flags: [] },
  }),
  endpoint("Members", "GET", "/api/v1/members/{playerId}/history", "Member history", "Historique quotidien des métriques d’un membre.", true, {
    playerId: "[required path] Player ID du membre",
    from: "[optional query] date minimale YYYY-MM-DD",
    to: "[optional query] date maximale YYYY-MM-DD",
  }, {
    playerId: "119934456",
    items: [{ date: "2026-07-22", power: 10550000, contribution7d: 2280, bossAttacks: 2 }],
  }),
  endpoint("Members", "GET", "/api/v1/members/{playerId}/bosses", "Member boss records", "Records, participations et rang du membre pour chacun des sept boss.", true, {
    playerId: "[required path] Player ID du membre",
  }, {
    member: { playerId: "119934456", name: "Sendrock" },
    globalRecord: { bossName: "Fire Dragon", damage: 923010000000, date: "2026-07-21" },
    recordsByBoss: [{ boss: { key: "fire-dragon", name: "Fire Dragon" }, bestDamage: 923010000000, guildRank: 1, participations: 2 }],
  }),
  endpoint("Rankings", "GET", "/api/v1/rankings/members", "Member rankings", "Classement par puissance, contribution, progression, attaques ou activité.", true, {
    metric: "[optional query] power | contribution7d | powerDelta | contributionDelta | bossAttacks | activity · défaut: power",
    order: "[optional query] asc | desc · défaut: desc (activity: asc)",
    limit: "[optional query] 1–100 · défaut: 10",
  }, {
    metric: "power", rows: [{ rank: 1, playerId: "119934456", name: "Sendrock", value: 10550000 }],
  }),
  endpoint("Bosses", "GET", "/api/v1/bosses", "Boss catalogue", "Rotation des boss, records et détenteurs actuels.", true, {}, [
    { key: "fire-dragon", name: "Fire Dragon", dayLabel: "Tue", bestDamage: 923010000000 },
  ]),
  endpoint("Bosses", "GET", "/api/v1/boss-results", "Daily boss results", "Dégâts et rangs journaliers, filtrables par date, boss ou membre.", true, {
    date: "[optional query] YYYY-MM-DD · défaut: toutes les dates",
    boss: "[optional query] identifiant du boss",
    playerId: "[optional query] Player ID du membre",
    limit: "[optional query] 1–100 par journée · défaut: 100",
  }, [{
    date: "2026-07-22", boss: { key: "flame-demon", name: "Flame Demon" },
    rows: [{ rank: 1, playerId: "119934456", name: "Sendrock", damage: 868570000000, damageText: "868.57B" }],
  }]),
  endpoint("Bosses", "GET", "/api/v1/rankings/boss/all-time", "All-time records", "Meilleur score historique de chaque membre.", true, {
    limit: "[optional query] 1–100 · défaut: 10",
  }, [{ playerId: "119934456", name: "Sendrock", damage: 923010000000, bossName: "Fire Dragon" }]),
  endpoint("Bosses", "GET", "/api/v1/rankings/boss/weekly", "Weekly leaderboard", "Totaux de dégâts sur une semaine.", true, {
    week: "[optional query] lundi au format YYYY-MM-DD · défaut: dernière semaine",
    limit: "[optional query] 1–100 · défaut: 10",
  }, [{ weekStart: "2026-07-20", playerId: "119934456", name: "Sendrock", damage: 1791580000000 }]),
  endpoint("Bosses", "GET", "/api/v1/rankings/boss/by-boss", "Records by boss", "Records personnels classés pour un boss précis ou pour toute la rotation.", true, {
    boss: "[optional query] identifiant du boss · défaut: tous les boss",
    limit: "[optional query] 1–100 par boss · défaut: 10",
  }, [{ boss: { key: "fire-dragon", name: "Fire Dragon" }, rows: [] }]),
];

const categories = ["All", "System", "Guild", "Members", "Rankings", "Bosses"];

export default function ApiDocsClient() {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(endpoints[1].id);
  const [codeMode, setCodeMode] = useState("javascript");
  const [copied, setCopied] = useState("");

  const visibleEndpoints = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return endpoints.filter((item) =>
      (category === "All" || item.category === category) &&
      (!normalized || `${item.path} ${item.title} ${item.description}`.toLowerCase().includes(normalized)),
    );
  }, [category, query]);

  const selected = endpoints.find((item) => item.id === selectedId) ?? visibleEndpoints[0] ?? endpoints[0];
  const example = codeExample(selected, codeMode);

  async function copy(value, key) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1400);
  }

  return (
    <main className={styles.page}>
      <div className={styles.glowOne} />
      <div className={styles.glowTwo} />

      <header className={styles.topbar}>
        <a className={styles.brand} href="/dashboard" aria-label="Archero Observer dashboard">
          <span className={styles.brandMark}>AO</span>
          <span><strong>Archero Guild</strong><small>API documentation</small></span>
        </a>
        <nav className={styles.topnav}>
          <a href="/dashboard">Dashboard</a>
          <a className={styles.activeNav} href="/api-docs">API Docs</a>
        </nav>
        <span className={styles.version}>API v1</span>
      </header>

      <section className={styles.reference} id="reference">
        <div className={styles.sectionTitle}>
          <div><span>ROUTES API</span><h2>Choisir une route.</h2></div>
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
            {visibleEndpoints.length === 0 && <p className={styles.empty}>Aucun endpoint ne correspond à cette recherche.</p>}
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
              <code>{selected.path}</code>
              <button onClick={() => copy(selected.path, "path")}>{copied === "path" ? "Copied!" : "Copy path"}</button>
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
                            {parameterMeta(value).required ? "Obligatoire" : "Optionnel"}
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
                  : <p className={styles.muted}>Route publique, aucune clé nécessaire.</p>}
                <h4>Possible responses</h4>
                <div className={styles.statusList}>
                  <span><b>200</b> Succès</span>
                  {Object.values(selected.parameters).some((value) => parameterMeta(value).required || parameterMeta(value).location === "query") && <span><b>400</b> Paramètre invalide</span>}
                  {selected.path.includes("{playerId}") && <span><b>404</b> Membre introuvable</span>}
                  {selected.secured && <span><b>401</b> Clé absente ou invalide</span>}
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
  );
}

function endpoint(category, method, path, title, description, secured, parameters, response) {
  return { id: `${method}-${path}`, category, method, path, title, description, secured, parameters, response };
}

function requestParts(item) {
  const parameterEntries = Object.keys(item.parameters);
  const query = parameterEntries.filter((name) => parameterMeta(item.parameters[name]).location === "query").slice(0, 2);
  const suffix = query.length ? `?${query.map((name) => `${name}=value`).join("&")}` : "";
  const path = item.path.replace("{playerId}", "119934456");
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

function codeExample(item, mode) {
  if (mode === "response") {
    return JSON.stringify({
      data: item.response,
      meta: { apiVersion: "v1", generatedAt: "2026-07-26T12:00:00.000Z", source: "database" },
    }, null, 2);
  }

  const { path, suffix } = requestParts(item);
  const url = `\${API_URL}${path}${suffix}`;
  if (mode === "javascript") {
    const options = item.secured ? `, {\n  headers: {\n    Authorization: \`Bearer \${process.env.ARCHERO_API_TOKEN}\`\n  }\n}` : "";
    return `const API_URL = process.env.ARCHERO_API_URL;\n\nconst response = await fetch(\`${url}\`${options});\nconst { data } = await response.json();`;
  }
  if (mode === "python") {
    const headers = item.secured ? `,\n    headers={\n        "Authorization": f"Bearer {os.environ['ARCHERO_API_TOKEN']}"\n    }` : "";
    return `import os\nimport requests\n\nAPI_URL = os.environ["ARCHERO_API_URL"]\n\nresponse = requests.get(\n    f"{API_URL}${path}${suffix}"${headers}\n)\ndata = response.json()["data"]`;
  }
  const auth = item.secured ? ` \\\n  -H "Authorization: Bearer $ARCHERO_API_TOKEN"` : "";
  return `curl "http://127.0.0.1:5182${path}${suffix}"${auth}`;
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
