import type { AppEnv, RequestContext } from "../env.js";
import { getAuthenticatedMember } from "../auth/session.js";

export async function createTRPCContext(
  request: Request,
  env: AppEnv,
  responseHeaders: Headers,
): Promise<RequestContext> {
  const { member, rawCsrfCookie } = await getAuthenticatedMember(env.DB, request, env);
  return { env, request, responseHeaders, member, rawCsrfCookie };
}
