import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { Readable } from "node:stream";
import { session } from "electron";
import { assertPublicUrl, isPrivateAddress } from "../security/network-policy";

async function directFetch(url: URL, init?: RequestInit): Promise<Response> {
  return new Promise((done, reject) => {
    const outgoing = request(
      url,
      {
        method: "GET",
        signal: init?.signal ?? undefined,
        headers: {
          Accept: "application/zip, application/octet-stream",
          "Accept-Encoding": "identity",
        },
        lookup: (hostname, options, callback) => {
          void lookup(hostname, { all: true, verbatim: true })
            .then((addresses) => {
              if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address)))
                throw new Error("Private DNS result blocked for update download.");
              if (options.all) callback(null, addresses);
              else callback(null, addresses[0]?.address ?? "", addresses[0]?.family ?? 4);
            })
            .catch((error) => callback(error, "", 4));
        },
      },
      (incoming) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers))
          if (value !== undefined && key !== "set-cookie")
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        const status = incoming.statusCode ?? 502;
        if ([204, 205, 304].includes(status)) {
          incoming.resume();
          done(new Response(null, { status, headers }));
        } else
          done(
            new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
              status,
              headers,
            }),
          );
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

export function createUpdateFetcher(): typeof fetch {
  // An in-memory Chromium session preserves the system proxy while excluding browser profiles.
  const isolated = session.fromPartition("mingshen-update-downloads");
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const name of Object.keys(headers))
      if (/^(?:cookie|authorization|x-api-key|api-key|apikey|referer)$/i.test(name))
        delete headers[name];
    callback({ requestHeaders: headers });
  });
  isolated.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const name of Object.keys(headers)) if (/^set-cookie$/i.test(name)) delete headers[name];
    callback({ responseHeaders: headers });
  });
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    if (url.protocol !== "https:") {
      callback({ cancel: true });
      return;
    }
    void assertPublicUrl(url).then(
      () => callback({}),
      () => callback({ cancel: true }),
    );
  });
  return (async (input, init) => {
    const url = new URL(String(input));
    await assertPublicUrl(url);
    const proxy = await isolated.resolveProxy(url.href);
    // Pin and revalidate the actual socket lookup on direct connections. A configured
    // system proxy remains the user's trusted network boundary and resolves its own DNS.
    return !proxy || proxy === "DIRECT" ? directFetch(url, init) : isolated.fetch(url.href, init);
  }) as typeof fetch;
}
