import { ok } from "assert";
import { AuthState, AuthStateRouteACL } from "./AuthState";
import { Streamer } from "./server";
import { StateObject } from "./StateObject";
import RootRoute from "./routes";


export const AllowedMethods = [...["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE"] as const];
export type AllowedMethod = typeof AllowedMethods[number];

export const BodyFormats = ["stream", "string", "buffer", "www-form-urlencoded"] as const;
export type BodyFormat = typeof BodyFormats[number];

export class Router {
  pathPrefix: string = "";
  enableBrowserCache: boolean = true;
  enableGzip: boolean = true;
  csrfDisable: boolean = false;
  servername: string = "";
  variables = new Map();
  get(name: string): string {
    return this.variables.get(name) || "";
  }
  rootRoute: Route;
  constructor() {
    this.rootRoute = defineRoute(ROOT_ROUTE, {
      useACL: {},
      method: AllowedMethods,
      path: /^/,
      // we can put handler stuff here if we want, but at the moment that's not necessary
      handler: async (state: any) => state,
    });
    RootRoute(this.rootRoute as rootRoute);
  }

  async handle(streamer: Streamer) {

    const authState = new AuthState(this);

    await authState.checkStreamer(streamer);

    const matchedRoutes = this.findRoute(streamer);
    if (!matchedRoutes.length) return streamer.sendString(404, {}, "Not found", "utf8");

    await authState.checkMatchedRoutes(matchedRoutes);

    // Optionally output debug info
    // if (this.get("debug-level") !== "none") {
    console.log("Request path:", JSON.stringify(streamer.url));
    console.log("Request headers:", JSON.stringify(streamer.headers));
    console.log(authState.toDebug());
    // }

    const bodyFormat = matchedRoutes.find(e => e.route.bodyFormat)?.route.bodyFormat || "string";

    const state = new StateObject(streamer, matchedRoutes, bodyFormat, authState, this);
    const method = streamer.method;

    // anything that sends a response before this should have thrown, but just in case
    if (streamer.headersSent) return;

    if (state.isBodyFormat("stream") || ["GET", "HEAD", "OPTIONS"].includes(method))
      return await this.handleRoute(state, matchedRoutes);

    if (state.isBodyFormat("string")) {
      state.data = (await state.readBody()).toString("utf8");
    } else if (state.isBodyFormat("www-form-urlencoded")) {
      state.data = new URLSearchParams((await state.readBody()).toString("utf8"));
    } else if (state.isBodyFormat("buffer")) {
      state.data = await state.readBody();
    } else {
      // this is a server error, not a client error
      return state.sendString(500, {}, "Invalid bodyFormat: " + state.bodyFormat, "utf8");
    }
    return await this.handleRoute(state, matchedRoutes);

  }

  async handleRoute(state: StateObject<BodyFormat>, route: RouteMatch[]) {
    await state.authState.checkStateObject(state);
    let result: any = state;
    for (const match of route) {
      result = await match.route.handler(result);
      if (state.headersSent) return;
    }
  }

  findRouteRecursive(
    routes: Route[],
    testPath: string,
    method: AllowedMethod
  ): RouteMatch[] {
    for (const potentialRoute of routes) {
      // Skip if the method doesn't match.
      if (!potentialRoute.method.includes(method)) continue;

      // Try to match the path.
      const match = potentialRoute.path.exec(testPath);

      if (match) {
        // The matched portion of the path.
        const matchedPortion = match[0];
        // Remove the matched portion from the testPath.
        const remainingPath = testPath.slice(matchedPortion.length) || "/";

        const result = {
          route: potentialRoute,
          params: match.slice(1),
          remainingPath,
        };
        const { childRoutes = [] } = potentialRoute as any; // see this.defineRoute
        // If there are inner routes, try to match them recursively.
        if (childRoutes.length > 0) {
          const innerMatch = this.findRouteRecursive(
            childRoutes,
            remainingPath,
            method
          );
          return [result, ...innerMatch];
        } else {
          return [result];
        }
      }
    }
    return [];
  }

  // Top-level function that starts matching from the root routes.
  // Notice that the pathPrefix is assumed to have been handled beforehand.
  findRoute(streamer: Streamer): RouteMatch[] {
    const { method, url } = streamer;
    let testPath = url.pathname || "/";
    if (this.pathPrefix && testPath.startsWith(this.pathPrefix))
      testPath = testPath.slice(this.pathPrefix.length) || "/";
    return this.findRouteRecursive([this.rootRoute], testPath, method);
  }



}

interface RouteOptAny extends RouteOptBase<BodyFormat, AllowedMethod[], any> { }

// interface RouteOptNoBody<B extends BodyFormat, M extends AllowedMethod[]>
//   extends RouteOptBase<B, M> {
//   bodyFormat?: undefined,
//   // handler: (state: StateObject<B, M[number]>) => Promise<R>;
// }

// interface RouteOptWithBody<B extends BodyFormat, M extends AllowedMethod[]>
//   extends RouteOptBase<B, M> {
//   bodyFormat: B;
//   // handler: (state: StateObject<B, M[number]>) => Promise<R>;
// }
interface RouteOptBase<B extends BodyFormat, M extends AllowedMethod[], R> {
  useACL: AuthStateRouteACL;
  path: RegExp;
  method: M;
  bodyFormat?: B;
  handler: (state: StateObject<B, M[number]>) => Promise<R>
}

