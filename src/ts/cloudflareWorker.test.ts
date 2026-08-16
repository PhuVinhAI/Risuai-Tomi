// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../cloudflare-worker.js";

describe("Cloudflare Worker routing", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("routes POST /proxy2 through the proxy function", async () => {
        const upstreamFetch = vi.fn(async (_url, init) => {
            const body = await new Response(init.body).text();
            expect(body).toBe('{"message":"hello"}');
            expect(init.method).toBe("POST");
            expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-key");

            return new Response("proxied", { status: 201 });
        });
        const assetFetch = vi.fn();
        vi.stubGlobal("fetch", upstreamFetch);

        const request = new Request("https://risu.example/proxy2", {
            method: "POST",
            headers: {
                "risu-url": encodeURIComponent("https://api.example/v1/chat/completions"),
                "risu-header": encodeURIComponent(JSON.stringify({
                    Authorization: "Bearer test-key",
                    "Content-Type": "application/json",
                })),
            },
            body: '{"message":"hello"}',
        });

        const response = await worker.fetch(request, { ASSETS: { fetch: assetFetch } });

        expect(response.status).toBe(201);
        expect(await response.text()).toBe("proxied");
        expect(upstreamFetch).toHaveBeenCalledOnce();
        expect(upstreamFetch.mock.calls[0][0]).toBe("https://api.example/v1/chat/completions");
        expect(assetFetch).not.toHaveBeenCalled();
    });

    it("serves non-function routes from static assets", async () => {
        const assetResponse = new Response("app", { status: 200 });
        const assetFetch = vi.fn(async () => assetResponse);
        const request = new Request("https://risu.example/chat/123");

        const response = await worker.fetch(request, { ASSETS: { fetch: assetFetch } });

        expect(response).toBe(assetResponse);
        expect(assetFetch).toHaveBeenCalledWith(request);
    });
});
