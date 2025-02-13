import * as http2 from 'node:http2';
import * as http1 from 'node:http';
import * as fs from "fs";
import * as stream from "stream";
import { join } from 'path';
import mime from 'mime-types';
import send from 'send';
import { Duplex, Stream } from 'node:stream';
import { Readable } from 'stream';
import { createServer, IncomingMessage, Server, ServerResponse, IncomingHttpHeaders as NodeIncomingHeaders, OutgoingHttpHeaders } from 'node:http';
import { streamMultipartData } from './helpers';
import { BodyFormat, StateObject, Router } from './router';
import { FileHandle } from 'fs/promises';

/** An attempt to check whether HTTP1 requests can be handled using the HTTP2 API. */
class HTTP1Compat extends Duplex implements http2.ServerHttp2Stream {
  req: http1.IncomingMessage = {} as any;
  res: http1.ServerResponse = {} as any;
  constructor(){
    super();
  }
  /**
   * True if headers were sent, false otherwise (read-only).
   * @since v8.4.0
   */
  readonly headersSent: boolean = false;
  /**
   * Read-only property mapped to the `SETTINGS_ENABLE_PUSH` flag of the remote
   * client's most recent `SETTINGS` frame. Will be `true` if the remote peer
   * accepts push streams, `false` otherwise. Settings are the same for every `Http2Stream` in the same `Http2Session`.
   * @since v8.4.0
   */
  readonly pushAllowed: boolean = false;
  /**
   * Sends an additional informational `HEADERS` frame to the connected HTTP/2 peer.
   * @since v8.4.0
   */
  additionalHeaders(headers: OutgoingHttpHeaders): void {

  }
  /**
   * Initiates a push stream. The callback is invoked with the new `Http2Stream` 
   * instance created for the push stream passed as the second argument, or an 
   * `Error` passed as the first argument.
   * 
   * Since HTTP/1.1 clients do not support server push, the callback will always
   * be invoked with an `Error` instance.
   *
   */
  pushStream(
    headers: OutgoingHttpHeaders,
    callback?: (err: Error | null, pushStream: http2.ServerHttp2Stream, headers: OutgoingHttpHeaders) => void,
  ): void;
  pushStream(
    headers: OutgoingHttpHeaders,
    options?: http2.StreamPriorityOptions,
    callback?: (err: Error | null, pushStream: http2.ServerHttp2Stream, headers: OutgoingHttpHeaders) => void,
  ): void;
  pushStream(...args: any[]) {
    if (typeof args[args.length - 1] === "function") {
      args[args.length - 1](new Error("HTTP/1.1 clients do not support server push"), null, {});
    }
  }
  /**
   * ```js
   * import http2 from 'node:http2';
   * const server = http2.createServer();
   * server.on('stream', (stream) => {
   *   stream.respond({ ':status': 200 });
   *   stream.end('some data');
   * });
   * ```
   *
   * Initiates a response. When the `options.waitForTrailers` option is set, the `'wantTrailers'` event
   * will be emitted immediately after queuing the last chunk of payload data to be sent.
   * The `http2stream.sendTrailers()` method can then be used to send trailing header fields to the peer.
   *
   * When `options.waitForTrailers` is set, the `Http2Stream` will not automatically
   * close when the final `DATA` frame is transmitted. User code must call either 
   * `http2stream.sendTrailers()` or `http2stream.close()` to close the `Http2Stream`.
   *
   * ```js
   * import http2 from 'node:http2';
   * const server = http2.createServer();
   * server.on('stream', (stream) => {
   *   stream.respond({ ':status': 200 }, { waitForTrailers: true });
   *   stream.on('wantTrailers', () => {
   *     stream.sendTrailers({ ABC: 'some value to send' });
   *   });
   *   stream.end('some data');
   * });
   * ```
   * @since v8.4.0
   */
  respond(headers?: OutgoingHttpHeaders, options?: http2.ServerStreamResponseOptions): void {

  }
  /**
   * Initiates a response whose data is read from the given file descriptor. No
   * validation is performed on the given file descriptor. If an error occurs while
   * attempting to read data using the file descriptor, the `Http2Stream` will be
   * closed using an `RST_STREAM` frame using the standard `INTERNAL_ERROR` code.
   *
   * When used, the `Http2Stream` object's `Duplex` interface will be closed
   * automatically.
   *
   */
  respondWithFD(
    fd: number | fs.promises.FileHandle,
    headers?: OutgoingHttpHeaders,
    options?: http2.ServerStreamFileResponseOptions,
  ): void {

  }
  /**
   * Sends a regular file as the response. The `path` must specify a regular file
   * or an `'error'` event will be emitted on the `Http2Stream` object.
   *
   * When used, the `Http2Stream` object's `Duplex` interface will be closed
   * automatically.
   *
   * The optional `options.statCheck` function may be specified to give user code
   * an opportunity to set additional content headers based on the `fs.Stat` details
   * of the given file:
   *
   * If an error occurs while attempting to read the file data, the `Http2Stream` will be closed using an
   * `RST_STREAM` frame using the standard `INTERNAL_ERROR` code.
   * If the `onError` callback is defined, then it will be called. Otherwise, the stream will be destroyed.
   *
   * Example using a file path:
   *
   * ```js
   * import http2 from 'node:http2';
   * const server = http2.createServer();
   * server.on('stream', (stream) => {
   *   function statCheck(stat, headers) {
   *     headers['last-modified'] = stat.mtime.toUTCString();
   *   }
   *
   *   function onError(err) {
   *     // stream.respond() can throw if the stream has been destroyed by
   *     // the other side.
   *     try {
   *       if (err.code === 'ENOENT') {
   *         stream.respond({ ':status': 404 });
   *       } else {
   *         stream.respond({ ':status': 500 });
   *       }
   *     } catch (err) {
   *       // Perform actual error handling.
   *       console.error(err);
   *     }
   *     stream.end();
   *   }
   *
   *   stream.respondWithFile('/some/file',
   *                          { 'content-type': 'text/plain; charset=utf-8' },
   *                          { statCheck, onError });
   * });
   * ```
   *
   * The `options.statCheck` function may also be used to cancel the send operation
   * by returning `false`. For instance, a conditional request may check the stat
   * results to determine if the file has been modified to return an appropriate `304` response:
   *
   * ```js
   * import http2 from 'node:http2';
   * const server = http2.createServer();
   * server.on('stream', (stream) => {
   *   function statCheck(stat, headers) {
   *     // Check the stat here...
   *     stream.respond({ ':status': 304 });
   *     return false; // Cancel the send operation
   *   }
   *   stream.respondWithFile('/some/file',
   *                          { 'content-type': 'text/plain; charset=utf-8' },
   *                          { statCheck });
   * });
   * ```
   *
   * The `content-length` header field will be automatically set.
   *
   * The `offset` and `length` options may be used to limit the response to a
   * specific range subset. This can be used, for instance, to support HTTP Range
   * requests.
   *
   * The `options.onError` function may also be used to handle all the errors
   * that could happen before the delivery of the file is initiated. The
   * default behavior is to destroy the stream.
   *
   * When the `options.waitForTrailers` option is set, the `'wantTrailers'` event
   * will be emitted immediately after queuing the last chunk of payload data to be
   * sent. The `http2stream.sendTrailers()` method can then be used to sent trailing
   * header fields to the peer.
   *
   * When `options.waitForTrailers` is set, the `Http2Stream` will not automatically
   * close when the final `DATA` frame is transmitted. User code must call either`http2stream.sendTrailers()` or `http2stream.close()` to close the`Http2Stream`.
   *
   * ```js
   * import http2 from 'node:http2';
   * const server = http2.createServer();
   * server.on('stream', (stream) => {
   *   stream.respondWithFile('/some/file',
   *                          { 'content-type': 'text/plain; charset=utf-8' },
   *                          { waitForTrailers: true });
   *   stream.on('wantTrailers', () => {
   *     stream.sendTrailers({ ABC: 'some value to send' });
   *   });
   * });
   * ```
   * @since v8.4.0
   */
  respondWithFile(
    path: string,
    headers?: OutgoingHttpHeaders,
    options?: http2.ServerStreamFileResponseOptionsWithError,
  ): void {

  }

