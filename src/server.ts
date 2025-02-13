import * as http2 from 'node:http2';
import * as http1 from 'node:http';
import { join } from 'path';
import mime from 'mime-types';
import send from 'send';
import { Stream } from 'node:stream';
import { Readable } from 'stream';
import { createServer, IncomingMessage, Server, ServerResponse, IncomingHttpHeaders as NodeIncomingHeaders, OutgoingHttpHeaders } from 'node:http';
import { streamMultipartData } from './helpers';
import { Router } from './router';

interface IncomingHttpHeaders extends NodeIncomingHeaders {
  "accept-encoding"?: string;
}
interface ListenerOptions {
  key?: Buffer
  cert?: Buffer
  port: number
  hostname?: string
}
export function setupServers(router: Router, opts: ListenerOptions[]) {
  return opts.map(e => {
    const server = e.key && e.cert ? new ListenerHTTPS(router, e.key, e.cert) : new ListenerHTTP(router);
    server.server.listen(e.port, e.hostname);
    return server;
  });
}

const env = process.env;
export const SYMBOL_IGNORE_ERROR: unique symbol = Symbol("IGNORE_ERROR");
export const STREAM_ENDED: unique symbol = Symbol("STREAM_ENDED");

function isStringData(data: any): data is { data: string, encoding: NodeJS.BufferEncoding } {
  return typeof data === "object" && data !== null && data["data"] && data["encoding"];
}

export abstract class Streamer {
  abstract host: string;
  abstract method: string;
  abstract url: URL;

  /**
   * Duplicates in raw headers are handled in the following ways, depending on the
   * header name:
   *
   * * Duplicates of `age`, `authorization`, `content-length`, `content-type`, `etag`, `expires`, `from`, `host`, `if-modified-since`, `if-unmodified-since`, `last-modified`, `location`,
   * `max-forwards`, `proxy-authorization`, `referer`, `retry-after`, `server`, or `user-agent` are discarded.
   * To allow duplicate values of the headers listed above to be joined,
   * use the option `joinDuplicateHeaders` in {@link request} and {@link createServer}. See RFC 9110 Section 5.3 for more
   * information.
   * * `set-cookie` is always an array. Duplicates are added to the array.
   * * For duplicate `cookie` headers, the values are joined together with `; `.
   * * For all other headers, the values are joined together with `, `.
   * @since v0.1.5
   */
  abstract headers: IncomingHttpHeaders;
  abstract send(status: number, headers?: OutgoingHttpHeaders, chunk?: { data: string, encoding: NodeJS.BufferEncoding } | NodeJS.ReadableStream | Readable | Buffer): typeof STREAM_ENDED;
  abstract sendFile(root: string, filepath: string): typeof STREAM_ENDED;
  abstract end(): typeof STREAM_ENDED;
  abstract get ended(): boolean;
  abstract readBody(): Promise<Buffer>;
  abstract get reader(): Readable;

  constructor(private router: Router) {

  }

  throw(statusCode: number) {
    this.send(statusCode, {});
    throw SYMBOL_IGNORE_ERROR;
  }

  catcher = (error: unknown) => {
    if (error === SYMBOL_IGNORE_ERROR) return;
    const tag = this.url.href;
    console.error(tag, error);
  }

  redirect(statusCode: number, location: string): typeof STREAM_ENDED {
    return this.send(statusCode, { 'Location': location });
  }

  streamMultipartData = streamMultipartData.bind(this.router, this);

}

