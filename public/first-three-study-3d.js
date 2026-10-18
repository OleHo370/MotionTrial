// Optional recorded-teacher preview. This module never reads the learner camera,
// runs inference, or changes lesson playback, matching, feedback, or hardware.
export const LESSON_3D_VERSION='five-clip-recorded-world-v1';
export const LESSON_3D_MODEL_SHA256='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const EPS=1e-4,MAXIMUM_SAMPLE_AGE_MS=100;
const STEP_IDS=new Set(['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05']);
const finiteFrame=value=>Number.isInteger(value)&&value>=0;
const anatomical=points=>Array.isArray(points)?points.filter(point=>Number.isInteger(point?.index)&&point.index>=0&&point.index<33):[];

export function validateLesson3DData(data,source,expectedSourceSha256){
  const video=source?.video;
  if(!video||data?.schemaVersion!=='first-three-study-3d-world-v1'
    ||!expectedSourceSha256||data.sourceSha256!==expectedSourceSha256
    ||data.sourceClipSha256!==video.sha256||data.modelSha256!==LESSON_3D_MODEL_SHA256
    ||data.width!==video.width||data.height!==video.height||data.fps!==video.fps
    ||!Array.isArray(data.samples)||!data.samples.length||!Number.isFinite(data.displayYawRadians))
    throw new Error('The recorded 3D observations do not match this teacher video.');
  let previous=-1,worldCount=0;
  for(const sample of data.samples){
    const frame=sample?.sourceFrameIndex;
    if(!finiteFrame(frame)||frame<=previous||frame>=video.frameCount
      ||sample.frameIndex!==frame||!Number.isFinite(sample.tMs)||!Number.isFinite(sample.sourceTimeSeconds)
      ||Math.abs(sample.tMs-frame*1000/video.fps)>1e-6
      ||Math.abs(sample.sourceTimeSeconds-(video.sourceStartSeconds??0)-frame/video.fps)>1e-6
      ||!['pose','no_pose','inference_error','intro'].includes(sample.status))
      throw new Error('The recorded 3D source-frame identities are invalid.');
    previous=frame;
    if(sample.status!=='pose'){
      if(anatomical(sample.landmarks).length||(sample.worldLandmarks?.length??0))
        throw new Error('An unavailable 3D observation contains retained landmarks.');
      continue;
    }
    for(const points of [anatomical(sample.landmarks),sample.worldLandmarks]){
      if(!Array.isArray(points)||points.length!==33
        ||points.some((point,index)=>point.index!==index||![point.x,point.y,point.z].every(Number.isFinite)
          ||(point.visibility!==undefined&&(!Number.isFinite(point.visibility)||point.visibility<0||point.visibility>1))
          ||(point.presence!==undefined&&point.presence!==null&&(!Number.isFinite(point.presence)||point.presence<0||point.presence>1))))
        throw new Error('This teacher recording does not contain valid archived 3D world landmarks.');
    }
    worldCount++;
  }
  if(!worldCount)throw new Error('This teacher recording does not contain archived 3D world landmarks.');
  return data;
}

// A video frame without its own archive entry may briefly display the preceding
// genuine observation. No future observation, gap bridging, or interpolation.
// The shared reference-end frame is permitted only at the held finish boundary.
export function selectLesson3DSample(data,step,source,time){
  const unavailable=reason=>({sample:null,frameIndex:null,sourceFrameIndex:null,sourceTimeSeconds:null,expectedSourceTime:time,reason});
  const video=source?.video,fps=video?.fps;
  if(!data?.samples?.length||!STEP_IDS.has(step?.id)||!(fps>0)||!Number.isFinite(time)
    ||step.sourceId!==undefined&&source?.id!==undefined&&step.sourceId!==source.id
    ||![step.sourceStartFrame,step.sourceEndFrameExclusive,step.referenceEndFrame].every(finiteFrame))
    return unavailable('selection_unavailable');
  const frame=Math.floor(time*fps+EPS);
  const first=step.sourceStartFrame,last=step.sourceEndFrameExclusive;
  const heldEnd=frame===step.referenceEndFrame
    &&Math.abs(time-step.referenceEndFrame/fps)<=1/fps+EPS;
  if(frame<first||(frame>=last&&!heldEnd)||frame>step.referenceEndFrame||frame>=video.frameCount)
    return unavailable('outside_selected_clip');
  const samples=data.samples;
  let low=0,high=samples.length;
  while(low<high){const middle=(low+high)>>1;if(samples[middle].sourceFrameIndex<=frame)low=middle+1;else high=middle;}
  const sample=samples[low-1];
  if(heldEnd&&sample?.sourceFrameIndex!==step.referenceEndFrame)
    return unavailable('finish_boundary_observation_unavailable');
  if(!sample||sample.sourceFrameIndex<first||sample.sourceFrameIndex>step.referenceEndFrame
    ||sample.sourceFrameIndex>=last&&!(heldEnd&&sample.sourceFrameIndex===step.referenceEndFrame))
    return unavailable('no_observation_in_selected_clip');
  const ageMs=time*1000-sample.tMs;
  if(ageMs<-.01||ageMs>MAXIMUM_SAMPLE_AGE_MS+.01)return unavailable('observation_too_old');
  return {sample,frameIndex:sample.frameIndex,sourceFrameIndex:sample.sourceFrameIndex,
    sourceTimeSeconds:sample.sourceTimeSeconds,expectedSourceTime:time,reason:null};
}

