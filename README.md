# TiddlyWiki5 MultiWikiServer

This project implements a multi-protocol wiki server that demonstrates how various classes work together:

- **server.ts**: Sets up HTTP/1 and HTTP/2 servers using specialized Streamer classes (Streamer1 for HTTP/1 and Streamer2 for HTTP/2) to handle incoming requests. The Listener classes initialize the servers and delegate request handling.
- **router.ts**: Implements routing rules and conditions. The Router identifies the correct route for an incoming request and creates a StateObject that encapsulates the request details, allowing the route handler to process the request body accordingly.
- **AuthState.ts**: Provides a minimal authentication and authorization mechanism. It checks the request and route before processing, ensuring the proper permissions are enforced.
- **helpers.ts**: contains some extra functions that do some heavy lifting like parsing or caching. 

Together, these components provide a structured approach to handling incoming HTTP requests, routing them according to the URL pattern, verifying access permissions, and delivering responses.

## How the Classes Work Together

- **streamer classes** abstract away the difference between HTTP/1.1 and HTTP/2 to allow both to be handled transparently. 
  - Streamer: An abstract class defining the interface for streaming responses.
  - Streamer1: Implements Streamer for HTTP/1 requests.
  - Streamer2: Implements Streamer for HTTP/2 requests.
- **listener classes** call the appropriate streamer for the request they've received
  - ListenerHTTP: Sets up and handles HTTP requests.
  - ListenerHTTPS: Sets up and handles HTTPS requests.
- **router.ts**
  - Router: Manages route matching and sets up a state object for each request.
  - StateObject: Encapsulates the request, response, and parsed data that routes need to know.
- **AuthState class**
  - AuthState: Contains all authentication logic and is called at various points in the request process.