class Streamer2 extends Streamer {
  headers: IncomingHttpHeaders;
  host: string;
  method: string;
  url: URL;
  constructor(
    private stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
    router: Router
  ) {
    super(router);
    this.stream = stream;
    this.headers = headers;
    if (!headers[":authority"]) throw new Error("This should never happen");
    if (!headers[":method"]) throw new Error("This should never happen");
    if (!headers[":path"]?.startsWith("/")) throw new Error("This should never happen");
    this.host = headers[":authority"];
    this.method = headers[":method"];
    this.url = new URL(`https://${this.host}${headers[":path"]}`);
  }
  get reader() { return this.stream }
  readBody = () => new Promise<Buffer>((resolve: (chunks: Buffer) => void) => {
    const chunks: Buffer[] = [];
    this.stream.on('data', chunk => chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    this.stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
  send(status: number, headers: OutgoingHttpHeaders = {}, chunk?: { data: string, encoding: NodeJS.BufferEncoding } | NodeJS.ReadableStream | Readable | Buffer): typeof STREAM_ENDED {
    this.stream.respond({ ...headers, ':status': status });
    if (chunk === undefined) {
      this.stream.end();
    } else if (isStringData(chunk)) {
      this.stream.end(chunk.data, chunk.encoding);
    } else if (Buffer.isBuffer(chunk)) {
      this.stream.end(chunk);
    } else if (Stream.isReadable(chunk)) {
      chunk.pipe(this.stream);
    }
    return STREAM_ENDED;
  }

  sendFile(root: string, filepath: string): typeof STREAM_ENDED {
    this.stream.respondWithFile(join(root, filepath), {
      'content-type': mime.lookup(filepath) || 'application/octet-stream'
    }, {
      onError: (err) => {
        console.log(err);
        if (err.code === 'ENOENT') {
          this.send(404);
        } else {
          this.send(500);
        }
      },
      statCheck: (stats, headers, opts) => {
        headers['content-length'] = stats.size;
        return true;
      }
    });
    return STREAM_ENDED;
  }
  end(): typeof STREAM_ENDED {
    this.stream.end();
    return STREAM_ENDED;
  }

  get ended() {
    return this.stream.writableEnded;
  }
}
/**
 * The HTTP2 shims used in the request handler are only used for HTTP2 requests. 
 * The NodeJS server actually calls the HTTP1 parser for all HTTP1 requests. 
 */
class Streamer1 extends Streamer {
  host: string;
  method: string;
  url: URL;
  headers: http1.IncomingHttpHeaders;
  constructor(
    private req: IncomingMessage,
    private res: ServerResponse,
    router: Router
  ) {
    super(router);
    this.headers = req.headers;
    if (!req.headers.host) throw new Error("This should never happen");
    if (!req.method) throw new Error("This should never happen");
    if (!req.url?.startsWith("/")) throw new Error("This should never happen");
    this.host = req.headers.host;
    this.method = req.method;
    this.url = new URL(`https://${req.headers.host}${req.url}`);

  }
  get reader() { return this.req }
  readBody = () => new Promise<Buffer>((resolve: (chunk: Buffer) => void) => {
    const chunks: Buffer[] = [];
    this.req.on('data', chunk => chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    this.req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  send(status: number, headers: OutgoingHttpHeaders = {}, chunk?: { data: string, encoding: NodeJS.BufferEncoding } | NodeJS.ReadableStream | Readable | Buffer): typeof STREAM_ENDED {
    this.res.writeHead(status, headers);

    if (chunk === undefined) {
      this.res.end();
    } else if (isStringData(chunk)) {
      this.res.end(chunk.data, chunk.encoding);
    } else if (Buffer.isBuffer(chunk)) {
      this.res.end(chunk);
    } else if (Stream.isReadable(chunk)) {
      chunk.pipe(this.res);
    }

    return STREAM_ENDED;

  }
  sendFile(root: string, reqpath: string): typeof STREAM_ENDED {
    const stream = send(this.req, reqpath, {
      dotfiles: "ignore",
      index: false,
      root,
    });
    stream.on("error", err => {
      if (err === 404) {
        this.send(404);
      } else {
        this.send(500);
      }
    });
    stream.pipe(this.res);
    return STREAM_ENDED;
  }
  end(): typeof STREAM_ENDED {
    this.res.end();
    return STREAM_ENDED;
  }
  get ended() {
    return this.res.writableEnded;
  }
}
function is<T>(a: any, b: boolean): a is T {
  return b;
}
class ListenerHTTPS {
  server: http2.Http2SecureServer;
  constructor(router: Router, key: Buffer, cert: Buffer) {

    this.server = http2.createSecureServer({ key, cert, allowHTTP1: true, });

    this.server.on("request", (
      req: IncomingMessage | http2.Http2ServerRequest,
      res: ServerResponse | http2.Http2ServerResponse
    ) => {
      // these are handled in the stream handler
      if (is<http2.Http2ServerRequest>(req, req.httpVersionMajor > 1)) return;
      // complete dud for type checking. this will never be true.
      if (is<http2.Http2ServerResponse>(res, req.httpVersionMajor > 1)) return;

      const streamer = new Streamer1(req, res, router);
      router.handle(streamer).catch(streamer.catcher);
    });

    this.server.on("stream", (stream, headers) => {
      const streamer = new Streamer2(stream, headers, router);
      router.handle(streamer).catch(streamer.catcher);
    });

    this.server.on('error', errorHandler(this.server));
    this.server.on('listening', listenHandler(this.server));

  }

}

class ListenerHTTP {
  server: Server;
  /** Create an http1 server */
  constructor(router: Router) {
    this.server = createServer((req, res) => {
      const streamer = new Streamer1(req, res, router);
      router.handle(streamer).catch(streamer.catcher);
    });
    this.server.on('error', errorHandler(this.server));
    this.server.on('listening', listenHandler(this.server));
  }
}


function listenHandler(server: http2.Http2SecureServer | Server) {
  return () => {
    process.exitCode = 2;

    var addr = server.address();
    var bind = !addr ? "unknown" : typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;

    console.log('Server listening on ' + bind + ' 🚀');
    process.exitCode = 0;

  }
}

function errorHandler(server: http2.Http2SecureServer | Server) {
  return (error: NodeJS.ErrnoException) => {
    process.exitCode = 1;

    if (error.syscall !== 'listen') {
      throw error;
    }

    var bind = "";

    // handle specific listen errors with friendly messages
    switch (error.code) {
      case 'EACCES':
        console.error(bind + ' requires elevated privileges');
        process.exit();
        break;
      case 'EADDRINUSE':
        console.error(bind + ' is already in use');
        process.exit();
        break;
      default:
        throw error;
    }
  }
}

