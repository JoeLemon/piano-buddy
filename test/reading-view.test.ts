import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { initialProfile } from "../src/domain/profile";
import ReadingView from "../src/ui/ReadingView.vue";

describe("ReadingView", () => {
  it("shows the keyboard map and does not advance without MIDI", async () => {
    const wrapper = mount(ReadingView, {
      props: {
        profile: { ...initialProfile(), lessonId: "L1-2" },
        midiConnected: false,
      },
    });
    expect(wrapper.text()).toContain("请连接 MIDI 键盘");
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(true);
    expect(wrapper.emitted("update-profile")).toBeFalsy();
  });
});
