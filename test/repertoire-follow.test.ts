import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { initialProfile } from "../src/domain/profile";
import { saveProfile } from "../src/storage/db";
import App from "../src/App.vue";

async function untilSelector(wrapper: { find: (selector: string) => { exists: () => boolean } }, selector: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flushPromises();
    if (wrapper.find(selector).exists()) return;
  }
  throw new Error(`missing ${selector}`);
}

enableAutoUnmount(afterEach);

describe("App repertoire follow", () => {
  it("opens a sliced segment in sight-reading mode and can return to the library", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
      lessonId: "L2-1",
      l1RightPassed: true,
      l1LeftPassed: true,
      l2Passed: true,
      seenSightTips: true,
    });

    const wrapper = mount(App);
    await untilSelector(wrapper, "[data-test=home-surface]");

    await wrapper.get("[data-section=library]").trigger("click");
    await untilSelector(wrapper, "[data-test=repertoire]");

    await wrapper.get('[data-arrangement="arr.ode-to-joy.standard"]').trigger("click");
    await wrapper.get("[data-test=repertoire-follow]").trigger("click");
    await untilSelector(wrapper, "[data-mode=sight]");

    const sight = wrapper.get("[data-mode=sight]");
    expect(sight.attributes("data-score-id")).toMatch(/\.m1-2$/);
    expect(sight.get("[data-test=sight-remaining]").text()).toContain("跟弹本段");
  });
});
