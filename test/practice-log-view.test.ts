import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import { loadProfile, saveProfile } from "../src/storage/db";
import App from "../src/App.vue";

function assessedProfile(partial: Partial<Profile> = {}): Profile {
  return {
    ...initialProfile(),
    assessment: { knowsTreble: true, knowsBass: false, keepsPulse: true },
    lessonId: "L1-1",
    ...partial,
  };
}

async function untilSelector(wrapper: { find: (selector: string) => { exists: () => boolean } }, selector: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flushPromises();
    if (wrapper.find(selector).exists()) return;
  }
  throw new Error(`missing ${selector}`);
}

enableAutoUnmount(afterEach);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App practice log", () => {
  it("records the time spent on a practice screen when leaving it", async () => {
    await saveProfile(assessedProfile());
    const now = 1_800_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);

    const wrapper = mount(App);
    await untilSelector(wrapper, "[data-test=home-surface]");

    await wrapper.get("[data-section=practice]").trigger("click");
    await untilSelector(wrapper, "[data-test=practice]");

    clock.mockReturnValue(now + 30_000);
    await wrapper.get("[data-section=today]").trigger("click");
    await flushPromises();

    const stored = await loadProfile();
    expect(stored.practiceLog).toHaveLength(1);
    expect(stored.practiceLog[0]?.kind).toBe("theory");
    expect(stored.practiceLog[0]?.ms).toBe(30_000);
    expect(stored.practiceLog[0]?.at).toBe(now);
  });

  it("does not log a quick look that stays under 15 seconds", async () => {
    await saveProfile(assessedProfile());
    const now = 1_800_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);

    const wrapper = mount(App);
    await untilSelector(wrapper, "[data-test=home-surface]");

    await wrapper.get("[data-section=practice]").trigger("click");
    await untilSelector(wrapper, "[data-test=practice]");
    clock.mockReturnValue(now + 5_000);
    await wrapper.get("[data-section=today]").trigger("click");
    await flushPromises();

    const stored = await loadProfile();
    expect(stored.practiceLog).toHaveLength(0);
  });
});
