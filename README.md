# TiddlyWiki5 MultiWikiServer

## How the server classes work together

This implements a server that abstracts the various HTTP protocols into a single request state object which it then hands out to the routes.

- **Streamer** abstracts away the difference between HTTP/1.1 and HTTP/2 to allow both to be handled transparently. 
  - Normalizes the request and response into a single class. 
  - Currently it doesn't support push streams, but we could change that.
- **Listeners** call the appropriate streamer for the request they've received
  - ListenerHTTP: Sets up and handles HTTP requests using the http module.
  - ListenerHTTPS: Sets up and handles HTTPS requests using the http2 module (with http1.1 support).
- **Router**
  - **Router**: The main server instance. Handles route matching and sets up a state object for each request.
  - **StateObject**: Includes everything that routes are allowed access to.
  - **AuthState**: Contains all authentication logic and is called at various points in the request process. It may throw at any time to abort the request.

## Thoughts on routing

Routing generally works well, but the current routes are all strictly path based. They mix various concerns into one module based on path similarities. 

I think it would be a lot more streamlined to separate the concerns into different sections. Each of those would operate as their own submodule, although of course they affect each other. 

- **Auth** determines who the user is.
- **Users** contains all the code for changing what the user is allowed to do.
- **Recipes** shows the user their available recipes and lets them create or modify. 
- **Wikis** contains all the code that runs when accessing the wiki itself. 

When recipes and wikis both need to list tiddlers or bags or otherwise access similar information, they should not be using the same routes. Each should have their own routes. That doesn't mean they can't share database code, but request processing is usually domain specific, and combining domains often creates unnecessary complications. If we need to share code, it works best to put it in a helper function. 

## TypeScript

Everything needs to be strongly typed. When done right, bugs are rare, and code usually just works. There are many times where I've spent days writing a massive amount of code to implement a new feature or rearchitect something, and it runs the first time. 

At first the temptation is always to try to make Typescript allow all of Javascript's dynamic typing, but not everything that can be done in Javascript always should be done. I've found that it is much simpler to just work with Typescript's typing the way it prefers. That tends to be a lot of objects and interfaces, clear separation of concerns, and strictly rigid type signatures.

- Null is the negative of an object. False is the negative of true. If you want to indicate the absence of an object, use null. You can also make some properties optional, or use a union type to indicate two possible scenarios.  
- Rather than trying to put optional arguments in the middle of a function, for instance, it's better to have an options object at the end, or second to last if you need a callback, and then just always leave it there. Don't make options optional and then put the callback there instead if you don't specify options. It doesn't work well. 
- Speaking of callbacks: **Promises!**
- It often works better to have a separate function for each call signature. Javascript doesn't police overloads at all, and Typescript isn't very flexible with all the things people try to shove into their functions. If you need to loop over an array or an object, it's usually better to have loopArray and loopObject. If you actually need it to support both, you probably want to use `(Array.isArray(e) ? e : Object.entries(e))`.

But while it may be less flexible, it is a lot more readable and reliable. When you look at a function, you don't have to guess what is supposed to be going in there, or depend on Javascript coercing values around. 

