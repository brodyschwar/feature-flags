export interface User {
  id: string;
  username: string;
  plan: "free" | "basic" | "pro";
  favoriteColor: string | null;
  favoriteNumber?: number | null;
}

export interface UserOptions {
  favoriteNumberEnabled: boolean;
  favoriteNumberRange: { min: number; max: number } | null;
  availableColors: string[];
}

export interface Preferences {
  plan?: "free" | "basic" | "pro";
  favoriteColor?: string;
  favoriteNumber?: number;
}