export type Route = RouteDef<[BodyFormat | undefined, AllowedMethod[], any]>;

export type rootRoute = RouteDef<[undefined, AllowedMethod[], StateObject<BodyFormat, AllowedMethod>]>;

/**
 * ### ROUTING
 *
 * @param parent The parent route to attach this route to.
 * @param route The route definition.
 *
 * If the parent route sends headers, or returns the STREAM_ENDED symbol, 
 * this route will not be called.
 *
 * Inner routes are matched on the remaining portion of the parent route
 * using `pathname.slice(match[0].length)`. If the parent route entirely 
 * matches the pathname, this route will be matched on "/".
 */
interface RouteDef<P extends [BodyFormat | undefined, AllowedMethod[], any]> {
  /** The ACL options for this route. It is required to simplify updates, but could be empty by default */
  useACL: AuthStateRouteACL;
  /** The uppercase method names to match this route */
  method: P[1];
  /** 
   * Regex to test the pathname on. It must start with `^`. If this is a child route, 
   * it will be tested against the remaining portion of the parent route.  
   */
  path: RegExp;
  /** The highest bodyformat in the chain always takes precedent. */
  bodyFormat: P[0];
  /**
   * If this route's handler sends headers, the matched child route will not be called.
   */
  handler: (state: any) => Promise<P[2]>;

  defineRoute:
  P extends [BodyFormat, AllowedMethod[], any] ?

  <R, T extends RouteOptBase<P[0], P[1], R> & { bodyFormat?: undefined }>(
    route: T,
    // handler: (state: P[2] & StateObject<P[0], T["method"][number]>) => Promise<R>
  ) => RouteDef<[P[0], T["method"], R]>

  : P extends [undefined, AllowedMethod[], any] ? {
    <R, T extends { [K in BodyFormat]: RouteOptBase<K, P[1], R> & { bodyFormat: K } }[BodyFormat]>(
      route: T
    ): RouteDef<[T["bodyFormat"], T["method"], R]>

    <R, T extends RouteOptBase<BodyFormat, P[1], R> & { bodyFormat?: undefined }>(
      route: T
    ): RouteDef<[undefined, T["method"], R]>



  }

  : never;
  // : P extends [undefined, AllowedMethod[], any] ?
  // <T extends RouteOptNoBody<BodyFormat, P[1], GetHandler<T>>>
  //   (parent: { $o?: P }, route: T) =>
  //   RouteDef<[undefined, T["method"], GetHandler<T>]>



  $o?: P;
}
type ExtractLiteral<T> = T extends string ? T : T;
type GetHandler<T extends { handler: (state: any) => Promise<any> }> = Awaited<ReturnType<T["handler"]>>;
type t1 = ("1" | "2") & ("1")
export interface RouteMatch<Params extends string[] = string[]> {
  route: Route;
  params: Params;
  remainingPath: string;
}

const ROOT_ROUTE: unique symbol = Symbol("ROOT_ROUTE");

function defineRoute(
  parent: { $o?: any, method: any } | typeof ROOT_ROUTE,
  route: RouteOptAny
) {

  if (route.bodyFormat && !BodyFormats.includes(route.bodyFormat))
    throw new Error("Invalid bodyFormat: " + route.bodyFormat);
  if (!route.method.every(e => (parent === ROOT_ROUTE ? AllowedMethods : parent.method).includes(e)))
    throw new Error("Invalid method: " + route.method);
  if (route.path.source[0] !== "^")
    throw new Error("Path regex must start with ^");

  if (parent !== ROOT_ROUTE) {
    // the typing is too complicated if we add childRoutes
    if (!(parent as any).childRoutes) (parent as any).childRoutes = [];
    (parent as any).childRoutes.push(route);
  }

  (route as any).defineRoute = defineRoute.bind(null, route)

  return route as any; // this is usually ignored except for the root route.
}
/** This doesn't need to run, it's just to test types */
function testroute(root: rootRoute) {

  const test1 = root.defineRoute({
    useACL: {},
    path: /^test/,
    method: ["GET"],
    bodyFormat: undefined,
    handler: async state => {
      const test: "string" | "stream" | "buffer" | "www-form-urlencoded" = state.bodyFormat;
    },
  });

  const test2 = test1.defineRoute({
    useACL: {},
    path: /^test/,
    bodyFormat: "buffer",
    method: ["GET"],
    handler: async state => {
      //@ts-expect-error because we didn't include "buffer"
      const test: "string" | "stream" | "www-form-urlencoded" = state.bodyFormat;
      // no error here if bodyFormat is correctly typed
      const test2: "buffer" = state.bodyFormat
      // @ts-expect-error because it should be "buffer"
      state.isBodyFormat("string");
      // this should never be an error unless something is really messed up
      state.isBodyFormat("buffer");
    },
  });

  const test3 = test2.defineRoute({
    useACL: {},
    path: /^test/,
    method: ["GET"],
    // @ts-expect-error because it's already been defined by the parent
    bodyFormat: "buffer",
    handler: async state => {
      //@ts-expect-error because we didn't include "buffer"
      const test: "string" | "stream" | "www-form-urlencoded" = state.bodyFormat;
      // no error here if bodyFormat is correctly typed
      const test2: "buffer" = state.bodyFormat
      // @ts-expect-error because it should be "buffer"
      state.isBodyFormat("string");
      // this should never be an error unless something is really messed up
      state.isBodyFormat("buffer");
    },
  })
}