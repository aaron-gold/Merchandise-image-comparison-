import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// IMPORTANT: Node 18+ required for global fetch
// If you are on Node <18, install node-fetch and import it:
//   npm i node-fetch
//   import fetch from "node-fetch";

dotenv.config();

const app = express();

// ---------- middleware ----------
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use((req, _res, next) => {
  console.log("Proxy got:", req.method, req.url);
  next();
});

// ---------- config ----------
const UPSTREAM_URL =
  process.env.UPSTREAM_URL ||
  "https://us-central1-uvcamp-staging.cloudfunctions.net/https-uvpaintInspectionsOnRequest";

const PORT = Number(process.env.PROXY_PORT || 8080);

// ---------- CORS preflight ----------
app.options("/api/get-uvpaint-inspections", (_req, res) => {
  res.sendStatus(204);
});

// ---------- main proxy endpoint ----------
app.post("/api/get-uvpaint-inspections", async (req, res) => {
  try {
    const apiKey = process.env.UVEYE_API_KEY;

    if (!apiKey) {
      console.error("❌ Missing UVEYE_API_KEY");
      return res.status(500).json({
        error: "Missing UVEYE_API_KEY in .env",
      });
    }

    console.log("UPSTREAM_URL:", UPSTREAM_URL);
    console.log("API key present:", apiKey.length, "chars");
    console.log("Request body:", req.body);

    const upstreamRes = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        // 🔑 EXACTLY what Postman sends
        "Content-Type": "application/json",
        "Accept": "*/*",
        "uveye-api-key": apiKey,
      },
      body: JSON.stringify(req.body),
    });

    const responseText = await upstreamRes.text();

    console.log("Upstream status:", upstreamRes.status);
    console.log(
      "Upstream body (first 300 chars):",
      responseText.slice(0, 300)
    );

    // Forward status + body exactly
    res.status(upstreamRes.status);
    res.setHeader(
      "Content-Type",
      upstreamRes.headers.get("content-type") || "application/json"
    );
    return res.send(responseText);
  } catch (err) {
    console.error("❌ Proxy crashed:", err);
    return res.status(500).json({
      error: "Proxy failed",
      message: err?.message,
    });
  }
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`✅ Proxy running on http://localhost:${PORT}`);
});
