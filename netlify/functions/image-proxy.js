// netlify/functions/image-proxy.js

// Simple generic image proxy. It just takes ?url=... and streams it back.
// This runs on the server, so ORB / CORS rules in the browser don't apply.

exports.handler = async function (event) {
  try {
    const url = event.queryStringParameters && event.queryStringParameters.url;
    if (!url) {
      return {
        statusCode: 400,
        body: "Missing 'url' query parameter",
      };
    }

    // Basic safety: only allow http/https
    if (!/^https?:\/\//i.test(url)) {
      return {
        statusCode: 400,
        body: "Invalid URL",
      };
    }

    // Use built-in fetch (Node 18+)
    const upstream = await fetch(url);

    if (!upstream.ok) {
      console.error("Upstream image error:", upstream.status, upstream.statusText);
      return {
        statusCode: upstream.status,
        body: `Upstream error: ${upstream.status} ${upstream.statusText}`,
      };
    }

    const contentType =
      upstream.headers.get("content-type") || "image/jpeg";

    const arrayBuffer = await upstream.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
      body: base64,
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("image-proxy error:", err);
    return {
      statusCode: 500,
      body: "Image proxy error",
    };
  }
};
