import { Router } from "express";
import { z } from "zod";
import type { WithId } from "mongodb";
import { flags } from "../../flags.js";
import { findUserById, getUsersCollection, type User } from "../../models/user.model.js";

export const usersRouter = Router();

function assertNever(x: never): never {
  throw new Error(`Unhandled plan: ${String(x)}`);
}

/**
 * Returns the maximum allowed favorite number for a user given their plan and
 * whether the pro-number-range flag is enabled for them.
 */
export function getFavoriteNumberMax(plan: User["plan"], proNumberRange: boolean): number {
  switch (plan) {
    case "free":  return 10;
    case "basic": return 50;
    case "pro":   return proNumberRange ? 100 : 80;
    default:      return assertNever(plan);
  }
}

const BASIC_COLORS = ["red", "blue", "green", "yellow", "purple"];
const EXTENDED_COLORS = [
  ...BASIC_COLORS,
  "coral", "teal", "lavender", "orange", "pink", "gold", "navy",
];

// ── Schemas ───────────────────────────────────────────────────────

const PostUserSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, "Username may only contain letters, numbers, underscores, and hyphens"),
});

const PatchPreferencesSchema = z.object({
  plan: z.enum(["free", "basic", "pro"]).optional(),
  // Zod enforces the absolute bounds (0–100); flag-aware range is enforced below.
  favoriteNumber: z.number().int().min(0).max(100).optional(),
  favoriteColor: z.string().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────

function toResponse(user: WithId<User>, opts?: { showFavoriteNumber: boolean }) {
  const result: Record<string, unknown> = {
    id: user._id.toString(),
    username: user.username,
    plan: user.plan,
    favoriteColor: user.favoriteColor,
  };
  if (!opts || opts.showFavoriteNumber) {
    result.favoriteNumber = user.favoriteNumber;
  }
  return result;
}

// ── POST /users ───────────────────────────────────────────────────

usersRouter.post("/", async (req, res) => {
  const parsed = PostUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { username } = parsed.data;

  const existing = await getUsersCollection().findOne({ username });
  if (existing) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const now = new Date();
  const result = await getUsersCollection().insertOne({
    username,
    plan: "free",
    favoriteNumber: null,
    favoriteColor: null,
    createdAt: now,
    updatedAt: now,
  });

  res.status(201).json({ id: result.insertedId.toString(), username, plan: "free" });
});

// ── GET /users/:id ────────────────────────────────────────────────

usersRouter.get("/:id", async (req, res) => {
  const user = await findUserById(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const showFavoriteNumber = await flags.safeEvaluate("show-favorite-number", true);
  res.json(toResponse(user, { showFavoriteNumber }));
});

// ── PATCH /users/:id/preferences ─────────────────────────────────

usersRouter.patch("/:id/preferences", async (req, res) => {
  const user = await findUserById(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const parsed = PatchPreferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { plan, favoriteNumber, favoriteColor } = parsed.data;
  const effectivePlan = plan ?? user.plan;
  const userId = user._id.toString();

  const [showFavoriteNumber, extendedPalette, proNumberRange] = await Promise.all([
    flags.safeEvaluate("show-favorite-number", true),
    flags.safeEvaluate("extended-color-palette", false, { userId, attributes: { plan: effectivePlan } }),
    flags.safeEvaluate("pro-number-range", false, { userId, attributes: { plan: effectivePlan } }),
  ]);

  if (favoriteNumber !== undefined) {
    if (!showFavoriteNumber) {
      res.status(400).json({ error: "Favorite number is not currently available" });
      return;
    }
    const max = getFavoriteNumberMax(effectivePlan, proNumberRange);
    if (favoriteNumber > max) {
      res.status(400).json({ error: `Favorite number must be between 0 and ${max} for your plan` });
      return;
    }
  }

  if (favoriteColor !== undefined) {
    const allowed = extendedPalette ? EXTENDED_COLORS : BASIC_COLORS;
    if (!allowed.includes(favoriteColor)) {
      res.status(400).json({ error: `Invalid color. Allowed: ${allowed.join(", ")}` });
      return;
    }
  }

  const updates: Partial<User> = { updatedAt: new Date() };
  if (plan !== undefined) updates.plan = plan;
  if (favoriteNumber !== undefined) updates.favoriteNumber = favoriteNumber;
  if (favoriteColor !== undefined) updates.favoriteColor = favoriteColor;

  await getUsersCollection().updateOne({ _id: user._id }, { $set: updates });

  const updated = (await findUserById(req.params.id))!;
  res.json(toResponse(updated, { showFavoriteNumber }));
});

// ── GET /users/:id/options ────────────────────────────────────────

usersRouter.get("/:id/options", async (req, res) => {
  const user = await findUserById(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const userId = user._id.toString();

  const [showFavoriteNumber, extendedPalette, proNumberRange] = await Promise.all([
    flags.safeEvaluate("show-favorite-number", true),
    flags.safeEvaluate("extended-color-palette", false, { userId, attributes: { plan: user.plan } }),
    flags.safeEvaluate("pro-number-range", false, { userId }),
  ]);

  const max = getFavoriteNumberMax(user.plan, proNumberRange);

  res.json({
    favoriteNumberEnabled: showFavoriteNumber,
    favoriteNumberRange: showFavoriteNumber ? { min: 0, max } : null,
    availableColors: extendedPalette ? EXTENDED_COLORS : BASIC_COLORS,
  });
});
