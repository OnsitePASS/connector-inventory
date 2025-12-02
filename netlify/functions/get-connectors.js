// netlify/functions/get-connectors.js
const { google } = require("googleapis");

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

    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;

    // We only need through AQ (picture URL)
    const mainRange =
      process.env.SHEETS_RANGE || "'Connector Inventory'!A2:AQ";

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        mainRange,
        "Stats!A2:A",     // Pin counts
        "Stats!E2:E",     // Supplier list
        "Stats!S5:S150",  // Terminal Size options
      ],
    });

    const rows = response.data.valueRanges[0].values || [];
    const pinStatsRows = response.data.valueRanges[1].values || [];
    const supplierStatsRows = response.data.valueRanges[2].values || [];
    const termSizeRows = response.data.valueRanges[3].values || [];

    // 0-based column mapping
    const COL = {
      partNumber: 1,     // B
      shop: 7,           // H
      shopQty: 8,        // I
      van: 9,            // J
      vanQty: 10,        // K
      gender: 11,        // L
      pins: 12,          // M
      category: 13,      // N
      desc1: 14,         // O  (Description)
      desc2: 15,         // P  (Alt Number)
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
      const desc1 = get(COL.desc1);   // Description
      const desc2 = get(COL.desc2);   // Alt Number(s)

      const description = desc1 || "";
      const altNumber = desc2 || "";

      // Skip totally blank spacer rows
      const hasData =
        partNumber ||
        description ||
        altNumber ||
        get(COL.shop) ||
        get(COL.van) ||
        get(COL.pins) ||
        get(COL.category);

      if (!hasData) continue;

      // OEM flags → array
      const oems = [];
      if (get(COL.ford)) oems.push("Ford");
      if (get(COL.gm)) oems.push("GM");
      if (get(COL.hyundaiKia)) oems.push("HyundaiKia");
      if (get(COL.nissan)) oems.push("Nissan");
      if (get(COL.toyota)) oems.push("Toyota");

      // Picture URL – leave as-is (you already store a working uc?export=view&id=... URL)
      const pictureRaw = get(COL.picture);
      const pictureUrl = pictureRaw ? String(pictureRaw).trim() : "";

      items.push({
        // Top-level fields used by the frontend
        picture: pictureUrl,
        partNumber,
        description,  // from column O only
        altNumber,    // from column P

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

        // Submenu / details block
        details: {
          // Terminal 1
          terminal1Code: get(COL.term1_code),                     // Y
          terminal1Tub: get(COL.term1_tub),                       // W
          terminal1Range: formatTermRange(get(COL.term1_bin)),    // X

          // Terminal 2
          terminal2Code: get(COL.term2_code),                     // AB
          terminal2Tub: get(COL.term2_tub),                       // AD
          terminal2Range: formatTermRange(get(COL.term2_bin)),    // AC

          mating: get(COL.mating),
          price: get(COL.price),

          // Alt Number for submenu
          altNumber,

          ford: get(COL.ford),
          gm: get(COL.gm),
          hyundaiKia: get(COL.hyundaiKia),
          nissan: get(COL.nissan),
          toyota: get(COL.toyota),
        },
      });
    }

    // Helper: dedupe, drop blanks
    const dedupe = (arr) =>
      arr.filter((v, i) => v && arr.indexOf(v) === i);

    // Pin Count options
    const pinOptions = dedupe(pinStatsRows.map((r) => r[0])).sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });

    // Supplier options
    const manufacturerOptions = dedupe(
      supplierStatsRows.map((r) => r[0])
    ).sort((a, b) => String(a).localeCompare(String(b)));

    // Terminal Size options (Stats!S5:S150)
    const termSizeOptions = dedupe(termSizeRows.map((r) => r[0]));

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
