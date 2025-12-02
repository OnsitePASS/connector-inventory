// netlify/functions/get-connectors.js
const { google } = require("googleapis");

// Turn "Terminals #1-8" → "T:1-8"
function formatTermRange(raw) {
  if (!raw) return "";
  const m = String(raw).match(/#\s*(\d+\s*-\s*\d+)/);
  return m ? `T:${m[1].replace(/\s+/g, "")}` : String(raw);
}

// Convert anything we get in AQ into a Drive download URL that works in <img>
function normalizeDriveUrl(raw) {
  if (!raw) return "";
  let str = String(raw).trim();
  str = str.replace(/^['"]+|['"]+$/g, ""); // strip quotes

  if (!str.includes("drive.google.com")) return str;

  let id = null;

  // ?id=FILE_ID
  const idParam = str.match(/[?&]id=([^&]+)/);
  if (idParam) id = idParam[1];

  // /file/d/FILE_ID/
  if (!id) {
    const fileMatch = str.match(/\/file\/d\/([^/]+)/);
    if (fileMatch) id = fileMatch[1];
  }

  if (!id) return str;

  // Use download host to avoid ORB blocking
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

    const resp = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        mainRange,
        "Stats!A2:A",     // pin counts
        "Stats!E2:E",     // suppliers
        "Stats!S5:S150",  // terminal sizes
      ],
    });

    const rows             = resp.data.valueRanges[0].values || [];
    const pinStatsRows     = resp.data.valueRanges[1].values || [];
    const supplierStatsRows = resp.data.valueRanges[2].values || [];
    const termSizeRows     = resp.data.valueRanges[3].values || [];

    // Column mapping (0-based)
    const COL = {
      partNumber: 1,     // B
      shop: 7,           // H
      shopQty: 8,        // I
      van: 9,            // J
      vanQty: 10,        // K
      gender: 11,        // L
      pins: 12,          // M
      category: 13,      // N
      desc1: 14,         // O (Description)
      desc2: 15,         // P (Alt Number)
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

      terminalSizes: 41, // AP (raw terminal size text)
      picture: 42,       // AQ
    };

    const items = [];

    for (const row of rows) {
      const get = (i) => (row[i] !== undefined ? row[i] : "");

      const partNumber = get(COL.partNumber);
      const desc1 = get(COL.desc1);      // description text (Col O)
      const altRaw = get(COL.desc2);     // Alt Number(s) (Col P)

      // Only Col O in main description column
      const description = desc1 || "";

      // Split Col P by commas -> Alt numbers array
      const altNumbers = String(altRaw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

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
      const pictureUrl = normalizeDriveUrl(rawPic);

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
          altNumbers,

          terminal1Code: get(COL.term1_code),
          terminal1Tub: get(COL.term1_tub),
          terminal1Range: get(COL.term1_bin),

          terminal2Code: get(COL.term2_code),
          terminal2Tub: get(COL.term2_tub),
          terminal2Range: get(COL.term2_bin),

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

    const termSizeOptions = termSizeRows
      .map((r) => r[0])
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => {
        const na = parseFloat(a);
        const nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return String(a).localeCompare(String(b));
      });

    return {
      statusCode: 200,
      body: JSON.stringify({ items, pinOptions, manufacturerOptions, termSizeOptions }),
    };
  } catch (e) {
    console.error("Error in get-connectors:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.toString() }),
    };
  }
};