export function createLesson3DPreview({container,getContext,onState=()=>{}}={}){
  if(!container||typeof getContext!=='function')throw new Error('A teacher 3D preview needs a container and lesson context.');
  const cache=new Map();
  let visible=false,destroyed=false,revision=0,scene=null,modulePromise=null,sceneModule=null,loadKey=null,loadedData=null;
  let lastSignature=null,lastPublished=null;
  const status={version:LESSON_3D_VERSION,visible:false,loading:false,ready:false,error:null,
    stepId:null,sourceId:null,poseSrc:null,expectedSourceTime:null,sourceTimeSeconds:null,
    frameIndex:null,sourceFrameIndex:null,sampleStatus:null,reason:'hidden',drawnPoints:0,drawnBones:0,
    provenance:'Archived MediaPipe world landmarks from the corresponding teacher source frames. Estimated depth, not calibrated motion capture.',
    mirrored:false,scene:null};
  const snapshot=()=>({...status,scene:scene?.getDiagnostics()??null});
  function publish(force=false){
    const key=JSON.stringify({...status,scene:undefined});
    if(force||key!==lastPublished){lastPublished=key;onState(snapshot());}
  }
  function clearScene(reason){
    lastSignature=null;
    try{scene?.update({mode:'front',frontSample:null,backSample:null,showTrails:false,resetToken:`${revision}:${loadKey}`});}
    catch(error){status.error=error?.message||'3D rendering is unavailable.';status.ready=false;}
    Object.assign(status,{sourceTimeSeconds:null,frameIndex:null,sourceFrameIndex:null,sampleStatus:null,
      drawnPoints:0,drawnBones:0,reason});
  }
  function clearError(event){
    status.error=String(event?.detail||'3D rendering is unavailable.');status.ready=false;publish(true);
  }
  container.addEventListener('study3derror',clearError);
  function prepareScene(context){
    if(scene||!sceneModule||!loadedData)return;
    scene=sceneModule.createStudyScene(container,()=>{},{
      coordinateTransforms:{front:{yawRadians:loadedData.displayYawRadians,
        referenceFrames:loadedData.displayYawReferenceFrames??loadedData.displayYawProvenance?.referenceFrames??[],
        referenceSeconds:loadedData.displayYawReferenceSeconds??loadedData.displayYawProvenance?.referenceSeconds??[]}},
      mirrorFront:context.mirror!==false,
    });
    scene.setAutoRotate(false);scene.setView('front');scene.resize();
    const diagnostic=scene.getDiagnostics();
    if(!diagnostic.ready)throw new Error(diagnostic.error||'3D rendering is unavailable in this browser.');
  }
  async function loadData(context,key,token){
    const {source,expectedSourceSha256}=context,poseSrc=status.poseSrc;
    let promise=cache.get(key);
    if(!promise){
      promise=(async()=>{
        // Fetch a dedicated 3D archive when provided; the lesson's control-point
        // adapter and its matching references remain independent and unchanged.
        const response=await fetch(poseSrc);
        if(!response.ok)throw new Error('The recorded teacher 3D observations could not load.');
        return validateLesson3DData(await response.json(),source,expectedSourceSha256);
      })();
      cache.set(key,promise);
      promise.catch(()=>{if(cache.get(key)===promise)cache.delete(key);});
    }
    try{
      const data=await promise;
      if(destroyed||!visible||token!==revision||loadKey!==key)return;
      loadedData=data;status.loading=false;status.error=null;prepareScene(getContext()??{});update();
    }catch(error){
      if(destroyed||!visible||token!==revision||loadKey!==key)return;
      loadedData=null;status.loading=false;status.ready=false;status.error=error?.message||'Teacher 3D observations are unavailable.';
      clearScene('recording_unavailable');publish(true);
    }
  }
  function update(){
    if(destroyed||!visible)return;
    const context=getContext()??{},source=context.source,step=context.step;
    status.visible=true;status.stepId=step?.id??null;status.sourceId=source?.id??null;
    status.expectedSourceTime=Number.isFinite(context.currentTime)?context.currentTime:null;
    status.poseSrc=context.poseSrc??source?.study3dPoseSrc??'/practice-media/recut-six/master.study-3d.poses.json';
    // Reflect display x only, after the archive's recorded-stance rotation.
    // Anatomical identities, world coordinates, and matching remain unchanged.
    status.mirrored=context.mirror!==false;
    if(!STEP_IDS.has(step?.id)||!source||!status.poseSrc){clearScene('selection_unavailable');status.ready=false;publish();return;}
    const key=`${source.id}:${status.poseSrc}:${source.video?.sha256}:${context.expectedSourceSha256}`;
    if(key!==loadKey){
      scene?.dispose();scene=null;
      loadKey=key;loadedData=null;status.loading=true;status.error=null;status.ready=false;
      clearScene('loading_recording');
      void loadData(context,key,revision);
    }
    if(context.loading||context.seeking||context.readyState!==undefined&&context.readyState<2
      ||context.sourceId!==undefined&&context.sourceId!==step.sourceId){
      clearScene('teacher_frame_loading');publish();return;
    }
    if(!loadedData||!scene){publish();return;}
    const selected=selectLesson3DSample(loadedData,step,source,context.currentTime);
    const signature=`${step.id}:${selected.frameIndex??'-'}:${selected.reason??''}`;
    if(signature!==lastSignature){
      lastSignature=signature;
      try{scene.update({mode:'front',frontSample:selected.sample,backSample:null,showTrails:false,resetToken:step.id});}
      catch(error){status.error=error?.message||'3D rendering is unavailable.';status.ready=false;publish();return;}
    }
    const diagnostic=scene.getDiagnostics(),front=diagnostic.views?.front;
    Object.assign(status,{ready:diagnostic.ready&&!status.error,sourceTimeSeconds:selected.sourceTimeSeconds,
      frameIndex:selected.frameIndex,sourceFrameIndex:selected.sourceFrameIndex,
      sampleStatus:selected.sample?.status??null,reason:selected.reason??front?.reason??null,
      drawnPoints:front?.drawnPoints??0,drawnBones:front?.drawnBones??0});
    if(!diagnostic.ready)status.error=diagnostic.error||'3D rendering is unavailable in this browser.';
    publish();
  }
  async function show(){
    if(destroyed)return false;
    if(visible){update();return status.ready;}
    visible=true;status.visible=true;status.error=null;status.loading=true;status.reason='loading_scene';
    const token=++revision;publish(true);
    try{
      modulePromise??=import('./study-3d-scene.js');
      const module=await modulePromise;
      if(destroyed||!visible||token!==revision)return false;
      sceneModule=module;
      if(loadKey&&loadedData){status.loading=false;prepareScene(getContext()??{});}
      update();return true;
    }catch(error){
      if(destroyed||!visible||token!==revision)return false;
      status.loading=false;status.ready=false;status.error=error?.message||'The 3D renderer could not load.';publish(true);return false;
    }
  }
  function hide(){
    if(destroyed)return;
    visible=false;++revision;scene?.dispose();scene=null;lastSignature=null;
    // Discard an in-flight selection key so reopening cannot retain a stale
    // unresolved load. Successfully validated archives remain cached.
    if(!loadedData)loadKey=null;
    Object.assign(status,{visible:false,loading:false,ready:false,error:null,reason:'hidden',drawnPoints:0,drawnBones:0});publish(true);
  }
  function resetView(){if(!destroyed&&scene){scene.setView('front');scene.setAutoRotate(false);scene.resize();publish(true);}}
  function destroy(){
    if(destroyed)return;hide();destroyed=true;container.removeEventListener('study3derror',clearError);cache.clear();
  }
  return {show,hide,update,resetView,destroy,getState:snapshot};
}
