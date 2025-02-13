import * as http2 from 'node:http2';
import * as http1 from 'node:http';
import * as queryString from 'node:querystring';
import { stat } from 'fs/promises';
import { join, resolve } from 'path';
import mime from 'mime-types';
import send from 'send';
/**
 * @type {any}
 */
//@ts-ignore

import { ok } from 'node:assert';
import { Stream } from 'node:stream';
import { Readable } from 'stream';
import { createServer, IncomingMessage, Server, ServerResponse, IncomingHttpHeaders as NodeIncomingHeaders, OutgoingHttpHeaders } from 'node:http';
import { sendResponse, streamMultipartData } from './helpers';

interface IncomingHttpHeaders extends NodeIncomingHeaders {
  "accept-encoding"?: string;
}

const env = process.env;
export const SYMBOL_IGNORE_ERROR: unique symbol = Symbol("IGNORE_ERROR");
export const STREAM_ENDED: unique symbol = Symbol("STREAM_ENDED");

class Handler {
  private streamer!: Streamer;
  private root!: string;
  enableBrowserCache!: boolean;
  enableGzip!: boolean;

  redirect(statusCode: number, location: string): typeof STREAM_ENDED {
    return this.streamer.send(statusCode, { 'Location': location });
  }

  makeTiddlerEtag(options: { bag_name: string; tiddler_id: string; }) {
    if (options.bag_name || options.tiddler_id) {
      return "\"tiddler:" + options.bag_name + "/" + options.tiddler_id + "\"";
    } else {
      throw "Missing bag_name or tiddler_id";
    }
  }

  streamMultipartData = streamMultipartData.bind(this, this.streamer);

  sendResponse = sendResponse.bind(this, this.streamer);

  async handle(streamer: Streamer) {
    
  }

  // Modified router method to be async and use await
  async router(route: Route) {
    const method = this.streamer.method;
    if (route.bodyFormat === "stream" || method === "GET" || method === "HEAD") {
      route.handler(this.streamer);
    } else if (route.bodyFormat === "string" || route.bodyFormat === "www-form-urlencoded") {
      const buffer = await this.streamer.readBody();
      let data = buffer.toString("utf8");
      if (route.bodyFormat === "www-form-urlencoded") {
        // ...existing code for parsing form data...
        (data as any) = queryString.parse(data);
      }
      (this.streamer as any).data = data;
      route.handler(this.streamer);
    } else if (route.bodyFormat === "buffer") {
      const buffer = await this.streamer.readBody();
      (this.streamer as any).data = buffer;
      route.handler(this.streamer);
    } else {
      this.streamer.send(400, {}, { data: "Invalid bodyFormat: " + route.bodyFormat, encoding: "utf8" });
    }
  }

}

interface Route {
  useACL: any;
  method: string;
  entityName: any;
  csrfDisable: any;
  bodyFormat: string;
  path: { source: string; };
  handler: (streamer: Streamer) => void;
};

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

  throw(statusCode: number) {
    this.send(statusCode, {});
    throw SYMBOL_IGNORE_ERROR;
  }

  catcher = (error: unknown) => {
    if (error === SYMBOL_IGNORE_ERROR) return;
    const tag = this.url.href;
    console.error(tag, error);
  }

}

class Streamer2 extends Streamer {
  private stream: http2.ServerHttp2Stream;
  headers: IncomingHttpHeaders;
  host: string;
  method: string;
  url: URL;
  /** 
  * @param {import("http2").ServerHttp2Stream} stream 
  * @param {import("http2").IncomingHttpHeaders} headers
  */
  constructor(stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) {
    super();
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

class Streamer1 extends Streamer {
  host: string;
  method: string;
  url: URL;
  headers: http1.IncomingHttpHeaders;
  constructor(
    private req: http2.Http2ServerRequest | IncomingMessage,
    private res: http2.Http2ServerResponse<http2.Http2ServerRequest> | ServerResponse
  ) {
    super();
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

class ListenerHTTPS {
  server: http2.Http2SecureServer;
  constructor(private handler: Handler, key: Buffer, cert: Buffer) {

    this.server = http2.createSecureServer({
      key,
      cert,
      allowHTTP1: true,
    }, (req, res) => {
      // these are handled in the stream handler
      if (req.httpVersion === "2.0") return;
      const streamer = new Streamer1(req, res);
      handler.handle(streamer).catch(streamer.catcher);
    });

    this.server.on("stream", (stream, headers) => {
      const streamer = new Streamer2(stream, headers);
      handler.handle(streamer).catch(streamer.catcher);
    });

    this.server.on('error', errorHandler(this.server));
    this.server.on('listening', listenHandler(this.server));

  }

}

class ListenerHTTP {
  server: Server;
  /** Create an http1 server */
  constructor(private handler: Handler) {
    this.server = createServer((req, res) => {
      const streamer = new Streamer1(req, res);
      handler.handle(streamer).catch(streamer.catcher);
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

