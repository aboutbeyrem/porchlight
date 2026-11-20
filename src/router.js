// Looks at the router's admin page from the outside: is it reachable, does it offer an encrypted (HTTPS) version,
// and what does it call itself. It never tries to log in.
import { httpRequest, pageTitle } from "./http.js";
import { checkPort } from "./ports.js";

export { pageTitle };

export async function checkRouterAdmin(gateway) {
  const res = await httpRequest(`http://${gateway}/`);
  const https = await checkPort(gateway, 443);
  if (!res) return { reachable: false, https };
  const redirectsToHttps = /^https:/i.test(res.headers.location || "");
  return {
    reachable: true,
    status: res.status,
    title: pageTitle(res.body),
    server: res.headers.server || null,
    https,
    redirectsToHttps,
  };
}
