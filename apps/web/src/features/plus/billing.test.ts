import { describe, expect, it } from "vitest";
import { billingGraceEnds, formatPrice, yearlySaving } from "./billing";

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
