/** The main website (WordPress). The app is one part of it, so links back to it use this. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://thetruescholars.com").replace(/\/$/, "");
export const site = (path = "/") => `${SITE_URL}${path.startsWith("/") || path.startsWith("#") ? "" : "/"}${path === "/" ? "" : path}`;
