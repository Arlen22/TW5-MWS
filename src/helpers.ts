import { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { Streamer } from "./server";
import { StateObject } from './StateObject';
import { createHash } from "node:crypto";
import * as zlib from "node:zlib";
import { ok } from "node:assert";
import { promisify } from "node:util";
import { Router } from "./router";
/**
Options include:
- `cbPartStart(headers,name,filename)` - invoked when a file starts being received
- `cbPartChunk(chunk)` - invoked when a chunk of a file is received
- `cbPartEnd()` - invoked when a file finishes being received
- `cbFinished(err)` - invoked when the all the form data has been processed
*/
export function recieveMultipartData(this: Router, request: StateObject<any, any>, options: {
  cbPartStart: (headers: IncomingHttpHeaders, name: string | null, filename: string | null) => void,
  cbPartChunk: (chunk: Buffer) => void,
  cbPartEnd: () => void,
  cbFinished: (err: Error | string | null) => void
}) {
  return new Promise<void>((resolve, reject) => {
    // Check that the Content-Type is multipart/form-data
    const contentType = request.headers['content-type'];
    if (!contentType?.startsWith("multipart/form-data")) {
      return reject("Expected multipart/form-data content type");
    }
    // Extract the boundary string from the Content-Type header
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return reject("Missing boundary in multipart/form-data");
    }
    const boundary = boundaryMatch[1];
    const boundaryBuffer = Buffer.from("--" + boundary);
    // Initialise
    let buffer = Buffer.alloc(0);
    let processingPart = false;
    // Process incoming chunks
    request.reader.on("data", (chunk) => {
      // Accumulate the incoming data
      buffer = Buffer.concat([buffer, chunk]);
      // Loop through any parts within the current buffer
      while (true) {
        if (!processingPart) {
          // If we're not processing a part then we try to find a boundary marker
          const boundaryIndex = buffer.indexOf(boundaryBuffer);
          if (boundaryIndex === -1) {
            // Haven't reached the boundary marker yet, so we should wait for more data
            break;
          }
          // Look for the end of the headers
          const endOfHeaders = buffer.indexOf("\r\n\r\n", boundaryIndex + boundaryBuffer.length);
          if (endOfHeaders === -1) {
            // Haven't reached the end of the headers, so we should wait for more data
            break;
          }
          // Extract and parse headers
          const headersPart = Uint8Array.prototype.slice.call(buffer, boundaryIndex + boundaryBuffer.length, endOfHeaders).toString();
          const currentHeaders: IncomingHttpHeaders = {};
          headersPart.split("\r\n").forEach(headerLine => {
            const [key, value] = headerLine.split(": ");
            currentHeaders[key.toLowerCase()] = value;
          });
          // Parse the content disposition header
          const contentDisposition: {
            name: string | null,
            filename: string | null
          } = {
            name: null,
            filename: null
          };
          if (currentHeaders["content-disposition"]) {
            // Split the content-disposition header into semicolon-delimited parts
            const parts = currentHeaders["content-disposition"].split(";").map(part => part.trim());
            // Iterate over each part to extract name and filename if they exist
            parts.forEach(part => {
              if (part.startsWith("name=")) {
                // Remove "name=" and trim quotes
                contentDisposition.name = part.substring(6, part.length - 1);
              } else if (part.startsWith("filename=")) {
                // Remove "filename=" and trim quotes
                contentDisposition.filename = part.substring(10, part.length - 1);
              }
            });
          }
          processingPart = true;
          options.cbPartStart(currentHeaders, contentDisposition.name, contentDisposition.filename);
          // Slice the buffer to the next part
          buffer = Buffer.from(buffer, endOfHeaders + 4);
        } else {
          const boundaryIndex = buffer.indexOf(boundaryBuffer);
          if (boundaryIndex >= 0) {
            // Return the part up to the boundary minus the terminating LF CR
            options.cbPartChunk(Buffer.from(buffer, 0, boundaryIndex - 2));
            options.cbPartEnd();
            processingPart = false;
            // this starts at the boundary marker, which gets picked up on the next loop
            buffer = Buffer.from(buffer, boundaryIndex);
          } else {
            // Return the rest of the buffer
            options.cbPartChunk(buffer);
            // Reset the buffer and wait for more data
            buffer = Buffer.alloc(0);
            break;
          }
        }
      }
    });

    // All done
    request.reader.on("end", () => {
      resolve();
    });
  }).then(() => {
    options.cbFinished(null);
  }, (err) => {
    options.cbFinished(err);
    throw err;
  });

}

