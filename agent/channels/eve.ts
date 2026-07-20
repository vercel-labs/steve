import { eveChannel } from "eve/channels/eve";
import { type AuthFn, httpBasic, localDev, placeholderAuth } from "eve/channels/auth";

const username = process.env.ROUTE_AUTH_BASIC_USER?.trim();
const password = process.env.ROUTE_AUTH_BASIC_PASSWORD;

// Local loopback requests remain frictionless. Every non-loopback request must
// authenticate, and a missing production credential fails closed with Eve's
// setup-focused 401 response.
const configuredAuth =
  username && password ? httpBasic({ username, password }) : placeholderAuth();
const productionAuth: AuthFn<Request> = (request) => {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (new URL(request.url).protocol !== "https:" && forwardedProtocol !== "https") {
    return null;
  }
  return configuredAuth(request);
};

export default eveChannel({
  auth:
    process.env.NODE_ENV === "production" ? [productionAuth] : [localDev(), productionAuth],
  uploadPolicy: "disabled",
});
