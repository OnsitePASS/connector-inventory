// netlify/functions/get-connectors.js
const { google } = require("googleapis");

// Convert "Terminals #1-8" → "T:1-8"
function formatTermRange(raw) {
  if (!raw) return "";
  const str = String(raw);
  const match = str.match(/#\s*(\d+\s*-\s*\d+)/);
  return match ? `T:${match[1].replace(/\s+/g, "")}` : str;
}

// Force a direct Google Drive image URL that works in <img>
function toDriveDirect(url) {
  if (!url) return "";
  let str = String(url).trim();

  // Strip surrounding quotes if the sheet stored it as '"https://..."'
  str = str.replace(/^['"]+|['"]+$/g, "");

  // If it's not a Drive URL, just return as-is
  if (!str.includes("drive.google.com")) return str;

  // Extract the file ID from either ?id=... or /file/d/ID/ format
  let id = null;

  // e.g. https://drive.google.com/uc?export=view&id=FILE_ID
  const idParamMatch = str.match(/[?&]id=([^&]+)/);
  if (idParamMatch) {
    id = idParamMatch[1];
  }

  // e.g. https://drive.google.com/file/d/FILE_ID/view
  if (!id) {
    const fileMatch = str.match(/\/file\/d\/([^/]+)/);
    if (fileMatch) {
      id = fileMatch[1];
    }
  }

  // If we still don't have an ID, fall back to original string
  if (!id) return str;

  // Use the same host+path that worked in your guest window
  return `https://drive.usercontent.google.com/download?id=${id}&export=view`;
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

    // Column index mapping (0-based)
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

      // Skip totally blank / spacer rows
      const hasData =
        partNumber ||
        description ||
        get(COL.shop) ||
        get(COL.van) ||
        get(COL.pins) ||
        get(COL.category);

      if (!hasData) continue;

      const rawPic = get(COL.picture);
      const pictureUrl = toDriveDirect(rawPic);

      const oems = [];
      if (get(COL.ford)) oems.push("Ford");
      if (get(COL.gm)) oems.push("GM");
      if (get(COL.hyundaiKia)) oems.push("HyundaiKia");
      if (get(COL.nissan)) oems.push("Nissan");
      if (get(COL.toyota)) oems.push("Toyota");

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
          // Terminal 1: main code from Y, subline W (tub) + X (bin → T:1-8)
          terminal1Code: get(COL.term1_code),
          terminal1Tub: get(COL.term1_tub),
          terminal1Range: formatTermRange(get(COL.term1_bin)),

          // Terminal 2: main code from AB, subline AD (tub) + AC (bin → T:1-8)
          terminal2Code: get(COL.term2_code),
          terminal2Tub: get(COL.term2_tub),
          terminal2Range: formatTermRange(get(COL.term2_bin)),

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

    // Unique pin count options from Stats!A2:A
    const pinOptions = pinStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => Number(a) - Number(b));

    // Unique supplier options from Stats!E2:E
    const manufacturerOptions = supplierStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort();

    // Quick sanity log (optional)
    if (items.length > 0) {
      console.log("Sample item from API:", items[0]);
    }

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
