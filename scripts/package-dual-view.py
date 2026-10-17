"""Package the verified paired recordings and a portable recorded-pose player."""
from pathlib import Path
import copy
import json
import shutil
import zipfile

ROOT=Path(__file__).resolve().parents[1]
REVIEW=ROOT/'artifacts/dual-view-review'
DEST=ROOT.parents[1]/'front_back_processed'
manifest=json.loads((DEST/'alignment.json').read_text(encoding='utf-8'))
pose=json.loads((REVIEW/'pose-integrity.json').read_text(encoding='utf-8'))
video=json.loads((REVIEW/'video-integrity.json').read_text(encoding='utf-8'))
browser=json.loads((REVIEW/'browser-qa.json').read_text(encoding='utf-8'))
assert video['sourceHashesUnchanged'] and video['allOutputsFullyDecoded']
assert len(video['outputs'])==75 and browser['result']=='PASS' and browser['allForms']
assert browser['checkedIntervals']==sum(len(f['steps']) for f in manifest['forms'])
portable=copy.deepcopy(manifest)
for view in ['front','back']:
    shutil.copyfile(ROOT.parents[1]/f'{view}.mp4',DEST/f'{view}-source.mp4')
    portable['sources'][view]['src']=f'/{view}-source.mp4'
    for f in portable['forms']:
        f[view]['poseSrc']=f'/{view}/{f["formNumber"]:02}_{f["chineseTitle"]}.poses.json'
