import { Route, Router } from "./router";
import { Streamer } from "./server";

export class AuthState {
  authLevelNeeded!: string;
  username!: string;
  // both checkStreamer and checkRoute are called before anything here is used.
  constructor(private router: Router) {

  }
  async checkStreamer(streamer: Streamer) {

  }
  async checkRoute(route: Route) {
    console.log("Checking ACL for", route);
  }

  // auth has to be handled separately
  // authenticatedUser: any;
  // authenticatedUsername?: string | undefined;
  // authorizationType: string;
  // allowAnon: boolean;
  // anonAccessConfigured: boolean;
  // allowAnonReads: boolean;
  // allowAnonWrites: boolean;
  // showAnonConfig: boolean;
  // firstGuestUser: boolean;
}