/*
Send a response to the client. This method checks if the response must be sent
or if the client alrady has the data cached. If that's the case only a 304
response will be transmitted and the browser will use the cached data.
Only requests with status code 200 are considdered for caching.
request: request instance passed to the handler
response: response instance passed to the handler
statusCode: stauts code to send to the browser
headers: response headers (they will be augmented with an `Etag` header)
data: the data to send (passed to the end method of the response instance)
encoding: the encoding of the data to send (passed to the end method of the response instance)
*/
export async function sendResponse(this: Router, state: StateObject<any, any>, statusCode: number, headers: OutgoingHttpHeaders, data: string | Buffer, encoding?: NodeJS.BufferEncoding) {
  if (this.enableBrowserCache && (statusCode == 200)) {
    var hash = createHash('md5');
    // Put everything into the hash that could change and invalidate the data that
    // the browser already stored. The headers the data and the encoding.
    hash.update(data);
    hash.update(JSON.stringify(headers));
    if (encoding) {
      hash.update(encoding);
    }
    var contentDigest = hash.digest("hex");
    // RFC 7232 section 2.3 mandates for the etag to be enclosed in quotes
    headers["Etag"] = '"' + contentDigest + '"';
    headers["Cache-Control"] = "max-age=0, must-revalidate";
    // Check if any of the hashes contained within the if-none-match header
    // matches the current hash.
    // If one matches, do not send the data but tell the browser to use the
    // cached data.
    // We do not implement "*" as it makes no sense here.
    var ifNoneMatch = state.headers["if-none-match"];
    if (ifNoneMatch) {
      var matchParts = ifNoneMatch.split(",").map(function (etag) {
        return etag.replace(/^[ "]+|[ "]+$/g, "");
      });
      if (matchParts.indexOf(contentDigest) != -1) {
        return state.sendEmpty(304, headers);
      }
    }
  }
  /*
  If the gzip=yes is set, check if the user agent permits compression. If so,
  compress our response if the raw data is bigger than 2k. Compressing less
  data is inefficient.
  */
  if (this.enableGzip && (data.length > 2048)) {
    var acceptEncoding = state.headers["accept-encoding"] || "";
    if (/\bdeflate\b/.test(acceptEncoding)) {
      headers["Content-Encoding"] = "deflate";
      data = await promisify(zlib.deflate)(data);
    } else if (/\bgzip\b/.test(acceptEncoding)) {
      headers["Content-Encoding"] = "gzip";
      data = await promisify(zlib.gzip)(data);
    }
  }
  if (typeof data === "string") {
    ok(encoding, "encoding must be set for string data");
    return state.sendString(statusCode, headers, data, encoding);
  } else {
    return state.sendBuffer(statusCode, headers, data);
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

interface State {
  wiki: any;
  boot: any;
  server: any;
  urlInfo: any;
  queryParameters: any;
  pathPrefix: string;
  sendResponse: any;
  redirect: any;
  streamMultipartData: any;
  authenticatedUser: any;
  authenticatedUsername: any;
  authorizationType: string;
  allowAnon: boolean;
  anonAccessConfigured: boolean;
  allowAnonReads: boolean;
  allowAnonWrites: boolean;
  showAnonConfig: boolean;
  firstGuestUser: boolean;
  data?: any;
}

interface Server {
  enableBrowserCache: boolean;
  enableGzip: boolean;
  get: (key: string) => any;
  methodMappings: { [key: string]: string };
  isAuthorized: (authorizationType: string, username: string) => boolean;
  getAnonymousAccessConfig: () => { allowReads: boolean; allowWrites: boolean; isEnabled: boolean; showAnonConfig: boolean };
  sqlTiddlerDatabase: any;
  servername: string;
  findMatchingRoute: (request: Streamer, state: State) => Route;
  authenticateUser: (request: Streamer, response: Streamer) => any;
  methodACLPermMappings: { [key: string]: string };
  csrfDisable: boolean;
  wiki: any;
  boot: any;
}


export function is<T>(a: any, b: boolean): a is T { return b; }

/** Initiates a timer that must get cancelled before the current turn of the event loop ends */
export class SyncCheck {
  done;
  constructor() {
    let cancelled = false;
    const error = new Error("SyncCheck was not completed before the current turn of the event loop ended");
    process.nextTick(() => {
      if (cancelled) return;
      console.log(error);
      process.exit(1);
    });
    this.done = () => { cancelled = true };
  }
}
