"""Vendor only the pinned Three.js files needed by the standalone 3D study page."""
from pathlib import Path
import hashlib
import json
import tarfile

ROOT=Path(__file__).resolve().parents[1]
PACKAGE=ROOT/'artifacts/study-3d/vendor/three-0.180.0.tgz'
OUT=ROOT/'public/vendor/study-3d'
assert hashlib.sha1(PACKAGE.read_bytes()).hexdigest()=='b930cabfb524f6d36bf63e874b4d866888b50487'
OUT.mkdir(parents=True,exist_ok=True)
mapping={'package/build/three.module.js':'three.module.js','package/build/three.core.js':'three.core.js',
         'package/examples/jsm/controls/OrbitControls.js':'OrbitControls.js','package/LICENSE':'LICENSE'}
assets=[]
with tarfile.open(PACKAGE,'r:gz') as archive:
    assert json.load(archive.extractfile('package/package.json'))['version']=='0.180.0'
    for member,destination in mapping.items():
        data=archive.extractfile(member).read()
        original=hashlib.sha256(data).hexdigest()
        if destination=='OrbitControls.js':
            data=data.replace(b"from 'three';",b"from './three.module.js';")
            assert b"from 'three';" not in data
        (OUT/destination).write_bytes(data)
        assets.append({'path':'/vendor/study-3d/'+destination,'bytes':len(data),
                       'sha256':hashlib.sha256(data).hexdigest(),'originalSha256':original})
(OUT/'manifest.json').write_text(json.dumps({'package':'three','version':'0.180.0',
    'registryTarballSha1':'b930cabfb524f6d36bf63e874b4d866888b50487','registryTarballSha256':hashlib.sha256(PACKAGE.read_bytes()).hexdigest(),
    'modification':'Only OrbitControls bare three import is changed to the sibling local module.',
    'assets':assets},indent=2)+'\n',encoding='utf-8')
preserved=['public/dual-view.html','scripts/serve-dual-view.mjs','package.json','package-lock.json',
           'public/practice-media/dual-view/manifest.json','public/models/pose_landmarker_lite.task']
(ROOT/'artifacts/study-3d/preserved-files.json').write_text(json.dumps({str(p):hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in preserved},indent=2)+'\n',encoding='utf-8')
print('Pinned Three.js 0.180.0 local modules ready; existing app manifests and paired page untouched.')
