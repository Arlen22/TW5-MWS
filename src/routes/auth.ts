import { ok } from "assert";
import { rootRoute } from ".";
import { Router } from "../router";
import * as opaque from "@serenity-kit/opaque";

export default function AuthRoutes(router: Router, parent: rootRoute) {

  const authRoute = router.defineRoute(parent, {
    useACL: {},
    method: ["GET", "HEAD", "POST", "PUT"],
    bodyFormat: undefined,
    path: /^\/auth/,
    handler: async (state) => {
      return state;
    },
  });
  const userIdentifiers = new Map();
  const registrationRecords = new Map();
  const userLoginStates = new Map();
  const userSessionKeys = new Map();

  router.defineRoute(authRoute, {
    useACL: {},
    method: ["GET", "HEAD"],
    bodyFormat: undefined,
    path: /^\/register/,
    handler: async (state) => {
      return state.sendFile(200, {}, {
        root: "public",
        reqpath: "register.html",
      });
    },
  });

  router.defineRoute(authRoute, {
    useACL: {},
    method: ["POST"],
    bodyFormat: "www-form-urlencoded",
    path: /^\/register\/1/,
    handler: async (state) => {
      ok(state.data instanceof URLSearchParams);
      const username = state.data.get("username");
      ok(typeof username === "string");
      const userIdentifier = userIdentifiers.get(username);
      ok(typeof userIdentifier === "string");

      const registrationRequest = state.data.get("registrationRequest");
      ok(typeof registrationRequest === "string");

      const { registrationResponse } = opaque.server.createRegistrationResponse({
        serverSetup,
        userIdentifier,
        registrationRequest,
      });
      return state.sendString(200, {}, registrationResponse, "utf8");
    },
  });

  router.defineRoute(authRoute, {
    useACL: {},
    method: ["POST"],
    bodyFormat: "www-form-urlencoded",
    path: /^\/register\/2/,
    handler: async (state) => {
      // still have to make this actually take the bodyFormat into account
      ok(state.data instanceof URLSearchParams);
      const username = state.data.get("username");
      ok(typeof username === "string");
      const userIdentifier = userIdentifiers.get(username); // userId/email/username
      ok(typeof userIdentifier === "string");

      const registrationRequest = state.data.get("registrationRequest");
      ok(typeof registrationRequest === "string");

      registrationRecords.set(userIdentifier, state.data);
      return state.sendEmpty(200, {});
    },
  });
  router.defineRoute(authRoute, {
    useACL: {},
    method: ["GET", "HEAD"],
    bodyFormat: undefined,
    path: /^\/login/,
    handler: async (state) => {
      return state.sendFile(200, {}, {
        root: "public",
        reqpath: "login.html",
      });
    },
  });

  router.defineRoute(authRoute, {
    useACL: {},
    method: ["POST"],
    bodyFormat: "string",
    path: /^\/login\/1/,
    handler: async (state) => {
      ok(state.data instanceof URLSearchParams);
      const username = state.data.get("username");
      ok(typeof username === "string");
      const userIdentifier = userIdentifiers.get(username); // userId/email/username
      ok(typeof userIdentifier === "string");

      const startLoginRequest = state.data.get("startLoginRequest");
      ok(typeof startLoginRequest === "string");

      const registrationRecord = await registrationRecords.get(userIdentifier);

      const { serverLoginState, loginResponse } = opaque.server.startLogin({
        serverSetup,
        userIdentifier,
        registrationRecord,
        startLoginRequest,
      });

      userLoginStates.set(userIdentifier, serverLoginState);

      return state.sendString(200, {}, loginResponse, "utf8");
    },
  });

  router.defineRoute(authRoute, {
    useACL: {},
    method: ["POST"],
    bodyFormat: "string",
    path: /^\/login\/2/,
    handler: async (state) => {
      ok(state.data instanceof URLSearchParams);
      const username = state.data.get("username");
      ok(typeof username === "string");
      const userIdentifier = userIdentifiers.get(username); // userId/email/username
      ok(typeof userIdentifier === "string");
      const finishLoginRequest = state.data.get("finishLoginRequest");
      ok(typeof finishLoginRequest === "string");

      const serverLoginState = userLoginStates.get(userIdentifier);
      ok(typeof serverLoginState === "string");

      // per the spec, the sessionKey may only be returned 
      // if the client's session key has successfully signed something.
      const { sessionKey } = opaque.server.finishLogin({
        finishLoginRequest,
        serverLoginState,
      });

      userSessionKeys.set(userIdentifier, sessionKey);

      return state.sendEmpty(200, {});
    },
  });

  return authRoute;
}
declare const serverSetup: string;
async function* serverOPAQUE1(registrationRequest: string) {

  // server
  const userIdentifier = "20e14cd8-ab09-4f4b-87a8-06d2e2e9ff68"; // userId/email/username

  const { registrationResponse } = opaque.server.createRegistrationResponse({
    serverSetup,
    userIdentifier,
    registrationRequest,
  });

  const registrationRecord: string = yield registrationResponse;

  return registrationRecord;

}

async function* clientOPAQUE1() {
  // client
  const password = "sup-krah.42-UOI"; // user password

  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password });

  const registrationResponse: string = yield registrationRequest;

  // client
  const { registrationRecord } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
  });

  return registrationRecord;

}


async function* serverOPAQUE2(registrationRecord: string) {
  await opaque.ready;
  const serverSetup = opaque.server.createSetup();
  // client
  const password = "sup-krah.42-UOI"; // user password

  const { clientLoginState, startLoginRequest } = opaque.client.startLogin({
    password,
  });

  // server
  const userIdentifier = "20e14cd8-ab09-4f4b-87a8-06d2e2e9ff68"; // userId/email/username

  const { serverLoginState, loginResponse } = opaque.server.startLogin({
    serverSetup,
    userIdentifier,
    registrationRecord,
    startLoginRequest,
  });

  // client
  const loginResult = opaque.client.finishLogin({
    clientLoginState,
    loginResponse,
    password,
  });
  if (!loginResult) {
    throw new Error("Login failed");
  }
  const { finishLoginRequest, sessionKey } = loginResult;

  // server

  const { sessionKey: ssessionkey } = opaque.server.finishLogin({
    finishLoginRequest,
    serverLoginState,
  });

}

// export type authRoute = ReturnType<typeof AuthRoutes>;