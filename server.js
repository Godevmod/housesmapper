const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 8099);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PROJECTS_DIR = path.join(ROOT, "data", "projects");
const MAX_BODY_BYTES = 30 * 1024 * 1024;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function isValidProjectId(id) {
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

function createProjectId() {
  return crypto.randomBytes(9).toString("base64url");
}

function projectPath(id) {
  return path.join(PROJECTS_DIR, `${id}.json`);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map(record => ({
    ...record,
    comments: Array.isArray(record.comments) ? record.comments : [],
    photos: Array.isArray(record.photos) ? record.photos : []
  }));
}

async function saveProject(id, records) {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  const now = new Date().toISOString();
  const project = {
    id,
    records: normalizeRecords(records),
    updatedAt: now
  };
  await fs.writeFile(projectPath(id), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  return project;
}

async function handleApi(req, res, url) {
  const isProjectCollection = url.pathname === "/api/projects";
  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);

  if (req.method === "POST" && isProjectCollection) {
    const body = await readBody(req);
    const project = await saveProject(createProjectId(), body.records);
    sendJson(res, 201, project);
    return;
  }

  if (!projectMatch) {
    sendError(res, 404, "API route not found");
    return;
  }

  const id = projectMatch[1];
  if (!isValidProjectId(id)) {
    sendError(res, 400, "Invalid project id");
    return;
  }

  if (req.method === "GET") {
    try {
      const raw = await fs.readFile(projectPath(id), "utf8");
      sendJson(res, 200, JSON.parse(raw));
    } catch (error) {
      if (error.code === "ENOENT") {
        sendError(res, 404, "Project not found");
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method === "PUT") {
    const body = await readBody(req);
    const project = await saveProject(id, body.records);
    sendJson(res, 200, project);
    return;
  }

  sendError(res, 405, "Method not allowed");
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const absolutePath = path.resolve(ROOT, `.${requestedPath}`);

  if (!absolutePath.startsWith(ROOT) || absolutePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });

    const ext = path.extname(absolutePath).toLowerCase();
    const body = await fs.readFile(absolutePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "content-length": body.length
    });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendError(res, 400, "Invalid JSON");
      return;
    }
    sendError(res, error.statusCode || 500, error.message || "Server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`housesMappe server is running at http://localhost:${PORT}`);
});
