import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTRPCContext } from "../../../src/server/trpc/context.js";
import { appRouter } from "../../../src/server/trpc/router.js";
import type { AppEnv } from "../../../src/server/env.js";

interface PagesRequestContext {
  request: Request;
  env: AppEnv;
}

export const onRequest = ({ request, env }: PagesRequestContext): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: ({ req, resHeaders }) => createTRPCContext(req, env, resHeaders),
  });
