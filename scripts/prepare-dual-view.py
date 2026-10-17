"""Build visually reviewed paired forms, source-preserving clips and actual-pose replays.

Time mapping interpolates timestamps only. Every rendered pose is an actual
saved observation from that same view/frame; absent points remain absent.
"""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import gc
import shutil
from concurrent.futures import ProcessPoolExecutor
import av
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / 'artifacts' / 'dual-view-review'
PUBLIC = ROOT / 'public' / 'practice-media' / 'dual-view'
DELIVERY = ROOT.parents[1] / 'front_back_processed'
FPS = 30
CONNECTIONS = [(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),
               (23,25),(25,27),(24,26),(26,28),(27,29),(29,31),(27,31),(28,30),(30,32),(28,32),
               (15,17),(15,19),(15,21),(17,19),(16,18),(16,20),(16,22),(18,20)]

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'))+'\n',encoding='utf-8')

def digest(path):
    sha=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):
            sha.update(block)
    return sha.hexdigest()

def metadata():
    PUBLIC.mkdir(parents=True,exist_ok=True)
    DELIVERY.mkdir(parents=True,exist_ok=True)
    back=read(REVIEW/'back-boundaries.json')
    early=read(REVIEW/'front-early-phase-map.json')
    late=read(REVIEW/'front-late-phase-map.json')
    mapped={x['formNumber']:x for x in early+late}
    previous=read(ROOT/'public/practice-media/source-front-24-playlist.json')['clips']
    starts=[8.0]+[x['startSeconds'] for x in previous[1:]]
    for row in late:
        if 'startSeconds' in row: starts[row['formNumber']-1]=row['startSeconds']
    ends=starts[1:]+[late[-1].get('endSeconds',285.0)]
    sources={}
    for view in ['front','back']:
        p=read(REVIEW/f'{view}-source.json')
        sources[view]={**p,'src':f'/practice-media/dual-{view}-source.mp4',
                       'originalFile':f'{view}.mp4'}
        if digest(ROOT.parents[1]/f'{view}.mp4')!=p['sha256']:
            raise RuntimeError('Source changed after visual review')
    forms=[]
    csvrows=[]
    for b,old,start,end in zip(back,previous,starts,ends):
        n=b['formNumber']; f=mapped[n]
        anchors=[{'frontSeconds':start,'backSeconds':b['startSeconds'],'phaseKey':'form_start','label':'Begin '+old['title']}]
        assert len(f['phaseAnchors'])==len(b['phaseAnchors'])
        for fa,ba in zip(f['phaseAnchors'],b['phaseAnchors']):
            assert fa['phaseKey']==ba['phaseKey']
            ft,bt=fa['sourceSeconds'],ba['sourceSeconds']
            if abs(ft-end)<1e-6 and abs(bt-b['endSeconds'])<1e-6: continue
            assert start<ft<end,(n,fa,start,end)
            assert b['startSeconds']<bt<b['endSeconds'],(n,ba)
            anchors.append({'frontSeconds':ft,'backSeconds':bt,'phaseKey':ba['phaseKey'],'label':ba['description']})
        reviewed_anchors=anchors[1:].copy()
        # A visually reviewed phase 0.1s before a form cut does not justify a
        # separate teaching step or an abrupt fivefold local speed change.
        # Keep its review evidence, merge that tiny endpoint interval.
        anchors=[a for a in anchors if a['phaseKey']=='form_start' or
                 (end-a['frontSeconds']>=.3-1e-8 and b['endSeconds']-a['backSeconds']>=.3-1e-8)]
        anchors.append({'frontSeconds':end,'backSeconds':b['endSeconds'],'phaseKey':'form_end','label':'Complete '+old['title']})
        for a,z in zip(anchors,anchors[1:]):
            assert a['frontSeconds']<z['frontSeconds'] and a['backSeconds']<z['backSeconds'],n
        row={'id':f'dual-{n:02}','formNumber':n,'chineseTitle':old['chineseTitle'],'title':old['title'],
             'front':{'startSeconds':start,'endSeconds':end,'poseSrc':f'/practice-media/dual-view/front-{n:02}.poses.json'},
             'back':{'startSeconds':b['startSeconds'],'endSeconds':b['endSeconds'],'poseSrc':f'/practice-media/dual-view/back-{n:02}.poses.json'},
             'anchors':anchors,'reviewedPhaseAnchors':reviewed_anchors,'steps':[], 'entryEvidence':b['entryEvidence'],
             'alignmentUncertaintySeconds':max(.5,b.get('uncertaintySeconds',.5)),
             'alignmentMethod':'Visually paired semantic movement phases; piecewise linear timestamp mapping between reviewed anchors. Not calibrated simultaneous camera capture.'}
        for i,(a,z) in enumerate(zip(anchors,anchors[1:]),start=1):
            step={'id':f'dual-{n:02}-{i:02}','title':z['label'],
                  'front':{'startSeconds':a['frontSeconds'],'endSeconds':z['frontSeconds']},
                  'back':{'startSeconds':a['backSeconds'],'endSeconds':z['backSeconds']}}
            row['steps'].append(step)
            csvrows.append({'form':n,'chineseTitle':row['chineseTitle'],'step':i,'description':step['title'],
                            'frontStart':a['frontSeconds'],'frontEnd':z['frontSeconds'],
                            'backStart':a['backSeconds'],'backEnd':z['backSeconds']})
        forms.append(row)
    manifest={'schemaVersion':'dual-view-alignment-v1','sources':sources,'forms':forms,
              'provenance':'Two user-supplied recorded demonstrations independently processed with actual local MediaPipe Pose Landmarker Lite. All33 image and world landmarks retained; neither view borrows points from the other.',
              'alignmentPrecision':'Editorial semantic phases visually reviewed at 0.5–1 second intervals; approximately ±0.5–0.75 seconds, not frame-exact physical correspondence.',
              'renderingPolicy':'Front is the common playback timeline. Back uses reviewed phase mapping and nearest actual source frame; frames may repeat or be dropped. Original-speed clips and both independent observation streams are preserved.',
              'modelSha256':'59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'}
    write(PUBLIC/'manifest.json',manifest)
    write(DELIVERY/'alignment.json',manifest)
    with (DELIVERY/'动作对齐与分解.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(csvrows[0]));writer.writeheader();writer.writerows(csvrows)
    print(f'Metadata: {len(forms)} paired forms, {len(csvrows)} paired teaching phases',flush=True)
    return manifest

def export_poses(manifest):
    reports={}
    for view in ['front','back']:
        full=read(REVIEW/f'{view}.full.poses.json')
        assert full['complete'] and len(full['samples'])==manifest['sources'][view]['frames']
        assert full['sourceSha256']==manifest['sources'][view]['sha256']
        assert full['modelSha256']==manifest['modelSha256']
        for i,s in enumerate(full['samples']):
            assert s['frameIndex']==i and abs(s['sourceTimeSeconds']-i/FPS)<1e-8
            assert len(s['landmarks'])==(33 if s['status']=='pose' else 0)
            assert len(s['worldLandmarks'])==(33 if s['status']=='pose' else 0)
        active_counts={}
        for form in manifest['forms']:
            info=form[view]; n=form['formNumber']
            first,last=round(info['startSeconds']*FPS),round(info['endSeconds']*FPS)
            samples=full['samples'][first:last]
            counts={k:sum(s['status']==k for s in samples) for k in ['pose','no_pose','inference_error']}
            for k,v in counts.items():active_counts[k]=active_counts.get(k,0)+v
            data={'schemaVersion':'dual-view-poses-v1','view':view,'formNumber':n,
                  'sourceFile':f'{view}.mp4','sourceSha256':full['sourceSha256'],'modelSha256':full['modelSha256'],
                  'fps':FPS,'width':640,'height':360,'sourceStartSeconds':first/FPS,'sourceEndSeconds':last/FPS,
                  'startFrame':first,'endFrameExclusive':last,'timestampPolicy':'Source absolute timestamps; no interpolation or cross-view borrowing.',
                  'statusCounts':counts,'samples':samples}
            output=PUBLIC/f'{view}-{n:02}.poses.json';write(output,data)
            folder=DELIVERY/view;folder.mkdir(exist_ok=True)
            shutil.copyfile(output,folder/f'{n:02}_{form["chineseTitle"]}.poses.json')
        shutil.copyfile(REVIEW/f'{view}.full.poses.json',DELIVERY/f'{view}.full.poses.json')
        routine_first=round(manifest['forms'][0][view]['startSeconds']*FPS)
        routine_last=round(manifest['forms'][-1][view]['endSeconds']*FPS)
        routine_samples=full['samples'][routine_first:routine_last]
        joint_coverage=[]
        for index in range(33):
            points=[s['landmarks'][index] for s in routine_samples if s['status']=='pose']
            visible=sum(p['visibility']>=.45 and 0<=p['x']<=1 and 0<=p['y']<=1 for p in points)
            joint_coverage.append({'index':index,'visibilityThreshold':.45,'visibleInFrameCount':visible,
                                   'fractionOfAllRoutineFrames':visible/len(routine_samples),
                                   'meanVisibilityWhenPoseDetected':sum(p['visibility'] for p in points)/len(points) if points else None})
        reports[view]={'totalFrames':len(full['samples']),'allSourceStatuses':full['statusCounts'],
                       'routineStatuses':active_counts,'sourceSha256':full['sourceSha256'],
                       'jointCoverage':joint_coverage,'inferenceSessions':full['inferenceSessions']}
        print(f'{view}: verified and exported all33-point samples, {active_counts}',flush=True)
        del full,routine_samples,points,data,samples;gc.collect()
    write(REVIEW/'pose-integrity.json',reports)
    return reports

class Encoder:
    def __init__(self,path,width=640,height=360):
        path.parent.mkdir(parents=True,exist_ok=True)
        self.path=path;self.tmp=path.with_suffix('.preparing.mp4')
        self.output=av.open(str(self.tmp),'w',options={'movflags':'+faststart'})
        self.stream=self.output.add_stream('libx264',rate=FPS)
        self.width=width;self.height=height
        self.stream.width=width;self.stream.height=height;self.stream.pix_fmt='yuv420p'
        self.stream.thread_count=2
        self.stream.options={'crf':'20','preset':'fast'};self.count=0
    def add(self,bgr):
        frame=av.VideoFrame.from_ndarray(bgr,format='bgr24');frame.pts=self.count
        for packet in self.stream.encode(frame):self.output.mux(packet)
        self.count+=1
    def close(self):
        for packet in self.stream.encode():self.output.mux(packet)
        self.output.close();self.tmp.replace(self.path)
        cap=cv2.VideoCapture(str(self.path));count=0
        while cap.read()[0]:count+=1
        fps=cap.get(cv2.CAP_PROP_FPS)
        dimensions=(int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
        cap.release()
        assert count==self.count and fps==FPS and dimensions==(self.width,self.height),(self.path,count,self.count,fps,dimensions)
        return {'path':str(self.path),'frames':count,'fps':fps,'width':self.width,'height':self.height,'bytes':self.path.stat().st_size,'sha256':digest(self.path),'fullyDecoded':True}

def overlay(frame,sample,label):
    out=frame.copy();pts={p['index']:p for p in sample['landmarks'] if p['visibility']>=.45 and 0<=p['x']<=1 and 0<=p['y']<=1}
    color=(157,225,58) if label.startswith('FRONT') else (0,190,255)
    for a,b in CONNECTIONS:
        if a in pts and b in pts:
            cv2.line(out,(round(pts[a]['x']*640),round(pts[a]['y']*360)),(round(pts[b]['x']*640),round(pts[b]['y']*360)),color,2,cv2.LINE_AA)
    for i,p in pts.items():
        if i>=11:cv2.circle(out,(round(p['x']*640),round(p['y']*360)),2,color,-1,cv2.LINE_AA)
    cv2.rectangle(out,(0,0),(640,25),(32,27,20),-1)
    cv2.putText(out,label,(8,17),cv2.FONT_HERSHEY_SIMPLEX,.46,(255,255,255),1,cv2.LINE_AA)
    if sample['status']!='pose':cv2.putText(out,sample['status'],(470,17),cv2.FONT_HERSHEY_SIMPLEX,.4,(100,190,255),1,cv2.LINE_AA)
    return out

def render(manifest, selected=None):
    if selected is None:
        reports=[]
        with ProcessPoolExecutor(max_workers=3) as pool:
            jobs=[pool.submit(render,manifest,view) for view in ['front','back','aligned']]
            for job in jobs:reports.extend(job.result())
        for view in ['front','back']:
            assert digest(ROOT.parents[1]/f'{view}.mp4')==manifest['sources'][view]['sha256']
        write(REVIEW/'video-integrity.json',{'outputs':reports,'sourceHashesUnchanged':True,'allOutputsFullyDecoded':True})
        print(f'{len(reports)} videos encoded; all output frames fully decoded; originals unchanged',flush=True)
        return reports
    report=[]
    # Independent clips retain the exact original source speed/frame intervals.
    for view in ['front','back']:
        if view!=selected:continue
        cap=cv2.VideoCapture(str(ROOT.parents[1]/f'{view}.mp4'))
        total=Encoder(DELIVERY/f'{view}_mediapipe.mp4')
        for form in manifest['forms']:
            n=form['formNumber']; info=form[view]
            data=read(PUBLIC/f'{view}-{n:02}.poses.json')
            raw=Encoder(DELIVERY/view/f'{n:02}_{form["chineseTitle"]}.mp4')
            cap.set(cv2.CAP_PROP_POS_FRAMES,data['startFrame'])
            for sample in data['samples']:
                ok,frame=cap.read();assert ok
                raw.add(frame)
                total.add(overlay(frame,sample,f'{view.upper()} | {n:02} {form["title"]} | {sample["sourceTimeSeconds"]:.2f}s'))
            report.append(raw.close())
            print(f'{view} form{n:02}: original-speed clip encoded and fully decoded',flush=True)
        report.append(total.close());cap.release()
    if selected!='aligned':return report
    frontcap=cv2.VideoCapture(str(ROOT.parents[1]/'front.mp4'))
    backcap=cv2.VideoCapture(str(ROOT.parents[1]/'back.mp4'))
    together=Encoder(DELIVERY/'正背同步_MediaPipe_完整.mp4',1280,360)
    for form in manifest['forms']:
        n=form['formNumber'];f=read(PUBLIC/f'front-{n:02}.poses.json');b=read(PUBLIC/f'back-{n:02}.poses.json')
        encoder=Encoder(DELIVERY/'aligned'/f'{n:02}_{form["chineseTitle"]}_正背同步.mp4',1280,360)
        frontcap.set(cv2.CAP_PROP_POS_FRAMES,f['startFrame'])
        backcap.set(cv2.CAP_PROP_POS_FRAMES,b['startFrame'])
        previous_back=b['startFrame']-1;backframe=None
        fa=[a['frontSeconds'] for a in form['anchors']];ba=[a['backSeconds'] for a in form['anchors']]
        for sample in f['samples']:
            ok,frame=frontcap.read();assert ok
            bt=float(np.interp(sample['sourceTimeSeconds'],fa,ba))
            bi=min(b['endFrameExclusive']-1,max(b['startFrame'],round(bt*FPS)))
            assert bi>=previous_back
            while previous_back<bi:
                ok,backframe=backcap.read();assert ok;previous_back+=1
            fs=overlay(frame,sample,f'FRONT | {n:02} {form["title"]} | {sample["sourceTimeSeconds"]:.2f}s')
            bs=overlay(backframe,b['samples'][bi-b['startFrame']],f'BACK | aligned source {bi/FPS:.2f}s')
            combined=np.concatenate((fs,bs),axis=1)
            encoder.add(combined);together.add(combined)
        report.append(encoder.close())
        print(f'paired form{n:02}: anchor-aligned recorded-pose video fully decoded',flush=True)
    report.append(together.close());frontcap.release();backcap.release()
    return report

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata-only',action='store_true')
    parser.add_argument('--poses-only',action='store_true')
    args=parser.parse_args()
    manifest=metadata()
    if args.metadata_only:return
    export_poses(manifest)
    if not args.poses_only:render(manifest)

if __name__=='__main__':main()
