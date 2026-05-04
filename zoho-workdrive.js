const axios = require("axios");
const FormData = require("form-data");

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ACCOUNTS_URL } = process.env;

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    refresh_token: ZOHO_REFRESH_TOKEN,
  });

  const res = await axios.post(
    `${ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com"}/oauth/v2/token`,
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  if (res.data.error) {
    throw new Error(`Zoho OAuth error: ${res.data.error}`);
  }

  cachedToken = res.data.access_token;
  tokenExpiresAt = Date.now() + res.data.expires_in * 1000;
  return cachedToken;
}

/**
 * Upload a buffer to Zoho WorkDrive.
 * @param {Buffer} buffer    - Image data
 * @param {string} filename  - e.g. "photo.jpg"
 * @param {string} mimeType  - e.g. "image/jpeg"
 * @returns {object}         - Zoho file metadata
 */
async function uploadToWorkDrive(buffer, filename, mimeType) {
  const token = await getAccessToken();
  const folderId = process.env.ZOHO_WORKDRIVE_FOLDER_ID;
  const apiBase = process.env.ZOHO_WORKDRIVE_API_URL || "https://workdrive.zoho.com";

  const form = new FormData();
  form.append("content", buffer, { filename, contentType: mimeType });
  form.append("filename", filename);
  form.append("parent_id", folderId);
  form.append("override-name-exist", "true");

  const res = await axios.post(`${apiBase}/api/v1/upload`, form, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
  });

  return res.data;
}

module.exports = { uploadToWorkDrive };
