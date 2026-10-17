/**
 * Deterministic display-filter controls use explicitly SYNTHETIC movement/jitter,
 * plus a separately identified genuine saved observation replay. These tests do
 * not measure MediaPipe accuracy or physical webcam performance.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createDisplaySmoother} from '../public/practice-display-smoothing.js';
import {withPracticeCenters} from '../public/practice-centers.js';

const indices=[33,34,35,36],checks=[],metrics={};
const options={aspect:1.25,contextKey:'synthetic-camera-1'};
const sample=(tMs,x=.4,y=.6)=>({tMs,status:'pose',provenance:'explicitly synthetic test landmarks',landmarks:[
  {index:0,x:.5,y:.1,z:0,visibility:.9,presence:.95},
  ...indices.map((index,i)=>({index,x:x+i*.025,y:y+i*.02,z:i*.01,visibility:.9,presence:.95,
    sourceIndices:index<35?[15,17,19]:[29,31]})),
]});
const point=(s,index=33)=>s.landmarks.find(p=>p.index===index);
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))deepFreeze(v);}return value;};
const variance=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;return values.reduce((s,x)=>s+(x-mean)**2,0)/values.length;};
const equalCoordinates=(a,b)=>{assert.equal(a.x,b.x);assert.equal(a.y,b.y);};

{
  const filter=createDisplaySmoother(),raw=deepFreeze(sample(100)),before=JSON.stringify(raw);
  const shown=filter.update(raw,options);
  assert.notEqual(shown,raw);assert.notEqual(shown.landmarks,raw.landmarks);
  assert.deepEqual(shown,raw);assert.equal(JSON.stringify(raw),before);
  const next=deepFreeze(sample(166,.42,.62)),nextBefore=JSON.stringify(next),display=filter.update(next,options);
  assert.equal(JSON.stringify(next),nextBefore);assert.ok(point(display).x>.4&&point(display).x<.42);
  for(const rawPoint of next.landmarks){
    const displayed=point(display,rawPoint.index);
    assert.deepEqual(Object.fromEntries(Object.entries(displayed).filter(([key])=>!['x','y'].includes(key))),
      Object.fromEntries(Object.entries(rawPoint).filter(([key])=>!['x','y'].includes(key))));
    if(!indices.includes(rawPoint.index))assert.deepEqual(displayed,rawPoint);
  }
  assert.equal(typeof filter.version,'string');
  checks.push('Display samples are cloned; frozen raw samples, unselected SDK joints, source identities, confidence, depth, and provenance are unchanged. Only selected x/y values are filtered.');
}

{
  const filter=createDisplaySmoother(),rawValues=new Map(indices.map(i=>[i,[]])),shownValues=new Map(indices.map(i=>[i,[]]));
  for(let frame=0;frame<240;frame++){
    const raw=sample(frame*1000/15);
    for(const p of raw.landmarks.filter(p=>indices.includes(p.index))){
      const offset=p.index-33;
      p.y+=.012*Math.sin(frame*2.43+offset)+.006*Math.sin(frame*1.7+offset*.7);
      p.x+=.009*Math.sin(frame*2.1+offset);
    }
    const shown=filter.update(raw,options);
    if(frame>=30)for(const index of indices){rawValues.get(index).push(point(raw,index).y);shownValues.get(index).push(point(shown,index).y);}
  }
  metrics.stationaryJitter=indices.map(index=>{
    const rawVariance=variance(rawValues.get(index)),displayVariance=variance(shownValues.get(index)),ratio=displayVariance/rawVariance;
    assert.ok(ratio<.65,`Synthetic stationary variance reduction for ${index}: ${ratio}`);
    return {index,rawVariance,displayVariance,varianceRatio:ratio,reductionPercent:100*(1-ratio)};
  });
  checks.push('At a synthetic 15 Hz camera rate, all four controls reduce deterministic stationary vertical jitter variance by at least 35%; the report records measured variance rather than claiming physical-camera accuracy.');
}

{
  const filter=createDisplaySmoother(),speed=.5/.8,lags=[];
  let shown;
  for(let frame=0;frame<=60;frame++){
    const time=frame*1000/30,rawX=.2+Math.min(.5,Math.max(0,(time-200)/1000*speed));
    shown=filter.update(sample(time,rawX),options);
    if(time>=300&&time<=1000)lags.push(Math.abs(rawX-point(shown).x)/speed*1000);
    assert.ok(point(shown).x>=.2-1e-9&&point(shown).x<=.7+1e-9,'No overshoot or fabricated extension');
  }
  const maximumLagMs=Math.max(...lags);
  assert.ok(maximumLagMs<120,`Intentional fast movement stays responsive: ${maximumLagMs}ms`);
  assert.ok(Math.abs(point(shown).x-.7)<.002,'The full movement destination remains reachable');
  metrics.fastSyntheticRamp={speedNormalizedUnitsPerSecond:speed,maximumLagMs,finalX:point(shown).x,expectedEndX:.7};
  checks.push('A synthetic 0.5-width intentional arm movement over 0.8 seconds has less than 120 ms maximum equivalent lag, no overshoot, and converges to its complete destination.');
}

{
  const filter=createDisplaySmoother();filter.update(sample(0),options);filter.update(sample(66,.43),options);
  const missing=sample(132,.46);missing.landmarks=missing.landmarks.filter(p=>p.index!==33);
  assert.equal(point(filter.update(missing,options)),undefined,'Missing controls are never held or invented');
  const recovered=sample(198,.8),display=filter.update(recovered,options);
  equalCoordinates(point(display),point(recovered));
  assert.ok(point(display,34).x<point(recovered,34).x,'Other limbs retain their independent filter history');
  const low=sample(264,.2);point(low).visibility=.1;
  assert.deepEqual(point(filter.update(low,options)),point(low),'Low-confidence observations are not upgraded or silently held');
  const afterLow=sample(330,.75);equalCoordinates(point(filter.update(afterLow,options)),point(afterLow));
  const lowPresence=sample(396,.3);point(lowPresence).presence=.1;
  assert.deepEqual(point(filter.update(lowPresence,options)),point(lowPresence));
  const afterPresence=sample(462,.7);equalCoordinates(point(filter.update(afterPresence,options)),point(afterPresence));
  checks.push('A missing, low-visibility, or low-presence point immediately loses its display history; it is never fabricated and recovers at its first valid position while the other controls continue independently.');
}

{
  const resetCases=[
    ['seek to an earlier timestamp',{...options},20],
    ['gap beyond 300 ms',{...options},700],
    ['changed clip/camera context',{...options,contextKey:'different-clip'},200],
    ['changed video aspect',{...options,aspect:.75},200],
  ];
  for(const [label,nextOptions,nextTime]of resetCases){
    const filter=createDisplaySmoother();filter.update(sample(100,.2),options);filter.update(sample(166,.21),options);
    const raw=sample(nextTime,.8);equalCoordinates(point(filter.update(raw,nextOptions)),point(raw));
  }
  const filter=createDisplaySmoother();filter.update(sample(0,.2),options);
  const current=sample(66,.3),shown=filter.update(current,options);
  assert.deepEqual(filter.update(current,options),shown,'Repeated rendering of the same timestamp never advances smoothing');
  filter.update({tMs:132,status:'no_pose',landmarks:[]},options);
  let fresh=sample(198,.8);equalCoordinates(point(filter.update(fresh,options)),point(fresh));
  filter.reset();fresh=sample(264,.1);equalCoordinates(point(filter.update(fresh,options)),point(fresh));
  assert.equal(filter.update(null,options),null);
  fresh=sample(330,.9);equalCoordinates(point(filter.update(fresh,options)),point(fresh));
  checks.push('Backward seeks, large timestamp gaps, clip/camera context changes, aspect changes, no-pose, explicit reset, and null observations restart display history. Same-timestamp redraws do not accumulate artificial motion.');
}

{
  const plain=createDisplaySmoother(),mirrored=createDisplaySmoother();
  for(let frame=0;frame<30;frame++){
    const raw=sample(frame*1000/15,.3+frame*.006),before=structuredClone(raw);
    const shown=plain.update(raw,options),shownForMirror=mirrored.update(raw,options);
    assert.deepEqual(shown,shownForMirror);assert.deepEqual(raw,before);
    for(const p of shown.landmarks){
      const cssMirroredX=1-p.x;
      assert.ok(Math.abs(1-cssMirroredX-p.x)<1e-12);
      assert.equal(point(raw,p.index).index,p.index,'Anatomical identities remain intact');
    }
  }
  checks.push('Presentation mirroring is outside the filter: identical raw observations yield identical computation values and identities, with mirroring only applied to the displayed coordinate.');
}

{
  const overrideFilter=createDisplaySmoother(),clockFilter=createDisplaySmoother();
  for(let frame=0;frame<30;frame++){
    const raw=sample(frame*1000/15,.3+frame*.006),wallClock=raw.tMs/.5;
    const shown=overrideFilter.update(raw,{...options,timestampMs:wallClock});
    const clockShown=clockFilter.update({...raw,tMs:wallClock},options);
    assert.deepEqual(shown.landmarks,clockShown.landmarks);
    assert.equal(shown.tMs,raw.tMs,'Slow-playback wall-clock filtering does not alter observation timestamps');
  }
  checks.push('The optional display timestamp override follows wall-clock time during half-speed playback without rewriting saved observation timestamps or calculation values.');
}

{
  const archive=JSON.parse(await readFile(new URL('../public/practice-media/recut-six/master.poses.json',import.meta.url),'utf8'));
  const before=JSON.stringify(archive),filter=createDisplaySmoother({minimumVisibility:.65});
  let observations=0,observedControlPoints=0,displayedControlPoints=0;
  for(const raw of archive.samples){
    const adapted=deepFreeze(withPracticeCenters(raw)),snapshot=JSON.stringify(adapted);
    const shown=filter.update(adapted,{aspect:archive.width/archive.height,contextKey:'genuine-saved-teacher'});
    observations++;assert.equal(JSON.stringify(adapted),snapshot);
    assert.deepEqual(shown.landmarks.filter(p=>p.index<33),adapted.landmarks.filter(p=>p.index<33));
    for(const p of adapted.landmarks.filter(p=>indices.includes(p.index))){
      observedControlPoints++;
      const q=point(shown,p.index);assert.ok(q);assert.equal(q.visibility,p.visibility);
      if(p.visibility>=.65&&(p.presence===undefined||p.presence>=.65)){
        assert.ok(Number.isFinite(q.x)&&Number.isFinite(q.y));displayedControlPoints++;
      }else assert.deepEqual(q,p);
    }
  }
  assert.equal(JSON.stringify(archive),before);
  metrics.genuineSavedTeacher={archive:'public/practice-media/recut-six/master.poses.json',observations,observedControlPoints,displayedControlPoints,
    interpretation:'Real saved MediaPipe observations exercise the display filter and retain raw input values. No held posture or physical tracking accuracy is inferred from these frames.'};
  checks.push('The genuine saved teacher observation sequence runs through the presentation filter with all raw SDK observations, confidence and archive contents preserved; no missing point is fabricated.');
}

const report={passed:true,checkGroups:checks.length,version:createDisplaySmoother().version,
  provenance:'Synthetic deterministic filter/lifecycle controls and genuine saved teacher observation replay. No real webcam, live inference, or human movement accuracy acceptance is claimed.',checks,metrics,
  limitations:['Real webcam jitter, lighting, occlusion, camera latency and perceived responsiveness still require human follow-along testing.','Display smoothing does not change the raw observations or post-attempt feedback inputs.']};
await mkdir(new URL('../artifacts/display-smoothing-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/display-smoothing-review/filter-summary.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
