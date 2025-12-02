// netlify/functions/get-connectors.js
const { google } = require("googleapis");

// Extract a Google Drive file ID from various URL formats
function extractDriveId(raw) {
  if (!raw) return "";
  const str = String(raw).trim();

  // ?id=FILE_ID
  const mId = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (mId && mId[1]) return mId[1];

  // /file/d/FILE_ID/
  const mFile = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (mFile && mFile[1]) return mFile[1];

  // /uc?id=FILE_ID
  const mUc = str.match(/\/uc\?[^#?]*id=([a-zA-Z0-9_-]+)/);
  if (mUc && mUc[1]) return mUc[1];

  return "";
}

// Convert "Terminals #1-8" → "T:1-8" (used for the *range* text)
function formatTermRange(raw) {
  if (!raw) return "";
  const match = String(raw).match(/#\s*(\d+\s*-\s*\d+)/);
  return match ? `T:${match[1].replace(/\s+/g, "")}` : String(raw);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;

    // Main sheet + stats sheets
    const mainRange =
      process.env.SHEETS_RANGE || "'Connector Inventory'!A2:AZ";

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        mainRange,
        "Stats!A2:A", // Pin counts
        "Stats!E2:E", // Supplier list
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

      term1_tub: 22,     // W  (left label under Terminal 1)
      term1_bin: 23,     // X  (right range under Terminal 1: "Terminals #1-8")
      term1_code: 24,    // Y  (Terminal 1 part number)

      // Z, AA, etc. skipped here
      term2_code: 27,    // AB (Terminal 2 part number)
      term2_range: 28,   // AC (right range under Terminal 2: "Terminals #1-4")
      term2_tub: 29,     // AD (left label under Terminal 2)

      mating: 30,        // AE

      price: 37,         // AL

      terminalSizes: 41, // AP
      picture: 42,       // AQ (Drive URL)
    };

    const items = [];

    for (const row of rows) {
      const get = (i) => (row[i] !== undefined ? row[i] : "");

      const partNumber = get(COL.partNumber);
      const desc1 = get(COL.desc1);
      const desc2 = get(COL.desc2);
      const description = [desc1, desc2].filter(Boolean).join(" ");

      // Skip totally empty spacer rows
      const hasData =
        partNumber ||
        description ||
        get(COL.shop) ||
        get(COL.van) ||
        get(COL.pins) ||
        get(COL.category);
      if (!hasData) continue;

      // OEM flags
      const oems = [];
      if (get(COL.ford)) oems.push("Ford");
      if (get(COL.gm)) oems.push("GM");
      if (get(COL.hyundaiKia)) oems.push("HyundaiKia");
      if (get(COL.nissan)) oems.push("Nissan");
      if (get(COL.toyota)) oems.push("Toyota");

      // Picture: go from AQ value → Drive file ID → image-proxy URL
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
          // TERMINAL 1 block
          terminal1Code: get(COL.term1_code),          // from Y
          terminal1Tub: get(COL.term1_tub),            // from W (left)
          terminal1Range: formatTermRange(get(COL.term1_bin)), // from X (right)

          // TERMINAL 2 block
          terminal2Code: get(COL.term2_code),          // from AB
          terminal2Tub: get(COL.term2_tub),            // from AD (left)
          terminal2Range: formatTermRange(get(COL.term2_range)), // from AC (right)

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

    // Pin options from Stats!A2:A
    const pinOptions = pinStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => Number(a) - Number(b));

    // Manufacturer options from Stats!E2:E
    const manufacturerOptions = supplierStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort();

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
