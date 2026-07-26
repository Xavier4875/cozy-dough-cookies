// Wraps a single async route/middleware function so a rejected promise (e.g.
// a DynamoDB/Cognito/SES call that throws) is forwarded to next(err) instead
// of becoming an unhandled rejection. Node's default behavior on an
// unhandled rejection is to crash the entire process — which, without this,
// turns one flaky DynamoDB call into a full server outage for every other
// in-flight request, not just the one that failed.
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Applied once, here, rather than wrapping each of this app's 20+ route
// registrations (and every requireAuth/requireStaff-style middleware they
// chain) by hand — every handler passed to app.get/post/put/patch/delete
// gets the same protection automatically, present and future.
export function installAsyncErrorHandling(app) {
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  for (const method of methods) {
    const original = app[method].bind(app);
    app[method] = (path, ...handlers) =>
      original(path, ...handlers.map((h) => (typeof h === 'function' ? asyncHandler(h) : h)));
  }
}
