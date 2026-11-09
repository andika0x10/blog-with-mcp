import { createBlogWorker } from "../worker/gateway";
export { LoginLimiter } from "../worker/login-limiter";
export default createBlogWorker(async () => new Response("Website renderer is tested by Playwright", { status: 404 }));
