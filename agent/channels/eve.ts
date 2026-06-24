import { eveChannel } from "eve/channels/eve";
import { none } from "eve/channels/auth";

// HTTP channel only (no Slack/Connect). No vercelOidc() — this deployment has
// zero Vercel coupling.
//
// PoC NOTE: routes are intentionally PUBLIC (none()) so the Next.js UI can call
// the agent without credentials. This is a demo/PoC choice — the agent is openly
// accessible at the deployed origin. To lock it down, swap back to
// [localDev(), httpBasic({...})] (and have the UI inject the Basic credential
// server-side) or [localDev(), vercelOidc()].
export default eveChannel({
  auth: [none()],
});
