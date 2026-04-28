// Vercel serverless function: accepts feedback form POST and commits
// each submission as a JSON file to the private Powerlyticsai/feedback-submissions repo.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s\-().]{6,}$/;
const REQUIRED = ["rating", "comment", "name", "company", "email", "phone"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  // Honeypot — bots tend to fill hidden fields
  if (body.website) {
    return res.status(200).json({ ok: true });
  }

  for (const k of REQUIRED) {
    const v = body[k];
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
      return res.status(400).json({ error: `Missing field: ${k}` });
    }
  }
  if (typeof body.rating !== "number" || body.rating < 1 || body.rating > 5) {
    return res.status(400).json({ error: "Invalid rating" });
  }
  if (!EMAIL_RE.test(String(body.email).trim())) {
    return res.status(400).json({ error: "Invalid email" });
  }
  if (!PHONE_RE.test(String(body.phone).trim())) {
    return res.status(400).json({ error: "Invalid phone" });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.FEEDBACK_REPO;
  const missing = [];
  if (!token) missing.push("GITHUB_TOKEN");
  if (!repo) missing.push("FEEDBACK_REPO");
  if (missing.length) {
    return res.status(500).json({ error: "Server misconfigured", missing });
  }

  const now = new Date();
  const iso = now.toISOString();
  const safeStamp = iso.replace(/[:.]/g, "-").slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  const filename = `submissions/${safeStamp}-${rand}.json`;

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ua = req.headers["user-agent"] || "";

  const record = {
    ...body,
    submitted_at: iso,
    ip,
    user_agent: ua,
  };

  const commitMessage = `feedback: ${body.rating}★ from ${String(body.name).trim()} (${String(body.company).trim()})`;
  const content = Buffer.from(JSON.stringify(record, null, 2), "utf8").toString("base64");

  const ghResp = await fetch(`https://api.github.com/repos/${repo}/contents/${filename}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "powerlyticsai-web",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: commitMessage, content }),
  });

  if (!ghResp.ok) {
    const txt = await ghResp.text();
    console.error("GitHub API error", ghResp.status, txt);
    return res.status(502).json({ error: "Failed to record submission" });
  }

  return res.status(200).json({ ok: true });
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
