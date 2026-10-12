import { afterEach, describe, expect, it } from "vitest";
import { subscribeMidi } from "../src/midi/access";

class FakeInput extends EventTarget {
  type: "input" | "output" = "input";
  state: "connected" | "disconnected" = "connected";
  connection: "open" | "closed" | "pending" = "open";
  openCalls = 0;
  failOpen = false;

  open(): Promise<MIDIPort> {
    this.openCalls += 1;
    if (this.failOpen) return Promise.reject(new Error("open-failed"));
    this.connection = "open";
    return Promise.resolve(this as unknown as MIDIPort);
  }
}

function installAccess(inputs: FakeInput[]) {
  const access = new EventTarget() as EventTarget & {
    inputs: { forEach: (callback: (input: FakeInput) => void) => void };
  };
  access.inputs = {
    forEach: (callback) => {
      for (const input of inputs) callback(input);
    },
  };
  (navigator as unknown as { requestMIDIAccess: () => Promise<unknown> }).requestMIDIAccess = async () => access;
  return access;
}

function noteOn(midi: number) {
  const event = new Event("midimessage");
  Object.assign(event, { data: Uint8Array.from([0x90, midi, 100]) });
  return event;
}

afterEach(() => {
  delete (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
});

describe("subscribeMidi", () => {
  it("reopens the same input when that keyboard is plugged back in", async () => {
    const input = new FakeInput();
    const access = installAccess([input]);
    const notes: number[] = [];
    const unsubscribe = await subscribeMidi((note) => {
      if (note.kind === "on") notes.push(note.midi);
    });

    input.connection = "closed";
    const state = new Event("statechange");
    Object.assign(state, { port: input });
    access.dispatchEvent(state);
    await Promise.resolve();

    expect(input.openCalls).toBe(1);
    input.dispatchEvent(noteOn(60));
    expect(notes).toEqual([60]);
    unsubscribe();
  });

  it("rejects when a closed input fails to open", async () => {
    const input = new FakeInput();
    input.connection = "closed";
    input.failOpen = true;
    installAccess([input]);
    await expect(subscribeMidi(() => {})).rejects.toThrow("open-failed");
  });

  it("handles a failed open after subscribe and retries on the next connect", async () => {
    const reasons: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      reasons.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const input = new FakeInput();
    const access = installAccess([input]);
    const unsubscribe = await subscribeMidi(() => {});
    try {
      input.connection = "closed";
      input.failOpen = true;
      access.dispatchEvent(connected(input));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reasons).toEqual([]);
      expect(input.openCalls).toBe(1);

      access.dispatchEvent(connected(input));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(input.openCalls).toBe(2);
      expect(reasons).toEqual([]);
    } finally {
      unsubscribe();
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

function connected(input: FakeInput) {
  const state = new Event("statechange");
  Object.assign(state, { port: input });
  return state;
}
