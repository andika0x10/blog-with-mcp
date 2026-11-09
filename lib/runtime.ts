import { env } from "cloudflare:workers";
import { ContentService } from "./content";
export const contentService = () => new ContentService(env.DB);
export const origin = () => env.SITE_URL.replace(/\/$/, "");
