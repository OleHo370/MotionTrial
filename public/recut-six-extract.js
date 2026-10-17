import {createCenterPoseClient} from './first-three-pose-runtime.js';
const $=id=>document.getElementById(id),directory='/practice-media/recut-six/';
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const read=async src=>{const response=await fetch(src);if(!response.ok)throw Error(`Missing source: ${src}`);return response;};
let manifest,schedule;
try{
  [manifest,schedule]=await Promise.all(['manifest.json','schedule.json'].map(async name=>(await read(directory+name)).json()));
  $('run').disabled=false;$('status').textContent=`Ready: ${schedule.frames.length} exact source frames; one continuous inference session after the title card.`;
}catch(error){$('status').textContent=error.message;}
$('run').addEventListener('click',async()=>{
  $('run').disabled=true;$('download').hidden=true;
  let client;
  try{
    const source=manifest.sources[0],videoBytes=await (await read(source.video.src)).arrayBuffer();
    if(await digest(videoBytes)!==source.video.sha256)throw Error('Served master checksum differs from the cut manifest.');
    const modelBytes=await (await read('/models/pose_landmarker_lite.task')).arrayBuffer();
    const modelSha256=await digest(modelBytes);
    $('status').textContent='Starting local recorded-teacher MediaPipe…';
    client=await createCenterPoseClient();
    const canvas=$('frame'),context=canvas.getContext('2d'),samples=[];
    const firstPracticeFrame=manifest.steps[0].referenceStartFrame;
    for(const [number,frame]of schedule.frames.entries()){
      const bytes=await (await read(frame.pngSrc)).arrayBuffer();
      if(await digest(bytes)!==frame.pngSha256)throw Error(`Source PNG changed at frame ${frame.frameIndex}.`);
      const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
      context.drawImage(bitmap,0,0);bitmap.close();
      const observation=frame.frameIndex<firstPracticeFrame?{status:'intro',landmarks:[]}:client.estimate(canvas,frame.tMs+1);
      samples.push({tMs:frame.tMs,sourceTimeSeconds:frame.sourceTimeSeconds,
        frameIndex:frame.frameIndex,sourceFrameIndex:frame.sourceFrameIndex,
        inputPngSha256:frame.pngSha256,inferenceTimestampMs:frame.frameIndex<firstPracticeFrame?null:frame.tMs+1,
        ...observation});
      $('progress').value=(number+1)/schedule.frames.length;
      $('status').textContent=`Recorded frame ${frame.frameIndex} · ${number+1} / ${schedule.frames.length}`;
      if(number%8===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    const statusCounts=samples.reduce((counts,s)=>(counts[s.status]=(counts[s.status]||0)+1,counts),{});
    const result={schemaVersion:'first-three-recorded-pose-v1',extractionVersion:'recut-six-exact-png-v1',
      view:'front',fps:source.video.fps,width:source.video.width,height:source.video.height,
      sampleRateHz:15,durationMs:source.video.durationSeconds*1000,
      sourceSha256:manifest.source.sha256,sourceClipSha256:source.video.sha256,
      sourceStartSeconds:0,sourceEndSeconds:source.video.durationSeconds,modelSha256,
      packageVersion:'1.1.1',modelOptions:{delegate:'CPU',runningMode:'VIDEO',model:'pose_landmarker_lite',numPoses:1,
        minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5},
      provenance:'Actual local MediaPipe Pose Landmarker Lite inference on SHA-256 verified lossless PNGs decoded directly from the original source at explicit frame indices. One continuous VIDEO session after the non-teaching title card. All 33 raw anatomical landmarks preserved. No generated, mirrored, interpolated or copied controls. Recorded teacher data, not live camera results.',
      samplingPolicy:'Exact source-frame IDs at 15 Hz plus every category boundary and the first/last practice frames. Title-card frames are explicitly intro/unassessed. Each original frame remains in the full 30 fps master and six partitioned clips.',
      frameIndexPrecision:'Exact decoder frame indices and per-input PNG SHA-256.',
      complete:true,completedAt:new Date().toISOString(),statusCounts,samples};
    const url=URL.createObjectURL(new Blob([JSON.stringify(result)+'\n'],{type:'application/json'}));
    $('download').href=url;$('download').hidden=false;
    $('status').textContent=`Complete · ${samples.length} recorded frames processed.`;
    $('summary').textContent=JSON.stringify({statusCounts,modelSha256,firstPracticeFrame,
      sourceFrames:manifest.sourceFrames??manifest.source.sourceFrames,provenance:'Real recorded teacher inference, not human practice acceptance.'},null,2);
  }catch(error){$('status').textContent=`Extraction failed: ${error.message}`;$('run').disabled=false;}
  finally{client?.close();}
});
