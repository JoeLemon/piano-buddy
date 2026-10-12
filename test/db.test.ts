import { describe, expect, it } from "vitest";
import { initialProfile } from "../src/domain/profile";
import { loadProfile, saveProfile } from "../src/storage/db";

describe("profile store", () => {
  it("returns a new profile and then the saved one", async () => {
    expect(await loadProfile()).toEqual(initialProfile());
    const saved = { ...initialProfile(), l1RightPassed: true };
    await saveProfile(saved);
    expect(await loadProfile()).toEqual(saved);
  });
});
