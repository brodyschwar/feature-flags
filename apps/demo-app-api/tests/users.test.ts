import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { flags } from "../src/flags.js";
import { getFavoriteNumberMax } from "../src/routes/users/users.router.js";
import { getUsersCollection } from "../src/models/user.model.js";

// ── getFavoriteNumberMax ──────────────────────────────────────────

describe("getFavoriteNumberMax", () => {
  it("free plan always returns 10 regardless of proNumberRange", () => {
    expect(getFavoriteNumberMax("free", false)).toBe(10);
    expect(getFavoriteNumberMax("free", true)).toBe(10);
  });

  it("basic plan always returns 50 regardless of proNumberRange", () => {
    expect(getFavoriteNumberMax("basic", false)).toBe(50);
    expect(getFavoriteNumberMax("basic", true)).toBe(50);
  });

  it("pro plan returns 100 when proNumberRange is true", () => {
    expect(getFavoriteNumberMax("pro", true)).toBe(100);
  });

  it("pro plan returns 80 when proNumberRange is false", () => {
    expect(getFavoriteNumberMax("pro", false)).toBe(80);
  });
});

// Mock the flags module — flag logic is tested in packages/ts-sdk.
// Tests here only verify that the API correctly gates behaviour on the result.
vi.mock("../src/flags.js", () => ({
  flags: { safeEvaluate: vi.fn() },
}));

// Default flag state: all features on, basic palette, restricted number range.
function setFlags({
  showFavoriteNumber = true,
  extendedPalette = false,
  proNumberRange = false,
}: {
  showFavoriteNumber?: boolean;
  extendedPalette?: boolean;
  proNumberRange?: boolean;
} = {}) {
  vi.mocked(flags.safeEvaluate).mockImplementation(async (key) => {
    if (key === "show-favorite-number") return showFavoriteNumber;
    if (key === "extended-color-palette") return extendedPalette;
    if (key === "pro-number-range") return proNumberRange;
    return false;
  });
}

beforeEach(() => {
  setFlags();
});

// ── POST /users ───────────────────────────────────────────────────

describe("POST /users", () => {
  it("creates a user and returns 201 with id, username, plan", async () => {
    const res = await request(app).post("/users").send({ username: "alice" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username: "alice", plan: "free" });
    expect(res.body.id).toBeDefined();
  });

  it("defaults plan to free", async () => {
    const res = await request(app).post("/users").send({ username: "bob" });
    expect(res.body.plan).toBe("free");
  });

  it("returns 409 when username is already taken", async () => {
    await request(app).post("/users").send({ username: "alice" });
    const res = await request(app).post("/users").send({ username: "alice" });
    expect(res.status).toBe(409);
  });

  it("returns 400 when username is missing", async () => {
    const res = await request(app).post("/users").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when username contains invalid characters", async () => {
    const res = await request(app).post("/users").send({ username: "alice smith" });
    expect(res.status).toBe(400);
  });
});

// ── GET /users/:id ────────────────────────────────────────────────

