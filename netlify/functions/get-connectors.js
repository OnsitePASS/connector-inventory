// netlify/functions/get-connectors.js
const { google } = require("googleapis");

// Build a direct Google Drive image URL that works in <img>
function toDriveDirect(url) {
  if (!url) return "";
  let str = String(url).trim();

  // Strip any wrapping quotes
  str = str.replace(/^['"]+|['"]+$/g, "");

  // Extract file ID from ?id= or /d/ formats
  const m =
    str.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    str.match(/\/d\/([a-zA-Z0-9_-]+)/);

  if (!m) {
    // Not a drive URL we understand – just return as-is
    return str;
  }

  const id = m[1];
  // Direct content host that works in <img> without redirects
  return `https://drive.usercontent.google.com/uc?id=${id}&export=view`;
}

// Convert "Terminals #1-8" → "T:1-8"
function formatTermRange(raw) {
  if (!raw) return "";
  const match = String(raw).match(/#\s*(\d+\s*-\s*\d+)/);
  return match ? `T:${match[1].replace(/\s+/g, "")}` : String(raw);
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // ---- Auth + Sheets client ----
    const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;

    if (!credsJson || !spreadsheetId) {
      throw new Error(
        "Missing GOOGLE_SERVICE_ACCOUNT_JSON or SHEETS_SPREADSHEET_ID env vars"
      );
    }

    const creds = JSON.parse(credsJson);
    const mainRange =
      process.env.SHEETS_RANGE || "'Connector Inventory'!A2:AZ";

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // ---- Fetch data ----
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        mainRange,
        "Stats!A2:A", // pin counts
        "Stats!E2:E", // suppliers
      ],
    });

    const vr = response.data.valueRanges || [];

    const rows = (vr[0] && vr[0].values) || [];
    const pinStatsRows = (vr[1] && vr[1].values) || [];
    const supplierStatsRows = (vr[2] && vr[2].values) || [];

    // ---- Column map (0-based) ----
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

    // ---- Build items ----
    const items = rows
      .map((row) => {
        const get = (i) => (row && row[i] !== undefined ? row[i] : "");

        const partNumber = get(COL.partNumber);
        const desc1 = get(COL.desc1);
        const desc2 = get(COL.desc2);
        const description = [desc1, desc2].filter(Boolean).join(" ");

        // Skip spacer / fully empty rows
        const hasData =
          partNumber ||
          description ||
          get(COL.shop) ||
          get(COL.van) ||
          get(COL.pins) ||
          get(COL.category);

        if (!hasData) return null;

        const oems = [];
        if (get(COL.ford)) oems.push("Ford");
        if (get(COL.gm)) oems.push("GM");
        if (get(COL.hyundaiKia)) oems.push("HyundaiKia");
        if (get(COL.nissan)) oems.push("Nissan");
        if (get(COL.toyota)) oems.push("Toyota");

        const rawPic = get(COL.picture);
        const pictureUrl = toDriveDirect(rawPic);

        return {
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
            terminal1Code: get(COL.term1_code),
            terminal1Range: formatTermRange(get(COL.term1_bin)),
            terminal1Tub: get(COL.term1_tub),

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
        };
      })
      .filter(Boolean); // drop nulls

    // ---- Dropdown options ----
    const pinOptions = pinStatsRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => Number(a) - Number(b));

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
