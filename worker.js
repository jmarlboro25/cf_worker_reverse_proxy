/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request)
  }
};

const PREFIX = "pre.";
const MAPS = {
  "a.xx.com": "b.xx.com",
};

function getPreferHost(host) {
  if (host.startsWith(PREFIX)) {
    return host.slice(PREFIX.length);
  }
  if (MAPS.hasOwnProperty(host)) {
    return MAPS[host];
  }
  return "";
}

async function handleRequest(request) {
  return new Response('Hello World!');

  const url = new URL(request.url);
  const host = url.host;

  const pre_host = getPreferHost(host);

  if (pre_host === "") {
    return new Response('Hello World!');
  }

  // if (url.protocol === 'http:') {
  //   url.protocol = 'https:';
  //   return Response.redirect(url.href, 301);
  // }

  url.host = pre_host;

  const req_headers = new Headers(request.headers);
  req_headers.set('Host', url.host);
  req_headers.set('Origin', url.origin);
  req_headers.set('X-Forwarded-Host', host);
  req_headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
  const referer = req_headers.get('Referer');
  if (referer) {
    const ref_url = new URL(referer);
    if (ref_url.host == host) {
      ref_url.host = pre_host;
    }
    req_headers.set('Referer', ref_url.href);
  }

  if (request.headers.get('Upgrade') === 'websocket') {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept()

    if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    } else {
      url.protocol = 'wss:';
    }
    req_headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
    console.info(`Proxy to ${url}`);

    await connectWebsocket_ws(server, url);
    // await connectWebsocket_tcp(server, url); // 这个连接不上

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  const req = {
    method: request.method,
    headers: req_headers,
    body: request.body,
  };

  console.info(`Proxy to ${url}`); 
  const response = await fetch(url, req);

  const rsp_headers = new Headers(response.headers);
  rsp_headers.set("Access-Control-Allow-Origin", "*");
  rsp_headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  rsp_headers.set("Access-Control-Allow-Headers", "*");
  rsp_headers.set('Access-Control-Allow-Credentials', 'true');
  rsp_headers.set('Referrer-Policy', 'no-referrer');
  rsp_headers.append("Vary", "Origin");
  rsp_headers.delete('Content-Security-Policy');
  rsp_headers.delete('Content-Security-Policy-Report-Only');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: rsp_headers
  });
}

async function connectWebsocket_ws(server, url) {
  const target = new WebSocket(url.href);

  server.addEventListener("message", async ({ data }) => {
    target.send(data);
  })
  server.addEventListener("close", async evt => {
    console.info(`client close`);
    target.close();
  })

  target.addEventListener("message", async ({ data }) => {
    server.send(data);
  })
  target.addEventListener("close", async evt => {
    console.info(`server close`);
    server.close();
  })
}

import { connect } from 'cloudflare:sockets';
async function connectWebsocket_tcp(server, url) {
  server.addEventListener('message', ({ data }) => {
    try {
      const hostname = url.hostname;
      const port = url.port || (url.protocol === 'wss:' ? 443 : 80);
      const socket = connect({ hostname, port });

      new ReadableStream({
        start(controller) {
          server.onmessage = ({ data }) => controller.enqueue(data);
          server.onerror = e => controller.error(e);
          server.onclose = e => controller.close();
        },
        cancel(reason) { server.close(); }
      }).pipeTo(socket.writable);

      socket.readable.pipeTo(new WritableStream({
        start(controller) { server.onerror = e => controller.error(e); },
        write(chunk) { server.send(chunk); }
      }));
    } catch (error) {
      server.close();
    }
  }, { once: true });
}
