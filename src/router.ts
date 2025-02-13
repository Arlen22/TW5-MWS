import * as queryString from 'node:querystring';
import { Readable } from 'stream';
import { sendResponse } from './helpers';
import { Streamer } from './server';
import { IncomingHttpHeaders } from 'node:http';
import { AuthState } from './AuthState';
import { PassThrough } from 'node:stream';

export interface Route {
  useACL: any;
  method: string;
  entityName: any;
  csrfDisable: any;
  bodyFormat: BodyFormat;
  path: RegExp;
  handler: (state: StateObject<BodyFormat>) => Promise<void>;
}

export interface MwsServerState {
  // The wiki instance used by the server.
  wiki: any;
  // Boot configuration object.
  boot: any;
  // Reference to the server instance.
  server: any;
  // Parsed URL information from the incoming request.
  urlInfo: URL;
  // Query parameters derived from the request URL.
  queryParameters: queryString.ParsedUrlQuery;
  // Optional prefix to remove from the pathname.
  pathPrefix: string;
  // Function to send a response to the client.
  sendResponse: (
    statusCode: number,
    headers: Record<string, any>,
    data: string | Buffer,
    encoding?: BufferEncoding
  ) => void;
  // Function to redirect the client.
  redirect: (statusCode: number, location: string) => void;
  // Function to stream multipart form data.
  streamMultipartData: (options: {
    cbPartStart: (headers: IncomingHttpHeaders, name: string | null, filename: string | null) => void;
    cbPartChunk: (chunk: Buffer) => void;
    cbPartEnd: () => void;
    cbFinished: (err: Error | string | null) => void;
  }) => void;
  // Function to create an ETag for a tiddler.
  makeTiddlerEtag: (options: { bag_name: string; tiddler_id: string }) => string;
  // The authenticated user object, if available.
  authenticatedUser: any;
  // Authenticated username, if available.
  authenticatedUsername?: string;
  // Request authorization type, e.g., "readers" or "writers".
  authorizationType: string;
  // Whether anonymous access is allowed.
  allowAnon: boolean;
  // Flag indicating if anonymous access is configured.
  anonAccessConfigured: boolean;
  // Whether anonymous read operations are allowed.
  allowAnonReads: boolean;
  // Whether anonymous write operations are allowed.
  allowAnonWrites: boolean;
  // Flag indicating if the anonymous configuration should be exposed (for admin users).
  showAnonConfig: boolean;
  // Indicates if this request is from the first guest user.
  firstGuestUser: boolean;
  // Optional route parameters extracted from URL pattern matching.
  params?: string[];
  // Optional parsed body data.
  data?: string | Buffer | any;
}

export class Router {
  routes: Route[] = [];
  pathPrefix: string = "";
  enableBrowserCache: boolean = true;
  enableGzip: boolean = true;
  csrfDisable: boolean = false;
  servername: string = "";
  variables = new Map();
  get(name: string): string {
    return this.variables.get(name) || "";
  }

  async handle(streamer: Streamer) {

    const authState = new AuthState(this);

    await authState.checkStreamer(streamer);

    const routeData = this.findRoute(streamer, this.pathPrefix);
    if (!routeData) return streamer.send(404, {}, { data: "Not found", encoding: "utf8" });
    const { route, params } = routeData;

    await authState.checkRoute(route);

    if (!this.csrfDisable && !route.csrfDisable && authState?.authLevelNeeded === "writers" && streamer.headers["x-requested-with"] !== "TiddlyWiki")
      return streamer.send(403, {}, { data: "'X-Requested-With' header required to login to '" + this.servername + "'", encoding: "utf8" });

    // Optionally output debug info
    if (this.get("debug-level") !== "none") {
      console.log("Request path:", JSON.stringify(streamer.url));
      console.log("Request headers:", JSON.stringify(streamer.headers));
      console.log("authenticatedUsername:", authState?.username);
    }


    const state = new StateObject(streamer, route, params, authState, this);
    const method = streamer.method;

    // anything should throw before this, but just in case
    if (streamer.ended) return;

    if (route.bodyFormat === "stream" || ["GET", "HEAD"].includes(method))
      return await route.handler(state);

    const buffer = await state.readBody();
    if (state.isBodyFormat("string")) {
      state.data = buffer.toString("utf8");
    } else if (state.isBodyFormat("www-form-urlencoded")) {
      state.data = queryString.parse(buffer.toString("utf8"));
    } else if (state.isBodyFormat("buffer")) {
      state.data = buffer;
    } else {
      state.send(400, {}, { data: "Invalid bodyFormat: " + route.bodyFormat, encoding: "utf8" });
      return;
    }
    return await route.handler(state);

  }

