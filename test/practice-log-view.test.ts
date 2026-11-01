import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import { exportProfileBackup } from "../src/storage/backup";
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

function setFile(input: { element: Element }, text: string) {
  const file = new File([text], "backup.json", { type: "application/json" });
  Object.defineProperty(input.element, "files", { configurable: true, value: [file] });
}

async function untilStored(predicate: (profile: Profile) => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flushPromises();
    const stored = await loadProfile();
    if (predicate(stored)) return stored;
  }
  throw new Error("profile was not persisted");
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
    expect(stored.practiceLog[0]?.completed).toBe(false);
    expect(stored.practiceLog[0]?.screen).toBe("practice");
    expect(stored.practiceLog[0]?.focus).toBe("自由练习");
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

  it("imports a backup from 我的 and persists it", async () => {
    await saveProfile(assessedProfile());
    const wrapper = mount(App);
    await untilSelector(wrapper, "[data-test=home-surface]");

    await wrapper.get("[data-section=me]").trigger("click");
    await untilSelector(wrapper, "[data-test=me-backup]");

    const incoming = assessedProfile({
      l1RightPassed: true,
      practiceLog: [{ at: 1_800_000_000_000, kind: "theory", ms: 60_000 }],
    });
    setFile(wrapper.get("[data-test=me-backup-file]"), exportProfileBackup(incoming));
    await wrapper.get("[data-test=me-backup-file]").trigger("change");
    await untilSelector(wrapper, "[data-test=me-backup-pending]");

    await wrapper.get("[data-test=me-backup-confirm]").trigger("click");
    const stored = await untilStored((profile) => profile.l1RightPassed);

    expect(stored.practiceLog).toHaveLength(1);
    expect(stored.practiceLog[0]?.kind).toBe("theory");
  });
});
