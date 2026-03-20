import { ObjectId } from "mongodb";
import type { Collection, WithId } from "mongodb";
import { getDb } from "../db/client.js";

export interface User {
  username: string;
  plan: "free" | "basic" | "pro";
  favoriteNumber: number | null;
  favoriteColor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function getUsersCollection(): Collection<User> {
  return getDb().collection<User>("users");
}

export async function findUserById(id: string): Promise<WithId<User> | null> {
  if (!ObjectId.isValid(id)) return null;
  return getUsersCollection().findOne({ _id: new ObjectId(id) });
}
