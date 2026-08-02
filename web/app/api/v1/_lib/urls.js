import { applicationUrl } from "../../../../lib/auth.js";

export function publicApiOrigin(request, environment = process.env) {
  return applicationUrl("/", request.url, environment).origin;
}

export function absolutePublicUrl(pathname, origin) {
  if (!origin) return pathname;
  return new URL(pathname, `${origin.replace(/\/+$/, "")}/`).href;
}
