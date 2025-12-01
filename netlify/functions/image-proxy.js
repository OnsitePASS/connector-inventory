// netlify/functions/image-proxy.js

// This function proxies a Google Drive image so the browser only
// talks to your Netlify domain (avoids ORB blocking).

exports.handler = async (event) => {
  try {
    const id = event.queryStringParameters?.id;
    if (!id) {
      return { statusCode: 400, body: "Missing id" };
    }

    // Use a direct-download style URL from Drive
    const driveUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(
      id
    )}`;

    // Node 18+ has global fetch available in Netlify functions
    const res = await fetch(driveUrl);

    if (!res.ok) {
      console.error("Drive fetch failed", res.status, await res.text());
      return {
        statusCode: 502,
        body: `Upstream error ${res.status}`,
      };
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("image-proxy error:", err);
    return {
      statusCode: 500,
      body: "Internal error",
    };
  }
};
