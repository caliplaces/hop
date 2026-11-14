import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/** zValidator that answers with our error shape instead of a raw ZodError dump. */
export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "invalid_request",
          message: result.error.issues[0]?.message ?? "Invalid request.",
        },
        400,
      );
    }
  });
}
