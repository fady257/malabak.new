import { initTRPC, TRPCError } from "@trpc/server";
import type { RequestContext } from "../env.js";
import { assertCsrf } from "../security/request-security.js";

const t = initTRPC.context<RequestContext>().create({
  isDev: false,
  errorFormatter({ shape, error }) {
    if (error.code !== "INTERNAL_SERVER_ERROR") return shape;
    return {
      ...shape,
      message: "حدث خطأ غير متوقع. لم تُحفظ التغييرات؛ حاول مرة أخرى.",
      data: { ...shape.data, stack: undefined },
    };
  },
});

const csrfProcedure = t.procedure.use(async ({ ctx, type, next }) => {
  if (type === "mutation") await assertCsrf(ctx);
  return next();
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = csrfProcedure;

export const protectedProcedure = csrfProcedure.use(({ ctx, next }) => {
  const member = ctx.member;
  if (!member) throw new TRPCError({ code: "UNAUTHORIZED", message: "سجّل الدخول للمتابعة." });
  return next({ ctx: { ...ctx, member } });
});

export const ownerProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.member.role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "هذا الإجراء متاح لمالك المكان فقط." });
  }
  return next();
});

export const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.member.role !== "owner" && ctx.member.role !== "staff") {
    throw new TRPCError({ code: "FORBIDDEN", message: "هذا الإجراء غير متاح لهذا الحساب." });
  }
  return next();
});
