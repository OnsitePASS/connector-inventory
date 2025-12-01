// netlify/functions/get-connectors.js
const { google } = require("googleapis");

// ---------- Helpers ----------

// Extract a Google Drive file ID from common URL formats in column AQ
function extractDriveId(url) {
  if (!url) return "";
  let str = String(url).trim();

  // Strip surrounding quotes if they exist
  str = str.replace(/^['"]+|['"]+$/g, "");

  if (!str.includes("drive.google.com")) return "";

  // Form: ...?id=FILE_ID&...
  let m = str.match(/[?&]id=([^&]+)/);
  if (m && m[1]) return m[1];

  // Form: .../file/d/FILE_ID/...
  m = str.match(/\/file\/d\/([^/]+)/);
  if (m && m[1]) return m[1];

  return "";
}

// Convert "Terminals #1-8" → "T:1-8"
function formatTermRange(raw) {
  if (!raw) return "";
  const match = String(raw).match(/#\s*(\d+\s*-\s*\d+)/);
  return match ? `T:${match[1].replace(/\s+/g, "")}` : String(raw);
}

// ---------- Handler ----------

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Env vars from Netlify
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
    const mainRange =
      process.env.SHEETS_RANGE || "'Connector Inventory'!A2:AZ";

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Batch get: main data + stats for pins & suppliers
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        mainRange,
        "Stats!A2:A", // pin counts
        "Stats!E2:E", // suppliers
      ],
    });

    const rows = response.data.valueRanges[0].values || [];
    const pinStatsRows = response.data.valueRanges[1].values || [];
    const supplierStatsRows = response.data.valueRanges[2].values || [];

    // 0-based column indexes
    const COL = {
      partNumber: 1,     // B
      shop: 7,           // H
      shopQty: 8,        // I
      van: 9,            // J
      vanQty: 10,        // K
      gender: 11,        // L
      pins: 12,          // M
      category: 13,      // N
      desc1: 14,         // O
      desc2: 15,         // P
      manufacturer: 16,  // Q

      ford: 17,          // R
      gm: 18,            // S
      hyundaiKia: 19,    // T
      nissan: 20,        // U
      toyota: 21,        // V

      term1_tub: 22,     // W
      term1_bin: 23,     // X
      term1_code: 24,    // Y

      term2_code: 27,    // AB
      term2_bin: 28,     // AC
      term2_tub: 29,     // AD

      mating: 30,        // AE
      price: 37,         // AL

      terminalSizes: 41, // AP
      picture: 42,       // AQ
    };

    const items = [];

    for (const row of rows) {
      const get = (i) => (row[i] !== undefined ? row[i] : "");

      const partNumber = get(COL.partNumber);
      const desc1 = get(COL.desc1);
      const desc2 = get(COL.desc2);
      const description = [desc1, desc2].filter(Boolean).join(" ");

      // Skip truly empty/spacer rows
      const hasData =
        partNumber ||
        description ||
        get(COL.shop) ||
        get(COL.van) ||
        get(COL.pins) ||
        get(COL.category);

      if (!hasData) continue;

      // OEM flags → array of strings
      const oems = [];
      if (get(COL.ford)) oems.push("Ford");
      if (get(COL.gm)) oems.push("GM");
      if (get(COL.hyundaiKia)) oems.push("HyundaiKia");
      if (get(COL.nissan)) oems.push("Nissan");
      if (get(COL.toyota)) oems.push("Toyota");

      // Build proxy image URL from AQ (Google Drive URL)
      const rawPic = get(COL.picture);
      const picId = extractDriveId(rawPic);
      const pictureUrl = picId
        ? `/.netlify/functions/image-proxy?id=${encodeURIComponent(picId)}`
        : "";

      items.push({
        picture: pictureUrl,
        partNumber,
        description,

        shop: get(COL.shop),
        shopQty: Number(get(COL.shopQty)) || 0,
        van: get(COL.van),
        vanQty: Number(get(COL.vanQty)) || 0,

        pins: get(COL.pins),
        category: get(COL.category),
        gender: get(COL.gender),
        manufacturer: get(COL.manufacturer),

        oems,
        vehicle: oems.join(", "),
        terminalSizes: get(COL.terminalSizes),

        details: {
          // TERMINAL 1 (Columns Y, W, X)
          terminal1Code: get(COL.term1_code),                // Y
          terminal1Range: formatTermRange(get(COL.term1_bin)), // X (T:1-4 style)
          terminal1Tub: get(COL.term1_tub),                  // W

          // TERMINAL 2 (Columns AB, AD, AC)
          terminal2Code: get(COL.term2_code),                // AB
          terminal2Range: formatTermRange(get(COL.term2_bin)), // AC
          terminal2Tub: get(COL.term2_tub),                  // AD

          mating: get(COL.mating),
          price: get(COL.price),

          ford: get(COL.ford),
          gm: get(COL.gm),
          hyundaiKia: get(COL.hyundaiKia),
          nissan: get(COL.nissan),
          toyota: get(COL.toyota),
        },
      });
    }

    // Build dropdown options from Stats sheet
    const pinOptions = pinStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => {
        const na = Number(a),
          nb = Number(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      });

    const manufacturerOptions = supplierStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => String(a).localeCompare(String(b)));

    return {
      statusCode: 200,
      body: JSON.stringify({ items, pinOptions, manufacturerOptions }),
    };
  } catch (e) {
    console.error("Error in get-connectors:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.toString() }),
    };
  }
};
