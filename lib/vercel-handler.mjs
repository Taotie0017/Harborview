import app from "./app.mjs";

export default async function handler(req, res) {
  const protocol = req.headers["x-forwarded-proto"]?.split(",")[0] || "https";
  const host = req.headers.host;
  if (!host) throw new Error("The request is missing its host header.");

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const url = new URL(req.url, `${protocol}://${host}`);
  const routedPath = url.searchParams.get("__path");
  if (url.pathname === "/api/index" && routedPath?.startsWith("/admin") &&
      (routedPath.length === 6 || routedPath[6] === "/")) {
    url.pathname = routedPath;
    url.searchParams.delete("__path");
  } else if (url.pathname === "/api" || url.pathname === "/api/index") {
    url.pathname = "/";
  } else if (url.pathname.startsWith("/api/")) {
    url.pathname = url.pathname.slice(4);
  }

  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req;
    init.duplex = "half";
  }

  const result = await app(new Request(url, init));
  res.statusCode = result.status;
  result.headers.forEach((value, name) => {
    if (name !== "set-cookie") res.setHeader(name, value);
  });
  const cookies = result.headers.getSetCookie();
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.end(Buffer.from(await result.arrayBuffer()));
}
