// netlify/functions/get-connectors.js
const { google } = require("googleapis");

// Convert "Terminals #1-8" → "T:1-8"
function formatTermRange(raw) {
  if (!raw) return "";
  const match = String(raw).match(/#\s*(\d+\s*-\s*\d+)/);
  return match ? `T:${match[1].replace(/\s+/g, "")}` : String(raw);
}

/**
 * Turn *any* Drive-ish value into a 400px thumbnail URL.
 *
 * Handles:
 *   - https://drive.google.com/file/d/ID/view?...
 *   - https://drive.google.com/uc?export=view&id=ID
 *   - https://drive.google.com/thumbnail?id=ID&sz=w400
 *   - bare IDs like 1DkJngqekuCgrFz0wF13MlOVPj59Zk3cj
 * Falls back to returning the original string for non-Drive URLs.
 */
function buildDriveThumbnailUrl(raw) {
  if (!raw) return "";
  let str = String(raw).trim();

  // Strip surrounding quotes if present
  str = str.replace(/^['"]+|['"]+$/g, "");

  let id = null;

  // Case 1: ...?id=FILE_ID...
  const idParam = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) {
    id = idParam[1];
  }

  // Case 2: .../file/d/FILE_ID/...
  if (!id) {
    const fileMatch = str.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) {
      id = fileMatch[1];
    }
  }

  // Case 3: looks like a bare Drive ID (no URL at all)
  if (!id) {
    const bareMatch = str.match(/^[a-zA-Z0-9_-]{20,}$/);
    if (bareMatch) {
      id = bareMatch[0];
    }
  }

  // If we still don't have an ID AND it's not a drive URL, just return as-is
  if (!id) {
    // Let non-Drive URLs (e.g. CDN) pass through unchanged
    return str;
  }

  // Thumbnail endpoint – keeps payload small and works well in <img>
  return `https://drive.google.com/thumbnail?id=${id}&sz=w400`;
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
    const mainRange =
      process.env.SHEETS_RANGE || "'Connector Inventory'!A2:AZ";

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Pull main data + stats ranges
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        mainRange,      // 0: main inventory
        "Stats!A2:A",   // 1: pin counts
        "Stats!E2:E",   // 2: suppliers
        "Stats!S5:S150" // 3: terminal sizes for dropdown
      ],
    });

    const rows = response.data.valueRanges[0].values || [];
    const pinStatsRows = response.data.valueRanges[1].values || [];
    const supplierStatsRows = response.data.valueRanges[2].values || [];
    const termSizeStatsRows = response.data.valueRanges[3].values || [];

    // Column index mapping (0-based)
    const COL = {
      partNumber: 1,     // B
      shop: 7,           // H
      shopQty: 8,        // I
      van: 9,            // J
      vanQty: 10,        // K
      gender: 11,        // L  ("M/F" on site)
      pins: 12,          // M
      category: 13,      // N  (Type)
      desc1: 14,         // O  (Description)
      altNumber: 15,     // P  (Alt Number)
      manufacturer: 16,  // Q  (Supplier)

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
      const desc1 = get(COL.desc1);          // Description (Col O)
      const altNumber = get(COL.altNumber);  // Alt Number (Col P)

      // Description column (web) → only Column O
      const description = desc1 || "";

      // Skip totally empty / spacer rows
      const hasData =
        partNumber ||
        description ||
        get(COL.shop) ||
        get(COL.van) ||
        get(COL.pins) ||
        get(COL.category);

      if (!hasData) continue;

      const oems = [];
      if (get(COL.ford)) oems.push("Ford");
      if (get(COL.gm)) oems.push("GM");
      if (get(COL.hyundaiKia)) oems.push("HyundaiKia");
      if (get(COL.nissan)) oems.push("Nissan");
      if (get(COL.toyota)) oems.push("Toyota");

      const rawPic = get(COL.picture);
      const pictureUrl = buildDriveThumbnailUrl(rawPic);

      items.push({
        picture: pictureUrl,
        partNumber,
        description,      // only Column O
        altNumber,        // Column P, for "Alt Number" in submenu

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
          // Alt Number in submenu
          altNumber,

          // Terminal 1
          terminal1Code: get(COL.term1_code),
          terminal1Range: formatTermRange(get(COL.term1_bin)),
          terminal1Tub: get(COL.term1_tub),

          // Terminal 2
          terminal2Code: get(COL.term2_code),
          terminal2Range: formatTermRange(get(COL.term2_bin)),
          terminal2Tub: get(COL.term2_tub),

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

    // Pin count options (Stats!A2:A)
    const pinOptions = pinStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      });

    // Supplier dropdown options (Stats!E2:E)
    const manufacturerOptions = supplierStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => String(a).localeCompare(String(b)));

    // Terminal size dropdown options (Stats!S5:S150)
    const termSizeOptions = termSizeStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      });

    return {
      statusCode: 200,
      body: JSON.stringify({
        items,
        pinOptions,
        manufacturerOptions,
        termSizeOptions,
      }),
    };
  } catch (e) {
    console.error("Error in get-connectors:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.toString() }),
    };
  }
};
