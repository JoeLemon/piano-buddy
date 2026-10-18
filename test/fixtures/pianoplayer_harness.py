"""对照 harness：用上游 pianoplayer 的 Hand 求解器跑一组固定场景，
生成 test/fixtures/pianoplayer-reference.ts，用于验证 TypeScript 移植的保真度。

用法（需要 Python 3.8+）：
    pip install pianoplayer          # 或从 GitHub 取 pianoplayer/hand.py + models.py
    python test/fixtures/pianoplayer_harness.py > /tmp/ref.json
    # 再把 /tmp/ref.json 的场景写进 pianoplayer-reference.ts（见文件头注释）

说明：
- 每个场景用显式的 (midi, time, duration) 定义，并支持和弦分组，
  保证 TypeScript 移植可以拿到逐字节一致的输入。
- x 坐标使用与上游 keypos()（乐谱路径）等价的单调映射，
  而不是 keypos_midi()（MIDI 路径，B→C 边界不单调）。
- 输入 finger 为锚点（0 = 待求解）；输出 fingers 为上游求解结果。
"""
import json
import sys

from pianoplayer.hand import Hand
from pianoplayer.models import INote

WHITE_INDEX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]
BLACK_OFFSET = [0, 0.5, 0, 0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0]
WHITE_KEY_CM = 16.5 / 7.0


def key_pos(midi):
    octave = midi // 12
    pc = midi - octave * 12
    return WHITE_KEY_CM * (7 * octave + WHITE_INDEX[pc] + BLACK_OFFSET[pc])


def is_black(midi):
    return (midi % 12) in (1, 3, 6, 8, 10)


def note(midi, time, duration, finger=0, chord=None):
    n = INote()
    n.pitch = midi
    n.octave = midi // 12 - 1
    n.x = key_pos(midi)
    n.time = time
    n.duration = duration
    n.isBlack = is_black(midi)
    n.fingering = finger
    if chord is not None:
        n.isChord = True
        n.chordID = chord[0]
        n.chordnr = chord[1]
        n.NinChord = chord[2]
    return n


def run(name, notes, side):
    input_fingers = [int(n.fingering) if not isinstance(n.fingering, str) else 0 for n in notes]
    hand = Hand(noteseq=notes, side=side, size="M")
    hand.generate()
    return {
        "name": name,
        "side": side,
        "notes": [
            {
                "midi": n.pitch,
                "time": round(n.time, 6),
                "duration": round(n.duration, 6),
                "isChord": bool(n.isChord),
                "chordId": int(n.chordID),
                "chordNr": int(n.chordnr),
                "notesInChord": int(n.NinChord),
                "finger": input_fingers[i],
            }
            for i, n in enumerate(notes)
        ],
        "fingers": [n.fingering for n in notes],
        "cost": [round(n.cost, 3) for n in notes],
    }


SCALE = [60, 62, 64, 65, 67, 69, 71, 72]
scenarios = []

# 1. RH C-major scale, quarter notes
scenarios.append(run(
    "scale-rh-quarters",
    [note(m, float(i), 1.0) for i, m in enumerate(SCALE)],
    "right",
))

# 2. RH C-major scale, eighth notes
scenarios.append(run(
    "scale-rh-eighths",
    [note(m, i * 0.5, 0.5) for i, m in enumerate(SCALE)],
    "right",
))

# 3. LH descending scale, quarter notes
scenarios.append(run(
    "scale-lh-descending-quarters",
    [note(m, float(i), 1.0) for i, m in enumerate(reversed(SCALE))],
    "left",
))

# 4. RH chord progression (triads), each chord staggered by 0.05 like the reader
def chord_notes(chords):
    out = []
    for cid, pitches in enumerate(chords):
        n = len(pitches)
        for k, m in enumerate(pitches):
            out.append(note(m, float(cid) - 0.05 * (n - 1 - k), 1.0 + 0.05 * (n - 1), chord=(cid, k, n)))
    return out


scenarios.append(run(
    "chords-rh-triad-progression",
    chord_notes([[60, 64, 67], [62, 65, 69], [64, 67, 71], [65, 69, 72]]),
    "right",
))

# 5. LH chord progression
scenarios.append(run(
    "chords-lh-triad-progression",
    chord_notes([[48, 52, 55], [50, 53, 57], [55, 59, 62]]),
    "left",
))

# 6. Anchor: first note pre-annotated with finger 2
scenarios.append(run(
    "anchor-first-finger-2",
    [note(m, float(i), 1.0, finger=2 if i == 0 else 0) for i, m in enumerate(SCALE)],
    "right",
))

# 7. Chromatic-ish black key line
scenarios.append(run(
    "black-keys-rh",
    [note(m, float(i), 1.0) for i, m in enumerate([60, 61, 62, 63, 64, 65, 66, 67])],
    "right",
))

# 8. Two-octave run, quarter notes (forces hand shifts)
scenarios.append(run(
    "two-octave-run-rh",
    [note(m, float(i), 1.0) for i, m in enumerate(range(60, 75))],
    "right",
))

# 9. L2-like eighth-note line inside the C position
scenarios.append(run(
    "l2-like-eighths-rh",
    [note(m, i * 0.5, 0.5) for i, m in enumerate([60, 64, 67, 64, 60, 62, 65, 62, 60, 64, 67, 72])],
    "right",
))

# 10. Repeated notes (same pitch allowed, same finger on new pitch discouraged)
scenarios.append(run(
    "repeated-notes-rh",
    [note(m, float(i), 1.0) for i, m in enumerate([60, 60, 60, 62, 62, 64, 64, 65])],
    "right",
))

# 11. Single note then chord then note (chord transitions)
mixed = [note(60, 0.0, 1.0)]
mixed += [note(m, 1.0 - 0.05 * (1 - k), 1.0 + 0.05, chord=(1, k, 2)) for k, m in enumerate([64, 67])]
mixed += [note(72, 2.0, 1.0)]
scenarios.append(run("mixed-single-chord-single", mixed, "right"))

# 12. Sixteenth-note scalar run
scenarios.append(run(
    "scale-rh-sixteenths",
    [note(m, i * 0.25, 0.25) for i, m in enumerate(SCALE)],
    "right",
))

# 13. Short 5-note scale (tail drain path: single depth-5 window)
scenarios.append(run(
    "scale-rh-5-quarters",
    [note(m, float(i), 1.0) for i, m in enumerate(SCALE[:5])],
    "right",
))

# 14. Short 5-note scale with anchor on the first note
scenarios.append(run(
    "anchor-5-quarters",
    [note(m, float(i), 1.0, finger=2 if i == 0 else 0) for i, m in enumerate(SCALE[:5])],
    "right",
))

# 15. Single note, C-major chord, single note (chord write-back scenario)
chord_scene = [note(60, 0.0, 1.0)]
chord_scene += [note(m, 1.0 - 0.05 * (2 - k), 1.0 + 0.05 * 2, chord=(1, k, 3)) for k, m in enumerate([60, 64, 67])]
chord_scene += [note(72, 2.0, 1.0)]
scenarios.append(run("single-chord-c4e4g4-single", chord_scene, "right"))

print(json.dumps({"scenarios": scenarios}, indent=1))
