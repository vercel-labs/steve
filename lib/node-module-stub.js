// Browser stub for node:module. eve/react pulls a reference to node:module
// into the client chunk via Turbopack module-merging, but the client code
// never actually calls into it at runtime. This empty stub satisfies the
// bundler. See _internal DX notes for the upstream eve/Turbopack issue.
export function createRequire() {
  return () => {
    throw new Error("node:module is not available in the browser");
  };
}
export default {};
