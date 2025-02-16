
import { AllowedMethods, RouteMatch, Router, Streamer } from "./server";
import rootRoute from "./routes";
import { is } from "./helpers";

// This is a mapping of the methods to the auth levels needed to access them.
// since the root route defines the methods allowed, we just import the type from there.

const authLevelNeededForMethod: Record<AllowedMethods, "readers" | "writers" | undefined> = {
  "GET": "readers",
  "OPTIONS": "readers",
  "HEAD": "readers",
  "PUT": "writers",
  "POST": "writers",
  "DELETE": "writers"
} as const;

export interface AuthStateRouteACL {
  csrfDisable?: boolean;
  entityName?: "recipe" | "bag",
}

export class AuthState {
  private streamer!: Streamer;
  private authLevelNeeded: "readers" | "writers" = "writers";
  private cookies: Record<string, string | undefined> = {};
  private user: any;

  constructor(private router: Router) {

  }

  async checkStreamer(streamer: Streamer) {
    this.streamer = streamer;
    if (is<AllowedMethods>(this.streamer.method, !rootRoute.method.includes(streamer.method as any)))
      throw streamer.sendString(405, {}, "Method not recognized", "utf8");
    this.parseCookieString(this.streamer.headers.cookie ?? "");
    this.authLevelNeeded = authLevelNeededForMethod[this.streamer.method] ?? "writers";
    this.user = this.getUserBySessionId(this.cookies.session ?? "");
  }
  async checkMatchedRoutes(routes: RouteMatch[]) {
    console.log("Checking route");

    routes.forEach(match => {
      if (!this.router.csrfDisable && !match.route.useACL.csrfDisable && this.authLevelNeeded === "writers" && this.streamer.headers["x-requested-with"] !== "TiddlyWiki")
        throw this.streamer.sendString(403, {}, "'X-Requested-With' header required to login to '" + this.router.servername + "'", "utf8");
    })
  }

  parseCookieString(cookieString: string) {
    if (typeof cookieString !== 'string') throw new Error('cookieString must be a string');
    cookieString.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        this.cookies[key] = decodeURIComponent(value);
      }
    });
  }

  getUserBySessionId(session_id: string) {
    return {
      user_id: 1,
      username: "admin",
    }
  }
  toDebug() {
    return this.user.username;
  }
}

