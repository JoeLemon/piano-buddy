import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import { exportProfileBackup } from "../src/storage/backup";
import MeView from "../src/ui/MeView.vue";

const NOON = new Date(2026, 9, 20, 12, 0, 0).getTime();
const MINUTE = 60 * 1000;

function profile(partial: Partial<Profile> = {}): Profile {
  return { ...initialProfile(), ...partial };
}

async function waitFor(assertion: () => void, timeout = 2_000) {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start > timeout) throw error;
      await flushPromises();
      await new Promise((done) => setTimeout(done, 10));
    }
  }
}

function setFile(input: { element: Element }, text: string) {
  const file = new File([text], "backup.json", { type: "application/json" });
  Object.defineProperty(input.element, "files", { configurable: true, value: [file] });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MeView 最近练习", () => {
  it("shows the last days with per-entry time, kind and duration", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOON);
    const wrapper = mount(MeView, {
      props: {
        profile: profile({
          practiceLog: [
            { at: NOON, kind: "reading", ms: 20 * MINUTE },
            { at: NOON + MINUTE, kind: "theory", ms: 10 * MINUTE },
            { at: NOON - 24 * 60 * MINUTE, kind: "sight", ms: 5 * MINUTE },
          ],
        }),
      },
    });

    const days = wrapper.findAll("[data-test=me-history-day]");
    expect(days).toHaveLength(2);
    expect(days[0]?.text()).toContain("今天");
    expect(days[0]?.text()).toContain("2 条 · 30 分钟");
    expect(days[1]?.text()).toContain("昨天");

    const entries = days[0]!.findAll("[data-test=me-history-entry]");
    expect(entries.map((entry) => entry.text())).toEqual([
      "12:01乐理10 分钟",
      "12:00识谱20 分钟",
    ]);
  });

  it("shows an empty state before the first practice", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOON);
    const wrapper = mount(MeView, { props: { profile: profile() } });

    expect(wrapper.get("[data-test=me-history-empty]").text()).toContain("还没有练习记录");
    expect(wrapper.findAll("[data-test=me-history-day]")).toHaveLength(0);
  });

  it("keeps the existing summary rows and actions", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOON);
    const wrapper = mount(MeView, {
      props: { profile: profile({ practiceLog: [{ at: NOON, kind: "reading", ms: 20 * MINUTE }] }) },
    });

    expect(wrapper.get("[data-test=me-practice]").text()).toContain("今日练习");
    expect(wrapper.get("[data-test=me-practice]").text()).toContain("20 分钟");
    expect(wrapper.find("[data-test=me-settings]").exists()).toBe(true);
  });

  it("shows local metrics and the gap hit rate", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOON);
    const wrapper = mount(MeView, {
      props: {
        profile: profile({
          practiceLog: [
            {
              at: NOON - MINUTE,
              kind: "theory",
              ms: 10 * MINUTE,
              completed: false,
              screen: "practice",
              focus: "L4-1",
            },
          ],
          gapAttempts: [
            {
              at: NOON - MINUTE,
              source: "error-book",
              scoreId: "s1",
              hand: "RH",
              onCount: 3,
              total: 4,
            },
          ],
        }),
      },
    });

    const metrics = wrapper.get("[data-test=me-metrics]").text();
    expect(metrics).toContain("近 30 天练习");
    expect(metrics).toContain("放弃点");
    expect(metrics).toContain("L4-1");
    expect(metrics).toContain("缺口命中率");
    expect(metrics).toContain("75%");
    expect(wrapper.find("[data-test=me-metrics-export]").exists()).toBe(true);
  });
});

describe("MeView 学习档案", () => {
  it("导入前先展示摘要，确认后才覆盖当前档案", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOON);
    const incoming = profile({
      l1RightPassed: true,
      practiceLog: [{ at: NOON, kind: "theory", ms: 10 * MINUTE }],
    });
    const wrapper = mount(MeView, { props: { profile: profile() } });

    setFile(wrapper.get("[data-test=me-backup-file]"), exportProfileBackup(incoming));
    await wrapper.get("[data-test=me-backup-file]").trigger("change");

    await waitFor(() => {
      expect(wrapper.get("[data-test=me-backup-pending]").text()).toContain("1 条练习记录");
    });
    expect(wrapper.emitted("replace-profile")).toBeUndefined();

    await wrapper.get("[data-test=me-backup-confirm]").trigger("click");
    expect(wrapper.emitted("replace-profile")?.at(-1)?.[0]).toMatchObject({ l1RightPassed: true });
    expect(wrapper.get("[data-test=me-backup-notice]").text()).toContain("已导入");
    expect(wrapper.find("[data-test=me-backup-pending]").exists()).toBe(false);
  });

  it("取消导入不会覆盖档案", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOON);
    const wrapper = mount(MeView, { props: { profile: profile() } });

    setFile(wrapper.get("[data-test=me-backup-file]"), exportProfileBackup(profile()));
    await wrapper.get("[data-test=me-backup-file]").trigger("change");
    await waitFor(() => {
      expect(wrapper.find("[data-test=me-backup-pending]").exists()).toBe(true);
    });

    await wrapper.get("[data-test=me-backup-cancel]").trigger("click");
    expect(wrapper.find("[data-test=me-backup-pending]").exists()).toBe(false);
    expect(wrapper.emitted("replace-profile")).toBeUndefined();
  });

  it("导入不是 Piano Buddy 的 JSON 时给出错误，不出现确认面板", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOON);
    const wrapper = mount(MeView, { props: { profile: profile() } });

    setFile(wrapper.get("[data-test=me-backup-file]"), JSON.stringify({ hello: "world" }));
    await wrapper.get("[data-test=me-backup-file]").trigger("change");

    await waitFor(() => {
      expect(wrapper.get("[data-test=me-backup-error]").text()).toContain("不是 Piano Buddy");
    });
    expect(wrapper.find("[data-test=me-backup-pending]").exists()).toBe(false);
    expect(wrapper.emitted("replace-profile")).toBeUndefined();
  });

  it("提供导出入口，并说明换设备时的本地迁移方式", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOON);
    const wrapper = mount(MeView, { props: { profile: profile() } });
    expect(wrapper.find("[data-test=me-backup-export]").exists()).toBe(true);
    expect(wrapper.get("[data-test=me-backup]").text()).toContain("换设备时在新设备导入");
  });
});
