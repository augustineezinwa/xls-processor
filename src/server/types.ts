/**
 * Shared Hono context variable types.
 *
 * AppVariables is used as the generic `Variables` parameter on the Hono app,
 * middleware, and controller so that `c.set()` / `c.get()` are fully typed
 * end-to-end without casting.
 */
export type AppVariables = {
  uploadedFile: File;
};
