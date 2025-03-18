# TiddlyWiki5 MultiWikiServer

Please see https://github.com/TiddlyWiki/MultiWikiServer, where this vision is becoming reality.

## How the server classes work together

This implements a server that abstracts the various HTTP protocols into a single request state object which it then hands out to the routes. The entire request chain uses async/await. 

- **Streamer** abstracts away the difference between HTTP/1.1 and HTTP/2 to allow both to be handled transparently. 
  - Normalizes the request and response into a single class. 
  - Currently it doesn't support push streams, but we could change that.
- **Listeners** handle the server listener and send requests they recieve to the router.
  - ListenerHTTP: Sets up and handles HTTP requests using the http module.
  - ListenerHTTPS: Sets up and handles HTTPS requests using the http2 module (with http1.1 support).
- **Router**
  - **Router**: The main server instance. Handles route matching and sets up a state object for each request.
  - **StateObject**: Contains everything routes have access to, including a database connection for the route to use. 
  - **AuthState**: Contains all authentication logic and is called at various points in the request process. It may throw at any time to abort the request.

## Thoughts on routing

Routing generally works well, but the current routes are all strictly path based. They mix various concerns into one module based on path similarities. 

I think it would be a lot more streamlined to separate the concerns into different sections. Each of those would operate as their own submodule. 

- **Auth** determines who the user is.
  - Auth adapters that connect third-party auth services, with fields like profile pic, display name, email, etc.
  - Auth strategies like session cookies or access tokens.
  - Login and registration forms, email and phone interactions, etc.
- **Users** contains all the code for changing what the user is allowed to do.
  - List of users, with tabs for pending, roles, etc.
  - Handle user registrations and give starting permissions.
  - Manage sharing and collaboration permissions (owners, editors, viewers, etc).
- **Recipes** shows the user their available recipes and lets them create or modify.
  - Allow the user to manage their own recipes and bags.
  - Admins can define scoped bags which are added to recipes based on the user's role.
- **Wikis** contains all the code that runs when accessing the wiki itself.
  - Tiddler saving and loading based on the recipe instructions.
  - Uploads and other third-party integrations requiring server support.

## TypeScript

Everything needs to be strongly typed. When done right, bugs are rare, and code usually just works. There are many times where I've spent days writing a massive amount of code to implement a new feature or rearchitect something, and when I finally get done and try running it, it just works.

At first the temptation is always to try to make Typescript allow all of Javascript's dynamic typing, but not everything that can be done in Javascript always should be done. I've found that it is much simpler to just work with Typescript's typing the way it prefers. That tends to be a lot of objects and interfaces, clear separation of concerns, and strictly rigid type signatures.

- Use null as the negative of an object, instead of false. Returning false messes with types, and doesn't work with `?.` and `??`.
- Use Promises and async/await. It makes handling async operations so much simpler.
- Argument position shouldn't change. Don't have an options object OR callback as the third argument if the options object pushes the callback to the fourth argument. Overloads are supported in typescript but it's more about working with the types once you get into the function. 

While it may be less flexible, it is a lot more readable and reliable, in my opinion.


## Refer to the wiki for further thoughts
