# Mingshen Harness Local SDK

```js
import { MingshenClient } from "./mingshen-client.mjs";

const client = new MingshenClient({
  baseUrl: "http://127.0.0.1:4096",
  token: "<token shown in Mingshen Settings>",
});

await client.health();
const sessions = await client.sessions();
```

The server binds to loopback by default. It exposes health, agents, sessions,
messages, child sessions, todos, trajectories, MCP/LSP/formatter status and SSE
events. Share links are local read-only URLs and expire after 24 hours.

## ACP bridge

Start the local server from `Settings > Runtime & Integrations`, copy its token,
then configure an ACP-compatible editor to launch:

```powershell
$env:MINGSHEN_SERVER_URL="http://127.0.0.1:4096"
$env:MINGSHEN_SERVER_TOKEN="<token shown in Settings>"
node "<Mingshen install directory>\resources\sdk\mingshen-acp.mjs"
```

The bridge uses JSON-RPC over newline-delimited stdio and maps Mingshen chat,
reasoning, tool and completion events into ACP `session/update` notifications.
