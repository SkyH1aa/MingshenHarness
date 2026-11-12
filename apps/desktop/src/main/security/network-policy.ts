import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export function isPrivateAddress(raw: string): boolean {
  const address = raw.replace(/^\[|\]$/g, "").toLowerCase();
  if (address.startsWith("::ffff:"))
    return isIP(address.slice(7)) === 4 ? isPrivateAddress(address.slice(7)) : true;
  if (isIP(address) === 6)
    return (
      address === "::" ||
      address === "::1" ||
      address.startsWith("64:ff9b:") ||
      address.startsWith("2002:") ||
      address.startsWith("2001:0:") ||
      /^(?:fc|fd|fe[89ab]|ff)/.test(address) ||
      address.startsWith("2001:db8:")
    );
  if (isIP(address) !== 4) return false;
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 198 && [18, 19].includes(b))
  );
}
export async function assertPublicUrl(value: string | URL): Promise<URL> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Only HTTP(S) URLs without embedded credentials are allowed.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname.toLowerCase() === "localhost" || /\.(?:localhost|local|internal)$/i.test(hostname))
    throw new Error("Private network targets are blocked for Agent web fetch.");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address)))
    throw new Error(
      "Private, loopback and metadata network targets are blocked for Agent web fetch.",
    );
  return url;
}
export async function publicFetch(value: string | URL, init: RequestInit = {}): Promise<Response> {
  let url = await assertPublicUrl(value);
  for (let index = 0; index <= 5; index++) {
    const response = await new Promise<Response>((resolveResponse, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          method: init.method ?? "GET",
          headers: Object.fromEntries(new Headers(init.headers).entries()),
          signal: init.signal ?? undefined,
          lookup: (hostname, options, callback) => {
            void lookup(hostname, { all: true, verbatim: true })
              .then((addresses) => {
                if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address)))
                  throw new Error("Private DNS result blocked.");
                if (options.all) callback(null, addresses);
                else callback(null, addresses[0]?.address ?? "", addresses[0]?.family ?? 4);
              })
              .catch((error: NodeJS.ErrnoException) => callback(error, "", 4));
          },
        },
        (incoming) => {
          let total = 0;
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > 2 * 1024 * 1024) {
              incoming.destroy(new Error("Web response exceeds 2 MiB."));
              return;
            }
            chunks.push(chunk);
          });
          incoming.on("error", reject);
          incoming.on("end", () => {
            const headers = new Headers();
            for (const [key, entry] of Object.entries(incoming.headers))
              if (entry !== undefined)
                headers.set(key, Array.isArray(entry) ? entry.join(", ") : entry);
            const status = incoming.statusCode ?? 502;
            resolveResponse(
              new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
                status,
                headers,
              }),
            );
          });
        },
      );
      request.on("error", reject);
      request.end(typeof init.body === "string" ? init.body : undefined);
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || index === 5) throw new Error("Invalid or excessive redirects.");
    url = await assertPublicUrl(new URL(location, url));
  }
  throw new Error("Excessive redirects.");
}
