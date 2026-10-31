import express from "express";
import cors from "cors";
import helmet from "helmet";

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
        ...(req.headers.range ? { range: req.headers.range } : {})
      },
      redirect: "follow"
    });

    res.status(response.status);

    ["content-type", "content-length", "content-range", "accept-ranges"]
      .forEach(header => {
        const value = response.headers.get(header);
        if (value) res.setHeader(header, value);
      });

    if (!response.body) return res.end();

    const { Readable } = await import("node:stream");
    Readable.fromWeb(response.body).pipe(res);

  } catch (error) {
    console.error(error);
    res.status(502).send("Error conectando con el servidor");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FuturaTv conectado en puerto ${PORT}`);
});
