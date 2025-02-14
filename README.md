# TiddlyWiki5 MultiWikiServer

This implements a server that abstracts the various HTTP protocols into a single request state object which it then hands out to the routes.

## How the Classes Work Together

- **Streamers** abstract away the difference between HTTP/1.1 and HTTP/2 to allow both to be handled transparently. 
  - Streamer: Normalizes the request and response into a single class. Currently it doesn't support push streams, but we could change that.
- **Listeners** call the appropriate streamer for the request they've received
  - ListenerHTTP: Sets up and handles HTTP requests using the http module.
  - ListenerHTTPS: Sets up and handles HTTPS requests using the http2 module (with http1.1 support).
- **Router**
  - Router: The main server instance. Handles route matching and sets up a state object for each request.
  - StateObject: Includes everything that routes are allowed access to.
  - AuthState: Contains all authentication logic and is called at various points in the request process. It may throw at any time to abort the request.
