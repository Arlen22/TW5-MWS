import { Route, Router } from "./router";
import { Streamer } from "./server";

export class AuthState {
  authLevelNeeded!: string;
  username!: string;
  constructor(private router: Router) {

  }
  async checkStreamer(streamer: Streamer) {

  }
  async checkRoute(route: Route) {
    console.log("Checking ACL for", route);
  }
}
