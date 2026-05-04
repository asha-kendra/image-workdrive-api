require("dotenv").config();

const express = require("express");
const axios = require("axios");
const https = require("https");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { uploadToWorkDrive } = require("./zoho-workdrive");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
// RENDER_EXTERNAL_URL is set automatically by Render
const HOST = process.env.RENDER_EXTERNAL_URL || process.env.HOST || `http://localhost:${PORT}`;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * POST /upload-image
 * Body: { "url": "https://example.com/image.jpg" }
 *
 * Downloads the image and uploads it to Zoho WorkDrive.
 * Returns the WorkDrive file ID and a direct download link.
 */
app.post("/upload-image", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Missing required field: "url"' });
  }

  let imageBuffer, contentType;

  // Step 1 — Download the image
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      httpsAgent,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ImageProxy/1.0)" },
      maxContentLength: 50 * 1024 * 1024, // 50 MB limit
    });

    contentType = response.headers["content-type"] || "image/jpeg";

    if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
      return res.status(422).json({ error: `URL does not point to an image (got: ${contentType})` });
    }

    imageBuffer = Buffer.from(response.data);
  } catch (err) {
    return res.status(502).json({
      error: "Failed to download image",
      detail: err.message,
    });
  }

  // Step 2 — Determine filename
  const ext = extensionFromMime(contentType);
  const rawName = path.basename(new URL(url).pathname) || "";
  const filename = /\.(jpe?g|png|gif|webp|svg|bmp|tiff?)$/i.test(rawName)
    ? rawName
    : `${uuidv4()}${ext}`;

  // Step 3 — Upload to Zoho WorkDrive
  let workDriveResponse;
  try {
    workDriveResponse = await uploadToWorkDrive(imageBuffer, filename, contentType);
  } catch (err) {
    return res.status(502).json({
      error: "Failed to upload to Zoho WorkDrive",
      detail: err.response?.data || err.message,
    });
  }

  // Step 4 — Extract file info from WorkDrive response
  const fileData = workDriveResponse?.data?.[0]?.attributes || workDriveResponse?.data?.[0] || {};
  const fileId = fileData.resource_id || fileData.id || null;
  const workDriveUrl = fileId
    ? `${process.env.ZOHO_WORKDRIVE_API_URL || "https://workdrive.zoho.com"}/file/${fileId}`
    : null;

  res.json({
    success: true,
    filename,
    content_type: contentType,
    size_bytes: imageBuffer.length,
    source_url: url,
    workdrive: {
      file_id: fileId,
      url: workDriveUrl,
      raw: workDriveResponse,
    },
  });
});

/**
 * GET /upload-image?url=<image-url>   (convenience GET variant)
 */
app.get("/upload-image", async (req, res) => {
  req.body = { url: req.query.url };
  // re-dispatch to POST handler logic by calling it directly
  return app._router.handle(
    Object.assign(req, { method: "POST" }),
    res,
    () => {}
  );
});

/**
 * GET /test-auth  — temporary, tests Zoho OAuth and shows masked env vars
 */
app.get("/test-auth", async (req, res) => {
  const vars = {
    ZOHO_CLIENT_ID: mask(process.env.ZOHO_CLIENT_ID),
    ZOHO_CLIENT_SECRET: mask(process.env.ZOHO_CLIENT_SECRET),
    ZOHO_REFRESH_TOKEN: mask(process.env.ZOHO_REFRESH_TOKEN),
    ZOHO_ACCOUNTS_URL: process.env.ZOHO_ACCOUNTS_URL,
    ZOHO_WORKDRIVE_FOLDER_ID: mask(process.env.ZOHO_WORKDRIVE_FOLDER_ID),
  };
  try {
    const axios = require("axios");
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    }).toString();
    const r = await axios.post(process.env.ZOHO_ACCOUNTS_URL + "/oauth/v2/token", params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    res.json({ vars, oauth: r.data.access_token ? "OK" : r.data });
  } catch (e) {
    res.json({ vars, oauth_error: e.response?.data || e.message });
  }
});

function mask(val) {
  if (!val) return "(not set)";
  return val.slice(0, 6) + "..." + val.slice(-4);
}

/**
 * GET /health
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

function extensionFromMime(mimeType) {
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
  };
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return map[base] || ".jpg";
}

app.listen(PORT, () => {
  console.log(`\nImage → WorkDrive API running at ${HOST}`);
  console.log(`\n  POST ${HOST}/upload-image`);
  console.log(`  Body: { "url": "https://example.com/image.jpg" }\n`);
});
