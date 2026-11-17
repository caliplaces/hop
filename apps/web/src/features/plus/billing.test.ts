import type { PlanStatus } from "@hop/shared";
import { describe, expect, it } from "vitest";
import { newerPlan } from "../../lib/queries";
import { billingGraceEnds, formatPrice, isStripePage, yearlySaving } from "./billing";

const monthly = { id: "m", amount: 499, currency: "eur", interval: "month" as const };
const yearly = { id: "y", amount: 4900, currency: "eur", interval: "year" as const };
const DAY = 24 * 60 * 60 * 1000;

describe("prices", () => {
  it("read as money, from Stripe's smallest unit", () => {
    expect(formatPrice(monthly).replace(/\s/g, "")).toMatch(/4[.,]99/);
    expect(formatPrice({ amount: 500, currency: "jpy" })).toMatch(/500/);
  });

  it("say how much a year saves, only when it does", () => {
    expect(yearlySaving(monthly, yearly)).toBe(18);
    expect(yearlySaving(monthly, { ...yearly, amount: 6000 })).toBe(0);
    expect(yearlySaving(undefined, yearly)).toBe(0);
    expect(yearlySaving(monthly, { ...yearly, currency: "czk" })).toBe(0);
  });
});

describe("a billing grace period", () => {
  const now = Date.now();
  const subscription = {
    provider: "stripe" as const,
    productId: "hop_plus",
    expiresAt: now - DAY,
    graceExpiresAt: now + 5 * DAY,
    autoRenew: true,
    environment: "Production" as const,
  };

  it("is on once the period has ended and before the grace does", () => {
    expect(billingGraceEnds(subscription, now)).toBe(now + 5 * DAY);
    expect(billingGraceEnds({ ...subscription, expiresAt: now + DAY }, now)).toBeNull();
    expect(billingGraceEnds({ ...subscription, graceExpiresAt: now - 1 }, now)).toBeNull();
    expect(billingGraceEnds({ ...subscription, graceExpiresAt: null }, now)).toBeNull();
    expect(billingGraceEnds(null, now)).toBeNull();
  });
});

describe("redirects", () => {
  it("only go to Stripe's own pages", () => {
    expect(isStripePage("https://checkout.stripe.com/c/pay/cs_test_1")).toBe(true);
    expect(isStripePage("https://billing.stripe.com/p/session/test_1")).toBe(true);
    for (const url of [
      "http://checkout.stripe.com/c/pay/cs_test_1",
      "https://checkout.stripe.com.evil.example/",
      "https://evil.example/?https://checkout.stripe.com",
      "javascript:alert(1)",
      "/app",
      "",
    ]) {
      expect(isStripePage(url)).toBe(false);
    }
  });
});

describe("the plan on show", () => {
  const at = (revision: number, plan: "free" | "plus") => ({ revision, plan }) as PlanStatus;

  it("isn't replaced by a reply that read it before a change", () => {
    expect(newerPlan(at(3, "plus"), at(2, "free")).plan).toBe("plus");
    expect(newerPlan(at(2, "free"), at(3, "plus")).plan).toBe("plus");
    expect(newerPlan(at(3, "plus"), at(3, "plus"))).toEqual(at(3, "plus"));
    expect(newerPlan(undefined, at(1, "free")).plan).toBe("free");
  });
});
