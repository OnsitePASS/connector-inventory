// netlify/functions/get-connectors.js
const { google } = require("googleapis");

function formatTermRange(raw) {
  if (!raw) return "";
  const str = String(raw);
  // Look for things like "Terminals #1-8"
  const match = str.match(/#\s*(\d+\s*-\s*\d+)/);
  if (match) {
    const range = match[1].replace(/\s*/g, "");
    return `T:${range}`;
  }
  return str;
}

exports.handler = async function (event, context) {
  try {
    if (event.httpMethod !== "GET") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
    const mainRange =
      process.env.SHEETS_RANGE || "Connector Inventory!A2:AQ";

    const pinStatsRange = "Stats!A2:A"; // Pin dropdown source
    const supplierStatsRange = "Stats!E2:E"; // Supplier dropdown source

    if (!credsJson || !spreadsheetId) {
      throw new Error(
        "Missing GOOGLE_SERVICE_ACCOUNT_JSON or SHEETS_SPREADSHEET_ID env vars"
      );
    }

    const credentials = JSON.parse(credsJson);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Read: main inventory, Stats!A2:A (pins), Stats!E2:E (suppliers)
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [mainRange, pinStatsRange, supplierStatsRange],
    });

    const mainRows = res.data.valueRanges[0]?.values || [];
    const pinStatsRows = res.data.valueRanges[1]?.values || [];
    const supplierRows = res.data.valueRanges[2]?.values || [];

    // Zero-based indexes
    const COL = {
      // Main columns
      partNumber: 1, // B
      shop: 7, // H
      shopQty: 8, // I
      van: 9, // J
      vanQty: 10, // K
      category: 11, // L - Type
      pins: 12, // M
      gender: 13, // N
      desc1: 14, // O
      desc2: 15, // P
      manufacturer: 16, // Q

      ford: 17, // R
      gm: 18, // S
      hyundaiKia: 19, // T
      nissan: 20, // U
      toyota: 21, // V

      term1Code: 22, // W
      term1Range: 23, // X

      term2Range: 28, // AC
      term2Code: 29, // AD

      mating: 30, // AE

      price: 37, // AL
      terminalSizes: 41, // AP

      picture: 42, // AQ - image URL
    };

    const items = mainRows.map((row) => {
      const get = (i) => (row[i] !== undefined ? row[i] : "");

      const desc1 = get(COL.desc1);
      const desc2 = get(COL.desc2);
      const description = [desc1, desc2].filter(Boolean).join(" ");

      const ford = get(COL.ford);
      const gm = get(COL.gm);
      const hyundaiKia = get(COL.hyundaiKia);
      const nissan = get(COL.nissan);
      const toyota = get(COL.toyota);

      const oems = [];
      if (ford) oems.push("Ford");
      if (gm) oems.push("GM");
      if (hyundaiKia) oems.push("HyundaiKia");
      if (nissan) oems.push("Nissan");
      if (toyota) oems.push("Toyota");

      const priceRaw = get(COL.price);
      const priceNum = Number(priceRaw);
      const price =
        !isNaN(priceNum) && priceRaw !== ""
          ? priceNum
          : priceRaw || ""; // keep string if not numeric

      const terminalSizes = get(COL.terminalSizes); // comma-separated

      return {
        picture: get(COL.picture),
        partNumber: get(COL.partNumber),
        description,
        shop: get(COL.shop),
        shopQty: Number(get(COL.shopQty)) || 0,
        van: get(COL.van),
        vanQty: Number(get(COL.vanQty)) || 0,
        pins: get(COL.pins),
        category: get(COL.category),
        gender: get(COL.gender),
        manufacturer: get(COL.manufacturer),
        vehicle: oems.join(", "),
        oems,
        altNumber: "",
        passNumber: "",
        terminalSizes,
        details: {
          terminal1Code: get(COL.term1Code),
          terminal1Range: formatTermRange(get(COL.term1Range)),
          terminal2Code: get(COL.term2Code),
          terminal2Range: formatTermRange(get(COL.term2Range)),
          mating: get(COL.mating),
          price,
          ford,
          gm,
          hyundaiKia,
          nissan,
          toyota,
        },
      };
    });

    // Pin options from Stats!A2:A
    const pinOptions = pinStatsRows
      .map((r) => (r && r[0] !== undefined ? String(r[0]) : ""))
      .filter((v) => v !== "")
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      });

    // Supplier options from Stats!E2:E
    const manufacturerOptions = supplierRows
      .map((r) => (r && r[0] !== undefined ? String(r[0]) : ""))
      .filter((v) => v !== "")
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => String(a).localeCompare(String(b)));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, pinOptions, manufacturerOptions }),
    };
  } catch (err) {
    console.error("get-connectors error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Server error" }),
    };
  }
};