  /**
   * Set to `true` if the `Http2Stream` instance was aborted abnormally. When set,
   * the `'aborted'` event will have been emitted.
   * @since v8.4.0
   */
  readonly aborted: boolean = false;
  /**
   * This property shows the number of characters currently buffered to be written.
   * See `net.Socket.bufferSize` for details.
   * @since v11.2.0, v10.16.0
   */
  readonly bufferSize: number = 0;
  /**
   * Set to `true` if the `Http2Stream` instance has been closed.
   * @since v9.4.0
   */
  readonly closed: boolean = false;
  /**
   * Set to `true` if the `Http2Stream` instance has been destroyed and is no longer
   * usable.
   * @since v8.4.0
   */
  readonly destroyed: boolean = false;
  /**
   * Set to `true` if the `END_STREAM` flag was set in the request or response
   * HEADERS frame received, indicating that no additional data should be received
   * and the readable side of the `Http2Stream` will be closed.
   * @since v10.11.0
   */
  readonly endAfterHeaders: boolean = false;
  /**
   * The numeric stream identifier of this `Http2Stream` instance. Set to `undefined` if the stream identifier has not yet been assigned.
   * @since v8.4.0
   */
  readonly id?: number | undefined;
  /**
   * Set to `true` if the `Http2Stream` instance has not yet been assigned a
   * numeric stream identifier.
   * @since v9.4.0
   */
  readonly pending: boolean = true;
  /**
   * Set to the `RST_STREAM` `error code` reported when the `Http2Stream` is
   * destroyed after either receiving an `RST_STREAM` frame from the connected peer,
   * calling `http2stream.close()`, or `http2stream.destroy()`. Will be `undefined` if the `Http2Stream` has not been closed.
   * @since v8.4.0
   */
  readonly rstCode: number = undefined as any;
  /**
   * An object containing the outbound headers sent for this `Http2Stream`.
   * @since v9.5.0
   */
  readonly sentHeaders: OutgoingHttpHeaders = {};
  /**
   * An array of objects containing the outbound informational (additional) headers
   * sent for this `Http2Stream`.
   * @since v9.5.0
   */
  readonly sentInfoHeaders?: OutgoingHttpHeaders[] | undefined;
  /**
   * An object containing the outbound trailers sent for this `HttpStream`.
   * @since v9.5.0
   */
  readonly sentTrailers?: OutgoingHttpHeaders | undefined;
  /**
   * A reference to the `Http2Session` instance that owns this `Http2Stream`. The
   * value will be `undefined` after the `Http2Stream` instance is destroyed.
   * @since v8.4.0
   */
  readonly session: http2.Http2Session | undefined = undefined;
  /**
   * Provides miscellaneous information about the current state of the `Http2Stream`.
   *
   * A current state of this `Http2Stream`.
   * @since v8.4.0
   */
  readonly state: http2.StreamState = {} as any;
  /**
   * Closes the `Http2Stream` instance by sending an `RST_STREAM` frame to the
   * connected HTTP/2 peer.
   * @since v8.4.0
   * @param [code=http2.constants.NGHTTP2_NO_ERROR] Unsigned 32-bit integer identifying the error code.
   * @param callback An optional function registered to listen for the `'close'` event.
   */
  close(code?: number, callback?: () => void): void {

  }
  /**
   * Updates the priority for this `Http2Stream` instance.
   * @since v8.4.0
   */
  priority(options: http2.StreamPriorityOptions): void {

  }
  /**
   * ```js
   * import http2 from 'node:http2';
   * const client = http2.connect('http://example.org:8000');
   * const { NGHTTP2_CANCEL } = http2.constants;
   * const req = client.request({ ':path': '/' });
   *
   * // Cancel the stream if there's no activity after 5 seconds
   * req.setTimeout(5000, () => req.close(NGHTTP2_CANCEL));
   * ```
   * @since v8.4.0
   */
  setTimeout(msecs: number, callback?: () => void): void {

  }
  /**
   * Sends a trailing `HEADERS` frame to the connected HTTP/2 peer. This method
   * will cause the `Http2Stream` to be immediately closed and must only be
   * called after the `'wantTrailers'` event has been emitted. When sending a
   * request or sending a response, the `options.waitForTrailers` option must be set
   * in order to keep the `Http2Stream` open after the final `DATA` frame so that
   * trailers can be sent.
   *
   * ```js
   * import http2 from 'node:http2';
   * const server = http2.createServer();
   * server.on('stream', (stream) => {
   *   stream.respond(undefined, { waitForTrailers: true });
   *   stream.on('wantTrailers', () => {
   *     stream.sendTrailers({ xyz: 'abc' });
   *   });
   *   stream.end('Hello World');
   * });
   * ```
   *
   * The HTTP/1 specification forbids trailers from containing HTTP/2 pseudo-header
   * fields (e.g. `':method'`, `':path'`, etc).
   * @since v10.0.0
   */
  sendTrailers(headers: OutgoingHttpHeaders): void {

  }
  // http events
  addListener(event: "aborted", listener: () => void): this;
  addListener(event: "close", listener: () => void): this;
  addListener(event: "data", listener: (chunk: Buffer | string) => void): this;
  addListener(event: "drain", listener: () => void): this;
  addListener(event: "end", listener: () => void): this;
  addListener(event: "error", listener: (err: Error) => void): this;
  addListener(event: "finish", listener: () => void): this;
  addListener(event: "frameError", listener: (frameType: number, errorCode: number) => void): this;
  addListener(event: "pipe", listener: (src: stream.Readable) => void): this;
  addListener(event: "unpipe", listener: (src: stream.Readable) => void): this;
  addListener(event: "streamClosed", listener: (code: number) => void): this;
  addListener(event: "timeout", listener: () => void): this;
  addListener(event: "trailers", listener: (trailers: http1.IncomingHttpHeaders, flags: number) => void): this;
  addListener(event: "wantTrailers", listener: () => void): this;
  addListener(event: "close", listener: () => void): this;
  // duplex events
  addListener(event: "data", listener: (chunk: any) => void): this;
  addListener(event: "drain", listener: () => void): this;
  addListener(event: "end", listener: () => void): this;
  addListener(event: "error", listener: (err: Error) => void): this;
  addListener(event: "finish", listener: () => void): this;
  addListener(event: "pause", listener: () => void): this;
  addListener(event: "pipe", listener: (src: Readable) => void): this;
  addListener(event: "readable", listener: () => void): this;
  addListener(event: "resume", listener: () => void): this;
  addListener(event: "unpipe", listener: (src: Readable) => void): this;
  addListener(event: string | symbol, listener: (...args: any[]) => void): this {
    return this;
  }
  // http events
  emit(event: "aborted"): boolean;
  emit(event: "close"): boolean;
  emit(event: "data", chunk: Buffer | string): boolean;
  emit(event: "drain"): boolean;
  emit(event: "end"): boolean;
  emit(event: "error", err: Error): boolean;
  emit(event: "finish"): boolean;
  emit(event: "frameError", frameType: number, errorCode: number): boolean;
  emit(event: "pipe", src: stream.Readable): boolean;
  emit(event: "unpipe", src: stream.Readable): boolean;
  emit(event: "streamClosed", code: number): boolean;
  emit(event: "timeout"): boolean;
  emit(event: "trailers", trailers: http1.IncomingHttpHeaders, flags: number): boolean;
  emit(event: "wantTrailers"): boolean;
  // duplex events
  emit(event: "close"): boolean;
  emit(event: "data", chunk: any): boolean;
  emit(event: "drain"): boolean;
  emit(event: "end"): boolean;
  emit(event: "error", err: Error): boolean;
  emit(event: "finish"): boolean;
  emit(event: "pause"): boolean;
  emit(event: "pipe", src: Readable): boolean;
  emit(event: "readable"): boolean;
  emit(event: "resume"): boolean;
  emit(event: "unpipe", src: Readable): boolean;
  emit(event: string | symbol, ...args: any[]): boolean {
    return true;
  }
  // http events
  on(event: "aborted", listener: () => void): this;
  on(event: "close", listener: () => void): this;
  on(event: "data", listener: (chunk: Buffer | string) => void): this;
  on(event: "drain", listener: () => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "finish", listener: () => void): this;
  on(event: "frameError", listener: (frameType: number, errorCode: number) => void): this;
  on(event: "pipe", listener: (src: stream.Readable) => void): this;
  on(event: "unpipe", listener: (src: stream.Readable) => void): this;
  on(event: "streamClosed", listener: (code: number) => void): this;
  on(event: "timeout", listener: () => void): this;
  on(event: "trailers", listener: (trailers: http1.IncomingHttpHeaders, flags: number) => void): this;
  on(event: "wantTrailers", listener: () => void): this;
  //duplex events
  on(event: "close", listener: () => void): this;
  on(event: "data", listener: (chunk: any) => void): this;
  on(event: "drain", listener: () => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "finish", listener: () => void): this;
  on(event: "pause", listener: () => void): this;
  on(event: "pipe", listener: (src: Readable) => void): this;
  on(event: "readable", listener: () => void): this;
  on(event: "resume", listener: () => void): this;
  on(event: "unpipe", listener: (src: Readable) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return this;
  }
  // http events
  once(event: "aborted", listener: () => void): this;
  once(event: "close", listener: () => void): this;
  once(event: "data", listener: (chunk: Buffer | string) => void): this;
  once(event: "drain", listener: () => void): this;
  once(event: "end", listener: () => void): this;
  once(event: "error", listener: (err: Error) => void): this;
  once(event: "finish", listener: () => void): this;
  once(event: "frameError", listener: (frameType: number, errorCode: number) => void): this;
  once(event: "pipe", listener: (src: stream.Readable) => void): this;
  once(event: "unpipe", listener: (src: stream.Readable) => void): this;
  once(event: "streamClosed", listener: (code: number) => void): this;
  once(event: "timeout", listener: () => void): this;
  once(event: "trailers", listener: (trailers: http1.IncomingHttpHeaders, flags: number) => void): this;
  once(event: "wantTrailers", listener: () => void): this;
  once(event: "close", listener: () => void): this;
  // duplex events
  once(event: "data", listener: (chunk: any) => void): this;
  once(event: "drain", listener: () => void): this;
  once(event: "end", listener: () => void): this;
  once(event: "error", listener: (err: Error) => void): this;
  once(event: "finish", listener: () => void): this;
  once(event: "pause", listener: () => void): this;
  once(event: "pipe", listener: (src: Readable) => void): this;
  once(event: "readable", listener: () => void): this;
  once(event: "resume", listener: () => void): this;
  once(event: "unpipe", listener: (src: Readable) => void): this;

