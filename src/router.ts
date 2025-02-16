import { ok } from "assert";
import { AuthState, AuthStateRouteACL } from "./AuthState";
import { Streamer } from "./server";
import { StateObject } from "./StateObject";
import querystring from "querystring";
import RootRoute from "./routes";


export const AllowedMethods = [...["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE"] as const];
export type AllowedMethod = typeof AllowedMethods[number];

export const BodyFormats = ["stream", "string", "buffer", "www-form-urlencoded"] as const;
export type BodyFormat = typeof BodyFormats[number];

export type Route = RouteDef<any, BodyFormat | undefined, AllowedMethod[], any, 1>;

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
    this.rootRoute = RootRoute(this);
  }

  async handle(streamer: Streamer) {

    const authState = new AuthState(this);

    await authState.checkStreamer(streamer);

    const matchedRoutes = this.findRoute(streamer);
    if (!matchedRoutes.length) return streamer.sendString(404, {}, "Not found", "utf8");

    await authState.checkMatchedRoutes(matchedRoutes);

    // Optionally output debug info
    if (this.get("debug-level") !== "none") {
      console.log("Request path:", JSON.stringify(streamer.url));
      console.log("Request headers:", JSON.stringify(streamer.headers));
      console.log(authState.toDebug());
    }

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
      state.data = querystring.parse((await state.readBody()).toString("utf8"));
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
  defineRoute<
    P extends RouteParent<S>,
    B extends P["bodyFormat"] extends BodyFormat ? undefined : BodyFormat | undefined,
    M extends P["method"][number][],
    S,
    R
  >(parent: P, route: RouteDef<P, B, M, R, 0>): RouteDef<P, B, M, R, 1> {
    if (route.bodyFormat && !BodyFormats.includes(route.bodyFormat))
      throw new Error("Invalid bodyFormat: " + route.bodyFormat);
    if (!route.method.every(e => parent.method.includes(e)))
      throw new Error("Invalid method: " + route.method);
    if (route.path.source[0] !== "^")
      throw new Error("Path regex must start with ^");

    // the typing is too complicated if we add childRoutes
    if (!(parent as any).childRoutes) (parent as any).childRoutes = [];
    (parent as any).childRoutes.push(route);
    return route as any;
  }
}

export interface RouteMatch<Params extends string[] = string[]> {
  route: Route;
  params: Params;
  remainingPath: string;
}


export interface RouteParent<S> {
  handler: (state: any) => Promise<S>;
  bodyFormat?: BodyFormat | undefined,
  method: readonly AllowedMethod[]
};

type ParentState<P, M extends AllowedMethod> = P extends RouteParent<infer S>
  // I shouldn't need to handle subclasses because nothing should be inheriting from StateObject
  ? S extends StateObject ? StateObject<BodyFormat, M> : S
  : never;

interface RouteDef<
  P extends RouteParent<any>,
  B extends P["bodyFormat"] extends BodyFormat ? P["bodyFormat"] : BodyFormat | undefined,
  M extends P["method"][number][],
  R,
  Z extends number
> {
  /** The ACL options for this route. It is required to simplify updates, but could be empty by default */
  useACL: AuthStateRouteACL;
  /** The uppercase method names to match this route */
  method: Z extends 0 ? M : M[number][];
  /** 
   * Regex to test the pathname on. It must start with `^`. If this is a child route, 
   * it will be tested against the remaining portion of the parent route.  
   */
  path: RegExp;
  /** The highest bodyformat in the chain always takes precedent. */
  bodyFormat?: B;
  /**
   * If this route's handler sends headers, the matched child route will not be called.
   */
  handler: (state: ParentState<P, M[number]>) => Promise<R>;
}
