import { eveChannel } from "eve/channels/eve";
import { httpBasic, localDev } from "eve/channels/auth";

// HTTP channel only (no Slack/Connect). No vercelOidc() — this deployment has
// zero Vercel coupling, so route auth is plain HTTP Basic on the VPS.
//
// httpBasic() takes explicit credentials (it does NOT auto-read env), so we
// pull them from process.env here. Set ROUTE_AUTH_BASIC_USER / _PASSWORD in
// the deployment environment.
export default eveChannel({
  auth: [
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Production/VPS auth: Basic credentials from the environment.
    httpBasic({
      username: process.env.ROUTE_AUTH_BASIC_USER ?? "admin",
      password: process.env.ROUTE_AUTH_BASIC_PASSWORD ?? "",
    }),
  ],
});
