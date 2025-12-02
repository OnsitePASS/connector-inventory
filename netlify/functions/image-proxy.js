// netlify/functions/image-proxy.js

exports.handler = async (event) => {
  try {
    const id = event.queryStringParameters && event.queryStringParameters.id;
    if (!id) {
      return { statusCode: 400, body: "Missing id parameter" };
    }

    const driveUrl =
      "https://drive.usercontent.google.com/download?id=" +
      encodeURIComponent(id) +
      "&export=view";

    const resp = await fetch(driveUrl);

    if (!resp.ok) {
      console.error("Drive fetch failed:", resp.status, await resp.text());
      return {
        statusCode: 502,
        body: "Failed to fetch image from Drive",
      };
    }

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const arrayBuf = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("image-proxy error:", err);
    return {
      statusCode: 500,
      body: "Internal Server Error",
    };
  }
};
