"""Combine visually reviewed microsteps without re-encoding instructor videos.

The teaching player uses exact windows of the preserved parent MP4s, and genuine
parent MediaPipe observations. Timings remain source-relative; playback speed is
only a presentation control and never changes the saved observations.
"""
from pathlib import Path
import json
import hashlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/practice-media'
parents = json.loads((OUT / '24-playlist.json').read_text(encoding='utf-8'))
groups = []
for filename in ['teaching-steps-01-12.json', 'teaching-steps-13-24.json']:
    value = json.loads((ROOT / 'scripts' / filename).read_text(encoding='utf-8'))
    groups.extend(value if isinstance(value, list) else value['forms'])
groups.sort(key=lambda value: value['formNumber'])
assert [group['formNumber'] for group in groups] == list(range(1, 25))
steps = []
for group, parent in zip(groups, parents['clips']):
    rows = group['steps']
    assert rows and abs(rows[0]['startSeconds'] - parent['startSeconds']) < 0.035
    assert abs(rows[-1]['endSeconds'] - parent['endSeconds']) < 0.035
    previous = parent['startSeconds']
    for index, row in enumerate(rows, 1):
        start, end = row['startSeconds'], row['endSeconds']
        assert abs(start - previous) < 0.035 and end > start, (group['formNumber'], index)
        assert end <= parent['endSeconds'] + 0.035
        # Snap boundaries to source frames and share the exact adjacent cut.
        start, end = round(start * 30) / 30, round(end * 30) / 30
        endpoints = {13: 15, 15: 15, 14: 16, 16: 16, 25: 27, 27: 27, 26: 28, 28: 28}
        focus = sorted({endpoints[joint] for joint in row.get('focusJoints', parent['focusJoints']) if joint in endpoints}) or parent['focusJoints']
        assert focus and set(focus).issubset({15, 16, 27, 28})
        target_source = row.get('targetSourceSeconds', max(start, end - 1 / 30))
        assert start - 0.001 <= target_source < end + 0.001
        steps.append({
            **{key: value for key, value in row.items() if key not in ['startSeconds', 'endSeconds']},
            'id': f'teaching-{group["formNumber"]:02}-{index:02}',
            'parentFormId': parent['id'], 'parentFormOrder': group['formNumber'],
            'parentFormTitle': parent['title'], 'stepOrder': index,
            'startSeconds': round(start - parent['startSeconds'], 6),
            'endSeconds': round(end - parent['startSeconds'], 6),
            'sourceStartSeconds': start, 'sourceEndSeconds': end,
            'targetSourceSeconds': target_source,
            'targetSeconds': round(target_source - parent['startSeconds'], 6),
            'focusJoints': focus,
        })
        previous = end
document = {
    'schemaVersion': 'teaching-steps-v1', 'id': 'tai-chi-24-teaching-v1',
    'title': '24 forms · one small step at a time', 'source': '24.mp4',
    'referencePlaylistSrc': '/practice-media/24-playlist.json',
    'sourceSha256': parents['sourceSha256'],
    'provenance': 'Manually reviewed source-video microsteps. Actual parent video and MediaPipe observations are preserved; no interpolated or fabricated poses.',
    'defaultPlaybackRate': 0.5, 'defaultAdvanceMode': 'manual',
    'steps': steps,
}
(OUT / 'teaching-playlist.json').write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
review = ROOT / 'artifacts/teaching-step-review'
review.mkdir(parents=True, exist_ok=True)
lines = ['# 24式逐步跟练分解表', '', '按实际视频转换人工拆分。播放器每步慢速示范后停住，学习者不限时模仿，再自行确认下一步。', '', '| 式 | 小步 | 动作 | 原视频起止（秒） | 跟做提示 |', '| --- | --- | --- | --- | --- |']
for step in steps:
    lines.append(f'| {step["parentFormOrder"]:02} | {step["stepOrder"]:02} | {step.get("chineseTitle", step["title"])} | {step["sourceStartSeconds"]:.3f}–{step["sourceEndSeconds"]:.3f} | {step.get("chineseCue", step["cue"])} |')
(review / '分解动作表.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({'forms': len(groups), 'steps': len(steps), 'secondFormSteps': len(groups[1]['steps']), 'sourceSeconds': round(sum(s['endSeconds'] - s['startSeconds'] for s in steps), 3)}, ensure_ascii=True))
