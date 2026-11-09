import vinext from "vinext/server/fetch-handler";
import { createBlogWorker } from "./gateway";
export { LoginLimiter } from "./login-limiter";
export default createBlogWorker((request, env, ctx) => vinext.fetch(request, env, ctx));