describe("GET /users/:id", () => {
  async function createUser(username = "alice") {
    const res = await request(app).post("/users").send({ username });
    return res.body.id as string;
  }

  it("returns the user profile including favoriteNumber when flag is on", async () => {
    setFlags({ showFavoriteNumber: true });
    const id = await createUser();
    const res = await request(app).get(`/users/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, username: "alice", plan: "free", favoriteColor: null });
    expect("favoriteNumber" in res.body).toBe(true);
  });

  it("omits favoriteNumber from the response when the flag is off", async () => {
    setFlags({ showFavoriteNumber: false });
    const id = await createUser();
    const res = await request(app).get(`/users/${id}`);
    expect(res.status).toBe(200);
    expect("favoriteNumber" in res.body).toBe(false);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app).get("/users/000000000000000000000000");
    expect(res.status).toBe(404);
  });
});

// ── PATCH /users/:id/preferences ─────────────────────────────────

describe("PATCH /users/:id/preferences", () => {
  async function createUser(username = "alice") {
    const res = await request(app).post("/users").send({ username });
    return res.body.id as string;
  }

  it("updates plan", async () => {
    const id = await createUser();
    const res = await request(app).patch(`/users/${id}/preferences`).send({ plan: "pro" });
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("pro");
  });

  it("updates favoriteColor to a basic palette color", async () => {
    const id = await createUser();
    const res = await request(app).patch(`/users/${id}/preferences`).send({ favoriteColor: "blue" });
    expect(res.status).toBe(200);
    expect(res.body.favoriteColor).toBe("blue");
  });

  it("rejects a color not in either palette", async () => {
    const id = await createUser();
    const res = await request(app).patch(`/users/${id}/preferences`).send({ favoriteColor: "chartreuse" });
    expect(res.status).toBe(400);
  });

  it("rejects an extended-palette color when user is not in the extended rollout", async () => {
    setFlags({ extendedPalette: false });
    const id = await createUser();
    const res = await request(app).patch(`/users/${id}/preferences`).send({ favoriteColor: "coral" });
    expect(res.status).toBe(400);
  });

  it("accepts an extended-palette color when user is in the extended rollout", async () => {
    setFlags({ extendedPalette: true });
    const id = await createUser();
    const res = await request(app).patch(`/users/${id}/preferences`).send({ favoriteColor: "coral" });
    expect(res.status).toBe(200);
    expect(res.body.favoriteColor).toBe("coral");
  });

  it("updates favoriteNumber within the allowed range for free plan", async () => {
    setFlags({ showFavoriteNumber: true, proNumberRange: false });
    const id = await createUser();
    const res = await request(app).patch(`/users/${id}/preferences`).send({ favoriteNumber: 5 });
    expect(res.status).toBe(200);
    expect(res.body.favoriteNumber).toBe(5);
  });

  it("rejects favoriteNumber above the free-plan cap (10)", async () => {
    setFlags({ showFavoriteNumber: true, proNumberRange: false });
    const id = await createUser();
    const res = await request(app).patch(`/users/${id}/preferences`).send({ favoriteNumber: 42 });
    expect(res.status).toBe(400);
  });

  it("allows favoriteNumber up to 100 when pro plan and pro-number-range flag is true", async () => {
    setFlags({ showFavoriteNumber: true, proNumberRange: true });
    const id = await createUser();
    await request(app).patch(`/users/${id}/preferences`).send({ plan: "pro" });
    const res = await request(app).patch(`/users/${id}/preferences`).send({ favoriteNumber: 99 });
    expect(res.status).toBe(200);
    expect(res.body.favoriteNumber).toBe(99);
  });

  it("applies the new plan's range when plan and favoriteNumber are updated together", async () => {
    // Upgrading to pro in the same request unlocks the full range.
    // pro-number-range flag mock checks attributes.plan — our mock returns proNumberRange flag value.
    setFlags({ showFavoriteNumber: true, proNumberRange: true });
    const id = await createUser();
    const res = await request(app)
      .patch(`/users/${id}/preferences`)
      .send({ plan: "pro", favoriteNumber: 77 });
    expect(res.status).toBe(200);
  });

  it("returns 400 when favoriteNumber is submitted but show-favorite-number flag is off", async () => {
    setFlags({ showFavoriteNumber: false });
    const id = await createUser();
    const res = await request(app).patch(`/users/${id}/preferences`).send({ favoriteNumber: 5 });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app)
      .patch("/users/000000000000000000000000/preferences")
      .send({ plan: "pro" });
    expect(res.status).toBe(404);
  });
});

// ── GET /users/:id/options ────────────────────────────────────────

describe("GET /users/:id/options", () => {
  async function createUser(username = "alice", plan?: "free" | "basic" | "pro") {
    const res = await request(app).post("/users").send({ username });
    const id = res.body.id as string;
    if (plan) {
      await getUsersCollection().updateOne(
        { username },
        { $set: { plan, updatedAt: new Date() } }
      );
    }
    return id;
  }

  it("returns favoriteNumberEnabled: false and null range when flag is off", async () => {
    setFlags({ showFavoriteNumber: false });
    const id = await createUser();
    const res = await request(app).get(`/users/${id}/options`);
    expect(res.status).toBe(200);
    expect(res.body.favoriteNumberEnabled).toBe(false);
    expect(res.body.favoriteNumberRange).toBeNull();
  });

  it("returns favoriteNumberEnabled: true with range when flag is on", async () => {
    setFlags({ showFavoriteNumber: true, proNumberRange: false });
    const id = await createUser();
    const res = await request(app).get(`/users/${id}/options`);
    expect(res.status).toBe(200);
    expect(res.body.favoriteNumberEnabled).toBe(true);
    expect(res.body.favoriteNumberRange).toEqual({ min: 0, max: 10 });
  });

  it("returns max: 50 for basic plan when pro-number-range is false", async () => {
    setFlags({ showFavoriteNumber: true, proNumberRange: false });
    const id = await createUser("basic-user", "basic");
    const res = await request(app).get(`/users/${id}/options`);
    expect(res.body.favoriteNumberRange).toEqual({ min: 0, max: 50 });
  });

  it("returns max: 100 for pro plan when pro-number-range flag is true", async () => {
    setFlags({ showFavoriteNumber: true, proNumberRange: true });
    const id = await createUser("pro-user", "pro");
    const res = await request(app).get(`/users/${id}/options`);
    expect(res.body.favoriteNumberRange).toEqual({ min: 0, max: 100 });
  });

  it("returns max: 80 for pro plan when pro-number-range flag is false", async () => {
    setFlags({ showFavoriteNumber: true, proNumberRange: false });
    const id = await createUser("pro-user2", "pro");
    const res = await request(app).get(`/users/${id}/options`);
    expect(res.body.favoriteNumberRange).toEqual({ min: 0, max: 80 });
  });

  it("returns the basic color palette when extended-color-palette flag is off", async () => {
    setFlags({ extendedPalette: false });
    const id = await createUser();
    const res = await request(app).get(`/users/${id}/options`);
    expect(res.body.availableColors).toEqual(["red", "blue", "green", "yellow", "purple"]);
  });

  it("returns the extended color palette when extended-color-palette flag is on", async () => {
    setFlags({ extendedPalette: true });
    const id = await createUser();
    const res = await request(app).get(`/users/${id}/options`);
    expect(res.body.availableColors).toContain("coral");
    expect(res.body.availableColors.length).toBe(12);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app).get("/users/000000000000000000000000/options");
    expect(res.status).toBe(404);
  });
});
