import { rootRoute } from ".";
import { Router } from "../router";

export default function AuthRoutes(router: Router, parent: rootRoute) {
  const authRoute = router.defineRoute(parent, {
    useACL: {},
    method: ["GET", "HEAD", "POST", "PUT"],
    bodyFormat: undefined,
    path: /^\/auth/,
    handler: async (state) => {

      return state.sendString(200, {}, "auth route", "utf8");
    },
  });

  return authRoute;
}

export type authRoute = ReturnType<typeof AuthRoutes>;