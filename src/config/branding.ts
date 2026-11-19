/**
 * Centralized branding configuration for Flow Studio.
 * Change the product name / identity in one place.
 */
export const branding = {
  productName: "Flow Studio",
  tagline: "Visual workflow automation",
  description:
    "Design, build and run automation workflows visually. Connect apps, transform data, and monitor every execution.",
  company: "Flow Studio",
  supportEmail: "support@flowstudio.example",
};

export type PlanId = "free" | "starter" | "pro";

export interface PlanLimits {
  maxWorkflows: number;
  maxExecutionsPerMonth: number;
  maxConnections: number;
  executionHistoryDays: number;
  maxConcurrentRuns: number;
  minScheduleIntervalMinutes: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  priceInr: number;
  description: string;
  limits: PlanLimits;
  features: string[];
}

/**
 * Plans are configurable here (single source of truth for gating + display).
 * The Razorpay billing provider reads plan prices from this table.
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceInr: 0,
    description: "For getting started with personal automations",
    limits: {
      maxWorkflows: 5,
      maxExecutionsPerMonth: 200,
      maxConnections: 3,
      executionHistoryDays: 7,
      maxConcurrentRuns: 1,
      minScheduleIntervalMinutes: 60,
    },
    features: [
      "5 workflows",
      "200 executions / month",
      "Manual, webhook & schedule triggers",
      "HTTP, logic & data transformation nodes",
      "7-day execution history",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceInr: 499,
    description: "For regular automation users",
    limits: {
      maxWorkflows: 25,
      maxExecutionsPerMonth: 5000,
      maxConnections: 15,
      executionHistoryDays: 30,
      maxConcurrentRuns: 3,
      minScheduleIntervalMinutes: 15,
    },
    features: [
      "25 workflows",
      "5,000 executions / month",
      "15 integration connections",
      "15-minute scheduling precision",
      "30-day execution history",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceInr: 1499,
    description: "For heavy automation workloads",
    limits: {
      maxWorkflows: 200,
      maxExecutionsPerMonth: 100000,
      maxConnections: 100,
      executionHistoryDays: 90,
      maxConcurrentRuns: 10,
      minScheduleIntervalMinutes: 5,
    },
    features: [
      "200 workflows",
      "100,000 executions / month",
      "100 integration connections",
      "5-minute scheduling precision",
      "90-day execution history",
    ],
  },
};

export const DEFAULT_PLAN: PlanId = "free";
