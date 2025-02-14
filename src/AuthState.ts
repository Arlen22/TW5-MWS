
import { Route, Router, Streamer } from "./server";

const authLevelNeededForMethod: Record<string, "readers" | "writers" | undefined> = {
  "GET": "readers",
  "OPTIONS": "readers",
  "HEAD": "readers",
  "PUT": "writers",
  "POST": "writers",
  "DELETE": "writers"
} as const;

export class AuthState {
  private streamer!: Streamer;
  private authLevelNeeded: "readers" | "writers" = "writers";
  private cookies: Record<string, string | undefined> = {};
  private user: any;

  constructor(private router: Router) {

  }

  async checkStreamer(streamer: Streamer) {
    console.log("Check request headers");
    this.streamer = streamer;
    this.parseCookieString(this.streamer.headers.cookie ?? "");
    this.authLevelNeeded = authLevelNeededForMethod[this.streamer.method] ?? "writers";
    this.user = this.getUserBySessionId(this.cookies.session ?? "");
  }
  async checkRoute(route: Route) {
    console.log("Checking route");
    if (!this.router.csrfDisable && !route.csrfDisable && this.authLevelNeeded === "writers" && this.streamer.headers["x-requested-with"] !== "TiddlyWiki")
      throw this.streamer.sendString(403, {}, "'X-Requested-With' header required to login to '" + this.router.servername + "'", "utf8");
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
  toDebug(){
    return this.user.username;
  }
}

