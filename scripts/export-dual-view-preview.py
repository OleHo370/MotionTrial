"""Preview only completed form observations from immutable extraction chunks."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
REVIEW=ROOT/'artifacts/dual-view-review'
PUBLIC=ROOT/'public/practice-media/dual-view'
manifest=json.loads((PUBLIC/'manifest.json').read_text(encoding='utf-8'))
for view in ['front','back']:
    samples=[]
    for file in sorted((REVIEW/f'{view}.full.pose-chunks').glob('*.json')):
        chunk=json.loads(file.read_text(encoding='utf-8'))
        assert chunk['startFrame']==len(samples)
        samples.extend(chunk['samples'])
    for form in manifest['forms']:
        first,last=[round(form[view][x]*30) for x in ['startSeconds','endSeconds']]
        if len(samples)<last:break
        selected=samples[first:last]
        result={'schemaVersion':'dual-view-poses-v1','view':view,'formNumber':form['formNumber'],
                'sourceSha256':manifest['sources'][view]['sha256'],'modelSha256':manifest['modelSha256'],
                'sourceStartSeconds':first/30,'sourceEndSeconds':last/30,'startFrame':first,'endFrameExclusive':last,
                'fps':30,'width':640,'height':360,'statusCounts':{k:sum(s['status']==k for s in selected) for k in ['pose','no_pose','inference_error']},
                'provenance':'Actual completed source-frame observations from immutable inference checkpoints.','samples':selected}
        file=PUBLIC/f'{view}-{form["formNumber"]:02}.poses.json'
        file.write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf-8')
    print(view,len(samples),'actual completed source-frame observations available',flush=True)
