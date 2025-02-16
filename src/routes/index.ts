import { AuthStateRouteACL } from "../AuthState";
import { StateObject } from "../StateObject";

export const AllowedMethods = [...["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE"] as const];
export type BodyFormat = "stream" | "string" | "buffer" | "www-form-urlencoded";
export type AllowedMethods = typeof AllowedMethods[number];
export type Route = RouteDef<typeof root, BodyFormat | undefined, AllowedMethods[], any, 1>;

interface RouteParent<S> {
  handler: (state: any) => Promise<S>;
  bodyFormat?: BodyFormat | undefined,
  method: readonly AllowedMethods[]
};

type ChildRoute<R> = RouteDef<any, BodyFormat | undefined, AllowedMethods[], R, 1>;

type ParentState<P, M extends AllowedMethods> = P extends RouteParent<infer S>
  // I shouldn't need to handle subclasses because nothing should be inheriting from StateObject
  ? S extends StateObject ? StateObject<BodyFormat, M> : S
  : never;

{
  let x: never;
  const x1: Exclude<keyof Route, keyof RouteDef<any, any, any, any, any>> = {} as never;
  const x2: Exclude<keyof RouteDef<any, any, any, any, any>, keyof Route> = {} as never;
  // this makes sure the Route and RouteDef types have the same keys
  // one or both of the following lines will error if they don't.
  x = x1;
  x = x2;
}

interface RouteDef<
  P extends RouteParent<any>,
  B extends P["bodyFormat"] extends undefined ? BodyFormat | undefined : undefined,
  M extends P["method"][number][],
  R,
  Z extends number
> {
  /** The ACL options for this route. It is required to simplify updates, but could be empty by default */
  useACL: AuthStateRouteACL;
  /** The uppercase method names to match this route */
  method: Z extends 0 ? M : M[number][];
  /** Regex to test the pathname on. It must start with `^/` */
  path: RegExp;
  /** The highest bodyformat in the chain always takes precedent. */
  bodyFormat?: B;
  /**
   * ### ROUTING
   *
   * The `innerRoutes` property is used to create a tree of routes.
   *
   * If this route's handler sends headers, the matched child route will not be called.
   *
   * Inner routes are matched on the remaining portion
   * using `pathname.slice(match[0].length)`. If this route
   * entirely matches the pathname, inner routes will be matched on "/".
   */
  childRoutes?:
  Z extends 0 ? ((parent: RouteDef<P, B, M, R, 2>) => any[]) :
  Z extends 1 ? ChildRoute<R>[] :
  Z extends 2 ? undefined :
  never;
  /**
   * If this route's handler sends headers, the matched child route will not be called.
   */
  handler: (state: ParentState<P, M[number]>) => Promise<R>;
}

export function defineRoute<
  P extends RouteParent<S>,
  B extends P["bodyFormat"] extends undefined ? BodyFormat : undefined,
  M extends P["method"][number][],
  S,
  R
>(parent: P, route: RouteDef<P, B, M, R, 0>): RouteDef<P, B, M, R, 1> {
  const route2: RouteDef<P, B, M, R, 2> = route as any;
  return { ...route, childRoutes: route.childRoutes?.(route2), }
}


/** This is the root route. It defines the maximum allowed parameters. */
const root = defineRoute({} as RouteParent<StateObject>, {
  useACL: {},
  method: AllowedMethods,
  path: /^/,
  handler: async (state) => {
    return state;
  },
  // this can be empty and filled in later.
  childRoutes: (parent) => [
    /** This is an example route tree */
    defineRoute(parent, {
      useACL: {},
      method: ["GET", "HEAD", "POST", "PUT"],
      path: /^\/test/,
      handler: async (state) => { return state },
      childRoutes: (parent) => [
        defineRoute(parent, {
          useACL: {},
          method: ["GET", "HEAD"],
          path: /^\/test/, // Matches /test/test
          handler: async (state) => {
            return state.sendString(200, {}, "Hello, World!", "utf8");
          },
        }),
        defineRoute(parent, {
          useACL: {},
          method: ["POST", "PUT"],
          path: /^\/test/, // Matches /test/test
          handler: async (state) => { return state },
        }),
      ]
    })
  ]
});
export default root;