  findRoute(streamer: Streamer, pathPrefix: string): { route: Route; params: string[]; } | null {
    const { method, url } = streamer;
    let testPath = url.pathname || "/";
    if (pathPrefix && testPath.startsWith(pathPrefix)) {
      testPath = testPath.slice(pathPrefix.length) || "/";
    }
    for (const potentialRoute of this.routes) {
      const match = potentialRoute.path.exec(testPath);
      if (match && (method === potentialRoute.method ||
        (method === "POST" && potentialRoute.method === "PUT"))) {
        return { route: potentialRoute, params: match.slice(1) };
      }
    }
    return null;
  }

}

export type BodyFormat = "stream" | "string" | "buffer" | "www-form-urlencoded";
export class StateObject<F extends BodyFormat, P extends string[] = string[]> {

  get url() { return this.streamer.url; }
  get method() { return this.streamer.method; }
  get headers() { return this.streamer.headers; }
  get host() { return this.streamer.host; }
  get ended() { return this.streamer.ended; }
  get urlInfo() { return this.streamer.url; }
  get reader() { return this.streamer.reader; }

  readBody = this.streamer.readBody.bind(this.streamer);
  send = this.streamer.send.bind(this.streamer);
  sendFile = this.streamer.sendFile.bind(this.streamer);
  end = this.streamer.end.bind(this.streamer);

  sendResponse = sendResponse.bind(this.router, this.streamer);

  // enableBrowserCache: boolean = this.router.enableBrowserCache;
  // enableGzip: boolean = this.router.enableGzip;
  // pathPrefix: string = this.router.pathPrefix;
  get enableBrowserCache() { return this.router.enableBrowserCache; }
  get enableGzip() { return this.router.enableGzip; }
  get pathPrefix() { return this.router.pathPrefix; }
  get csrfDisable() { return this.route.csrfDisable; }
  get bodyFormat() { return this.route.bodyFormat as F; }

  queryParameters = queryString.parse(this.url.search.slice(1));
  data?:
    F extends "string" ? string :
    F extends "buffer" ? Buffer :
    F extends "www-form-urlencoded" ? queryString.ParsedUrlQuery :
    F extends "stream" ? Readable :
    never;
  constructor(
    private streamer: Streamer,
    private route: Route,
    public params: P,
    public authState: AuthState,
    private router: Router
  ) {
  }

  wiki: any;
  boot: any;
  server: any;


  makeTiddlerEtag(options: { bag_name: string; tiddler_id: string; }) {
    if (options.bag_name || options.tiddler_id) {
      return "\"tiddler:" + options.bag_name + "/" + options.tiddler_id + "\"";
    } else {
      throw "Missing bag_name or tiddler_id";
    }
  }


  isBodyFormat<T extends BodyFormat>(format: T): this is StateObject<T> {
    return this.bodyFormat as BodyFormat === format;
  }


  sendSSE(retryMilliseconds: number) {
    if (typeof retryMilliseconds !== "number" || retryMilliseconds < 0)
      throw new Error("Invalid retryMilliseconds: must be a non-negative number");

    const stream = new PassThrough();

    this.send(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    });

    stream.write(": This page is a server-sent event stream. It will continue loading until you close it.\n");
    stream.write(": https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events\n");
    stream.write("\n");

    /**
     * 
     * @param {string} eventName The event name. If zero-length, the field is omitted
     * @param eventData The data to send. Must be stringify-able to JSON.
     * @param {string} eventId The event id. If zero-length, the field is omitted.
     */
    const write = (eventName: string, eventData: any, eventId: string) => {
      if (typeof eventName !== "string")
        throw new Error("Event name must be a string (a zero-length string disables the field)");
      if (eventName.includes("\n"))
        throw new Error("Event name cannot contain newlines");
      if (typeof eventId !== "string")
        throw new Error("Event ID must be a string");
      if (eventId.includes("\n"))
        throw new Error("Event ID cannot contain newlines");

      stream.write([
        eventName && `event: ${eventName}`,
        `data: ${JSON.stringify(eventData)}`,
        eventId && `id: ${eventId}`,
        retryMilliseconds && `retry: ${retryMilliseconds}`,
      ].filter(e => e).join("\n") + "\n\n");
    }

    const close = () => stream.end();

    return { write, close };

  }
}
