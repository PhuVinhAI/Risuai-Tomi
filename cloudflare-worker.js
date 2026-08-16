import { onRequest as handleDrive } from "./functions/drive.js";
import { onRequest as handleProxy } from "./functions/proxy.js";
import { onRequest as handleProxy2 } from "./functions/proxy2.js";

const dynamicRoutes = new Map([
    ["/drive", handleDrive],
    ["/proxy", handleProxy],
    ["/proxy2", handleProxy2],
]);

export default {
    async fetch(request, env) {
        const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
        const handler = dynamicRoutes.get(pathname);

        if (handler) {
            return handler({ request, env });
        }

        return env.ASSETS.fetch(request);
    },
};