mp=DEST/'practice-media/dual-view/manifest.json';mp.parent.mkdir(parents=True,exist_ok=True)
mp.write_text(json.dumps(portable,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
shutil.copyfile(ROOT/'public/dual-view.html',DEST/'dual-view.html')
shutil.copyfile(REVIEW/'actual-recorded-pose-qa.jpg',DEST/'处理效果预览.jpg')
server=(ROOT/'scripts/serve-dual-view.mjs').read_text(encoding='utf-8')
server=server.replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')","path.dirname(fileURLToPath(import.meta.url))")
server=server.replace('|| 8766','|| 8767')
(DEST/'serve.mjs').write_text(server,encoding='utf-8')
(DEST/'启动同步回放.cmd').write_text('@echo off\r\ncd /d "%~dp0"\r\necho Open http://127.0.0.1:8767/dual-view.html\r\nnode serve.mjs\r\npause\r\n',encoding='ascii')
stats={}
for view,r in pose.items():
    c=r['routineStatuses'];total=sum(c.values())
    stats[view]={'allSourceFrames':r['totalFrames'],'routineFrames':total,
                 'routinePoseFrames':c['pose'],'routineMissingFrames':c['no_pose'],
                 'routineInferenceErrors':c['inference_error'],'routineDetectionRate':c['pose']/total}
quality={'sources':stats,'poseIntegrity':pose,'videoIntegrity':video,'browserQa':browser}
(DEST/'质量检查.json').write_text(json.dumps(quality,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
steps=sum(len(f['steps']) for f in manifest['forms'])
lines=[
    '# 太极拳正面 / 背面同步处理结果', '',
    f'2026-10-16：24 式，{steps} 个对应小步骤；两个原视频共 17,410 帧均分别执行真实本地 MediaPipe 推理。', '',
    '## 直接查看', '',
    '- `正背同步_MediaPipe_完整.mp4`：全套正背同步骨架视频，正面为主时间轴。',
    '- `front_mediapipe.mp4` / `back_mediapipe.mp4`：两路各自原速骨架视频，移除片头和动作完成后的静止/致意。',
    '- `front/` / `back/`：每路 24 个原速、完整画面的动作 MP4，及每式独立的 33 点 JSON。',
    '- `aligned/`：24 个按式配对的正背同步骨架视频。背面按动作阶段变速映射，保留真实帧，可能重复或跳过源帧。',
    f'- `动作对齐与分解.csv`：{steps} 个小步骤的中英动作名称、说明与两路原视频时间；Excel 可直接打开。',
    '- `alignment.json`：审核后的源时间映射及每式、每小步骤结构。', '',
    '## 交互回放', '',
    '本机已启动项目播放器：http://127.0.0.1:8766/dual-view.html 。',
    '本文件夹也可独立使用：双击 `启动同步回放.cmd`（需要已安装 Node.js），再访问 http://127.0.0.1:8767/dual-view.html 。',
    '支持选择 24 式或小步骤、0.25/0.5/0.75/1 倍速、暂停、重播、拖动和骨架开关；每段结束定格。无需网络或摄像头。',
    '`dual-view.html` 应通过本地服务打开；浏览器不允许 file:// 页面直接读取 JSON。', '',
    '## 关键点和缺失数据', '',
    '- `front.full.poses.json` / `back.full.poses.json` 包含原视频每一帧，含片头、片尾。',
    '- 每个成功检测包含 33 个 `landmarks` 和 33 个 `worldLandmarks`，保留 MediaPipe 原始 x/y/z、visibility、presence。',
    '- `frameIndex`、`sourceTimeSeconds`、`tMs` 均对应原视频绝对时间；每式文件的时间没有重置为零。',
    '- `no_pose` / `inference_error` 保留为空点集；未插值、未从另一视角补点。可见度低于 0.45 的点不绘制，原始数值仍保留。',
    '- worldLandmarks 是模型对各自画面的空间估计；没有相机标定，也没有把正背两个结果融合为共同三维重建。', '',
    '## 对齐和精度', '',
    '两个文件是节奏略有不同的独立示范。审核逐个动作阶段对应点，按分段线性函数映射源时间，没有用一个固定秒数偏移整个视频。',
    '语义阶段经 0.5–1 秒取帧及相邻帧复核，视觉审核精度约 ±0.5–0.75 秒；它不是同一瞬间双机拍摄的逐帧标定同步。',
    '正面保留 8.0–285.0 秒；背面保留 6.0–286.0 秒。开头的站立准备按首次起脚前的姿态对齐；片头、最终致意不作为 24 式。',
    '原速片段和独立姿态数据保留各自节奏；同步版本以正面为主，使用背面最近真实帧，姿态和视频取自同一个背面源帧。', '',
    '## 检查结果', '',
    '75 个输出视频已逐帧完整解码；两路全部关键点帧序、时间、数组长度和源/模型 SHA-256 已检查；24 式、全部小步骤的四档播放速度及桌面/手机浏览器检查通过。',
]
for view in ['front','back']:
    s=stats[view]
    lines.append(f'- {view} 动作区间：{s["routinePoseFrames"]}/{s["routineFrames"]} 帧检测到姿态（{s["routineDetectionRate"]:.2%}），{s["routineMissingFrames"]} 帧未检测，{s["routineInferenceErrors"]} 帧推理错误。检测到姿态不代表每个遮挡关节都可靠。')
lines+=['', '模型：@mediapipe/tasks-vision 1.1.1，Pose Landmarker Lite float16 v1，CPU；模型 SHA-256：'+manifest['modelSha256'], '',
        '全部输出剪辑为无声 H.264 / 30 fps，保留 640×360 原画幅；配对视频 1280×360。原视频字节未改动，`front-source.mp4` / `back-source.mp4` 是原文件的完整副本。', '',
        '复现脚本在项目 scripts/：inspect-dual-view.py、extract-dual-view-poses.mjs、prepare-dual-view.py、check-dual-view-browser.mjs、package-dual-view.py。审核证据在项目 artifacts/dual-view-review/。', '']
(DEST/'使用说明.md').write_text('\n'.join(lines),encoding='utf-8')
zip_path=DEST.parent/'正背面太极拳_分解与MediaPipe_20261016.zip'
files=sorted(p for p in DEST.rglob('*') if p.is_file())
with zipfile.ZipFile(zip_path,'w',allowZip64=True) as archive:
    for p in files:
        compression=zipfile.ZIP_STORED if p.suffix=='.mp4' else zipfile.ZIP_DEFLATED
        archive.write(p,p.relative_to(DEST),compress_type=compression,compresslevel=1 if compression==zipfile.ZIP_DEFLATED else None)
with zipfile.ZipFile(zip_path) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist())==len(files)
print(json.dumps({'zip':str(zip_path),'bytes':zip_path.stat().st_size,'files':len(files),'allZipEntriesPassCrc':True,'stats':stats},ensure_ascii=False),flush=True)