  once(event: string | symbol, listener: (...args: any[]) => void): this {
    return this;
  }
  // http events
  prependListener(event: "aborted", listener: () => void): this;
  prependListener(event: "close", listener: () => void): this;
  prependListener(event: "data", listener: (chunk: Buffer | string) => void): this;
  prependListener(event: "drain", listener: () => void): this;
  prependListener(event: "end", listener: () => void): this;
  prependListener(event: "error", listener: (err: Error) => void): this;
  prependListener(event: "finish", listener: () => void): this;
  prependListener(event: "frameError", listener: (frameType: number, errorCode: number) => void): this;
  prependListener(event: "pipe", listener: (src: stream.Readable) => void): this;
  prependListener(event: "unpipe", listener: (src: stream.Readable) => void): this;
  prependListener(event: "streamClosed", listener: (code: number) => void): this;
  prependListener(event: "timeout", listener: () => void): this;
  prependListener(event: "trailers", listener: (trailers: http1.IncomingHttpHeaders, flags: number) => void): this;
  prependListener(event: "wantTrailers", listener: () => void): this;
  // duplex events
  prependListener(event: "close", listener: () => void): this;
  prependListener(event: "data", listener: (chunk: any) => void): this;
  prependListener(event: "drain", listener: () => void): this;
  prependListener(event: "end", listener: () => void): this;
  prependListener(event: "error", listener: (err: Error) => void): this;
  prependListener(event: "finish", listener: () => void): this;
  prependListener(event: "pause", listener: () => void): this;
  prependListener(event: "pipe", listener: (src: Readable) => void): this;
  prependListener(event: "readable", listener: () => void): this;
  prependListener(event: "resume", listener: () => void): this;
  prependListener(event: "unpipe", listener: (src: Readable) => void): this;
  prependListener(event: string | symbol, listener: (...args: any[]) => void): this {
    return this;
  }
  // http events
  prependOnceListener(event: "aborted", listener: () => void): this;
  prependOnceListener(event: "close", listener: () => void): this;
  prependOnceListener(event: "data", listener: (chunk: Buffer | string) => void): this;
  prependOnceListener(event: "drain", listener: () => void): this;
  prependOnceListener(event: "end", listener: () => void): this;
  prependOnceListener(event: "error", listener: (err: Error) => void): this;
  prependOnceListener(event: "finish", listener: () => void): this;
  prependOnceListener(event: "frameError", listener: (frameType: number, errorCode: number) => void): this;
  prependOnceListener(event: "pipe", listener: (src: stream.Readable) => void): this;
  prependOnceListener(event: "unpipe", listener: (src: stream.Readable) => void): this;
  prependOnceListener(event: "streamClosed", listener: (code: number) => void): this;
  prependOnceListener(event: "timeout", listener: () => void): this;
  prependOnceListener(event: "trailers", listener: (trailers: http1.IncomingHttpHeaders, flags: number) => void): this;
  prependOnceListener(event: "wantTrailers", listener: () => void): this;
  // duplex events
  prependOnceListener(event: "close", listener: () => void): this;
  prependOnceListener(event: "data", listener: (chunk: any) => void): this;
  prependOnceListener(event: "drain", listener: () => void): this;
  prependOnceListener(event: "end", listener: () => void): this;
  prependOnceListener(event: "error", listener: (err: Error) => void): this;
  prependOnceListener(event: "finish", listener: () => void): this;
  prependOnceListener(event: "pause", listener: () => void): this;
  prependOnceListener(event: "pipe", listener: (src: Readable) => void): this;
  prependOnceListener(event: "readable", listener: () => void): this;
  prependOnceListener(event: "resume", listener: () => void): this;
  prependOnceListener(event: "unpipe", listener: (src: Readable) => void): this;
  prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this {
    return this;
  }
  // http events
  removeListener(event: "aborted", listener: () => void): this;
  removeListener(event: "close", listener: () => void): this;
  removeListener(event: "data", listener: (chunk: Buffer | string) => void): this;
  removeListener(event: "drain", listener: () => void): this;
  removeListener(event: "end", listener: () => void): this;
  removeListener(event: "error", listener: (err: Error) => void): this;
  removeListener(event: "finish", listener: () => void): this;
  removeListener(event: "frameError", listener: (frameType: number, errorCode: number) => void): this;
  removeListener(event: "pipe", listener: (src: stream.Readable) => void): this;
  removeListener(event: "unpipe", listener: (src: stream.Readable) => void): this;
  removeListener(event: "streamClosed", listener: (code: number) => void): this;
  removeListener(event: "timeout", listener: () => void): this;
  removeListener(event: "trailers", listener: (trailers: http1.IncomingHttpHeaders, flags: number) => void): this;
  removeListener(event: "wantTrailers", listener: () => void): this;
  // duplex events
  removeListener(event: "close", listener: () => void): this;
  removeListener(event: "data", listener: (chunk: any) => void): this;
  removeListener(event: "drain", listener: () => void): this;
  removeListener(event: "end", listener: () => void): this;
  removeListener(event: "error", listener: (err: Error) => void): this;
  removeListener(event: "finish", listener: () => void): this;
  removeListener(event: "pause", listener: () => void): this;
  removeListener(event: "pipe", listener: (src: Readable) => void): this;
  removeListener(event: "readable", listener: () => void): this;
  removeListener(event: "resume", listener: () => void): this;
  removeListener(event: "unpipe", listener: (src: Readable) => void): this;
  removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
    return this;
  }
}



