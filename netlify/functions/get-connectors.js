// netlify/functions/get-connectors.js
const { google } = require("googleapis");

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
    const range = process.env.SHEETS_RANGE || "Inventory!A2:AZ";

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
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = res.data.values || [];

    // TODO: adjust these indices to match your actual sheet columns
    const COL = {
      picture: 0,
      partNumber: 1,
      description: 2,
      shop: 3,
      shopQty: 4,
      van: 5,
      vanQty: 6,
      pins: 7,
      category: 8,
      gender: 9,
      manufacturer: 10,
      vehicle: 11,
      altNumber: 12,
      passNumber: 13,
      terminalSizes: 14,
      // add more indices here to populate `details` if you want
    };

    const items = rows.map((row) => {
      const get = (i) => (row[i] !== undefined ? row[i] : "");

      return {
        picture: get(COL.picture),
        partNumber: get(COL.partNumber),
        description: get(COL.description),
        shop: get(COL.shop),
        shopQty: Number(get(COL.shopQty)) || 0,
        van: get(COL.van),
        vanQty: Number(get(COL.vanQty)) || 0,
        pins: get(COL.pins),
        category: get(COL.category),
        gender: get(COL.gender),
        manufacturer: get(COL.manufacturer),
        vehicle: get(COL.vehicle),
        altNumber: get(COL.altNumber),
        passNumber: get(COL.passNumber),
        terminalSizes: get(COL.terminalSizes),
        details: {
          // Example if you want later:
          // termTub1: get(15),
          // termBin1: get(16),
          // terminal1: get(17),
          // ...
        },
      };
    });

    const pinSet = new Set();
    const mfrSet = new Set();

    for (const item of items) {
      if (item.pins) pinSet.add(String(item.pins));
      if (item.manufacturer) mfrSet.add(item.manufacturer);
    }

    const pinOptions = Array.from(pinSet);
    const manufacturerOptions = Array.from(mfrSet);

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
