import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const app = express();
const PORT = process.env.PORT || 3000;
const IPTV_ORIGIN = process.env.IPTV_ORIGIN;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

if (!IPTV_ORIGIN) {
  throw new Error("Falta configurar IPTV_ORIGIN");
}

const upstream = new URL(IPTV_ORIGIN);

app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: ALLOWED_ORIGIN || false,
  methods: ["GET", "HEAD", "OPTIONS"]
}));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "FuturaTv" });
});

function proxyUrl(url) {
  return "/api" + url.pathname + url.search;
}

function rewritePlaylist(text, playlistUrl) {
  return text.split("\n").map(line => {
    const trimmed = line.trim();

    if (!trimmed) return line;

    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (match, uri) => {
        try {
          const resolved = new URL(uri, playlistUrl);
          if (resolved.origin !== upstream.origin) return match;
          return `URI="${proxyUrl(resolved)}"`;
        } catch {
          return match;
        }
      });
    }

    try {
      const resolved = new URL(trimmed, playlistUrl);
      if (resolved.origin !== upstream.origin) return line;
      return proxyUrl(resolved);
    } catch {
      return line;
    }
  }).join("\n");
}
app.use((req, res, next) => {
  if (req.path.startsWith("/hls/")) {
    req.url = "/api" + req.url;
  }
  next();
});
app.all("/api/*", async (req, res) => {
  try {
    const target = new URL(
      req.originalUrl.replace(/^\/api/, ""),
      upstream
    );

    if (target.origin !== upstream.origin) {
      return res.status(400).send("Destino no permitido");
    }

    const response = await fetch(target, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: {
        ...(req.headers.range
          ? { Range: req.headers.range }
          : {})
      },
      redirect: "follow"
    });

    res.status(response.status);

    [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges"
    ].forEach(header => {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    });

    if (!response.body || req.method === "HEAD") {
      return res.end();
    }

    const contentType =
      response.headers.get("content-type") || "";

    const isPlaylist =
      target.pathname.endsWith(".m3u8") ||
      contentType.includes("mpegurl");

    if (isPlaylist && response.ok) {
      const playlist = await response.text();
      const rewritten = rewritePlaylist(playlist, target);

      res.removeHeader("content-length");
      res.setHeader(
        "content-type",
        "application/vnd.apple.mpegurl"
      );

      return res.send(rewritten);
    }

    await pipeline(
      Readable.fromWeb(response.body),
      res
    );

  } catch (error) {
    console.error("Error en proxy:", error.message);

    if (!res.headersSent) {
      res.status(502).send("Error conectando con el servidor");
    } else {
      res.destroy(error);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FuturaTv conectado en puerto ${PORT}`);
});
