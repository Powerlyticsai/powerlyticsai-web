// Vercel serverless function: receives lightweight activity-tracking events
// from the marketing site and commits each one as a JSON file in the private
// Powerlyticsai/usage-logs repo. Called from index.html on page load, tab
// change, and page unload (via navigator.sendBeacon).

const EVENTS = new Set(["session_start", "tab_change", "session_end"]);
const APPS = new Set(["landing", "dx", "tx", "feedback"]);
const SID_RE = /^[a-z0-9]{6,64}$/i;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // sendBeacon ships as Blob (often text/plain); regular fetch ships JSON.
  // Accept either.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid body" });
  }

  if (!EVENTS.has(body.event)) {
    return res.status(400).json({ error: "Unknown event" });
  }
  if (!body.session_id || !SID_RE.test(String(body.session_id))) {
    return res.status(400).json({ error: "Invalid session_id" });
  }
  if (body.app && !APPS.has(body.app)) {
    return res.status(400).json({ error: "Invalid app" });
  }

  const token = process.env.USAGE_TOKEN;
  const repo = process.env.USAGE_REPO;
  const missing = [];
  if (!token) missing.push("USAGE_TOKEN");
  if (!repo) missing.push("USAGE_REPO");
  if (missing.length) {
    return res.status(500).json({ error: "Server misconfigured", missing });
  }

  const now = new Date();
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ua = req.headers["user-agent"] || "";
  const referer = req.headers["referer"] || "";

  const record = {
    event: body.event,
    app: body.app || null,
    session_id: body.session_id,
    ip,
    user_agent: ua,
    referer,
    server_ts: now.toISOString(),
    client_ts: body.client_ts || null,
  };

  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStamp = now.toISOString().slice(11, 23).replace(/[:.]/g, "-"); // HH-mm-ss-sss
  const rand = Math.random().toString(36).slice(2, 8);
  const filename = `logs/${day}/${timeStamp}-${rand}.json`;

  const content = Buffer.from(JSON.stringify(record, null, 2), "utf8").toString("base64");
  const msg = `${body.event}${body.app ? ` ${body.app}` : ""} ${body.session_id.slice(0, 6)}`;

  const gh = await fetch(`https://api.github.com/repos/${repo}/contents/${filename}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "powerlyticsai-web",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: msg, content }),
  });

  if (!gh.ok) {
    const txt = await gh.text().catch(() => "");
    console.error("activity GitHub API error", gh.status, txt);
    return res.status(502).json({ error: "Failed to record activity" });
  }

  return res.status(200).json({ ok: true });
}
