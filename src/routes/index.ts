import { AllowedMethods, RouteParent, Router } from "../router";
import { StateObject } from "../StateObject";
import AuthRoutes from "./auth";

export default function RootRoute(router: Router) {

  /** This is the root route. It defines the maximum allowed parameters. */
  const root = router.defineRoute({
    method: AllowedMethods,
    // this one isn't actually called. it's just for typing.
    handler: async (state) => { return state; },
  } as RouteParent<StateObject>, {
    useACL: {},
    method: AllowedMethods,
    path: /^/,
    handler: async (state) => { return state; },
  });

  AuthRoutes(router, root);

  return root;

}

export type rootRoute = ReturnType<typeof RootRoute>;