// netlify/functions/image-proxy.js
//
// Proxy a *thumbnail* from Google Drive so the Netlify
// function response stays under the 6 MB limit.

exports.handler = async (event) => {
  try {
    const id = event.queryStringParameters && event.queryStringParameters.id;
    if (!id) {
      return { statusCode: 400, body: "Missing id parameter" };
    }

    // Use Drive's thumbnail endpoint instead of full download.
    // sz=w600 gives a nice medium-sized image; you can make it
    // smaller (w400, w300) if you want to be extra safe.
    const driveThumbUrl =
      "https://drive.google.com/thumbnail?id=" +
      encodeURIComponent(id) +
      "&sz=w600";

    const resp = await fetch(driveThumbUrl);

    if (!resp.ok) {
      console.error("Drive thumbnail fetch failed:", resp.status, await resp.text());
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
        // Cache on browser / CDN so we don't keep re-fetching the same image
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
