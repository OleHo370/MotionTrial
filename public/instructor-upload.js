import {loadRecordedVideo,extractRecordedVideoPoses,RECORDED_VIDEO_LIMITS} from './recorded-video-input.js';
import {buildUploadedLesson} from './uploaded-lesson-reference.js';

/** Prepare a local instructor file. No source frames or landmarks are uploaded. */
export function attachInstructorUpload({button,onBusy=()=>{},onApply,onRestore}={}){
  if(!button||typeof onApply!=='function')throw new Error('An instructor upload needs a button and lesson controller.');
  const style=document.createElement('style');
  style.textContent=`
    #instructor-upload-dialog{box-sizing:border-box;width:min(920px,calc(100vw - 28px));max-height:calc(100dvh - 30px);overflow:auto;border:1px solid #bbc9bd;border-radius:10px;padding:0;background:#f7f8f5;color:#1e352b;font:14px/1.5 'Segoe UI',Arial,sans-serif}
    #instructor-upload-dialog::backdrop{background:#10251dc9}#instructor-upload-dialog *{box-sizing:border-box}
    #instructor-upload-dialog .upload-body{padding:24px 28px}#instructor-upload-dialog h2{font:400 36px/1.05 'Qi Instrument Serif',Georgia,serif;margin:0 0 10px}
    #instructor-upload-dialog h3{font-size:15px;margin:18px 0 8px}#instructor-upload-dialog p{margin:8px 0;color:#536459}
    #instructor-upload-dialog .upload-head{display:flex;align-items:start;justify-content:space-between;gap:16px}
    #instructor-upload-dialog button,#instructor-upload-dialog input,#instructor-upload-dialog select{font:inherit;min-height:40px;border:1px solid #becdbf;border-radius:5px;padding:7px 10px;color:#1e352b;background:#fff;max-width:100%}
    #instructor-upload-dialog button{cursor:pointer}#instructor-upload-dialog button:disabled{opacity:.5;cursor:default}
    #instructor-upload-dialog .upload-primary{background:#2a5e48;color:white;border-color:#2a5e48}#instructor-upload-dialog label{display:block;font-weight:600}
    #instructor-upload-dialog input[type=file]{width:100%;padding:16px;background:#eef3eb;border-style:dashed;margin:8px 0}
    #instructor-upload-dialog video{display:block;width:100%;height:230px;object-fit:contain;background:#172820;margin:10px 0}
    #instructor-upload-dialog .upload-tools,#instructor-upload-dialog .upload-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
    #instructor-upload-dialog .upload-tools label{font-weight:400}#instructor-upload-dialog .upload-actions{position:sticky;bottom:0;background:#f7f8f5;padding:14px 0 0;border-top:1px solid #ccd6c8}
    #instructor-upload-dialog .upload-ranges{display:grid;gap:9px;margin:12px 0}#instructor-upload-dialog .upload-range{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:9px;align-items:end;padding:10px 0;border-top:1px solid #d8e1d5}
    #instructor-upload-dialog .upload-range label{font-weight:400;font-size:12px}#instructor-upload-dialog .upload-range input{width:100%;min-width:0}#instructor-upload-dialog .upload-range button{min-height:28px;padding:3px 5px;margin-top:4px;font-size:11px}
    #instructor-upload-dialog progress{width:100%;height:12px;accent-color:#2a5e48}#instructor-upload-status{white-space:pre-line}#instructor-upload-error{color:#973e2c!important;white-space:pre-line}
    #instructor-upload-dialog [hidden]{display:none!important}#instructor-upload-dialog .upload-quality{padding-left:22px;color:#536459}
    @media(max-width:600px){#instructor-upload-dialog .upload-body{padding:18px}#instructor-upload-dialog h2{font-size:30px}#instructor-upload-dialog video{height:180px}#instructor-upload-dialog .upload-range{grid-template-columns:1fr 1fr}#instructor-upload-dialog .upload-range label:first-child{grid-column:1/-1}#instructor-upload-dialog .upload-actions button{flex:1 1 auto;font-size:12px}}
  `;
  document.head.append(style);
  const dialog=document.createElement('dialog');dialog.id='instructor-upload-dialog';dialog.setAttribute('aria-labelledby','instructor-upload-title');
  dialog.innerHTML=`<div class="upload-body"><div class="upload-head"><div><h2 id="instructor-upload-title">Create your own Tai Chi lesson</h2><p>Upload an instructor video, choose its teaching steps, then practise live with the same movement guides and Factory wellness review.</p></div><button type="button" id="instructor-upload-close" aria-label="Close instructor upload">Close</button></div>
    <label for="instructor-video-file">Instructor video</label><input id="instructor-video-file" type="file" accept="video/*,.mp4,.webm,.mov,.m4v">
    <p>MP4 or WebM recommended. Up to 500 MB and 10 minutes. Keep one instructor’s full body visible. Your file stays in this browser and is cleared when you reload.</p>
    <p id="instructor-upload-error" role="alert" hidden></p>
    <section id="instructor-upload-editor" hidden><video id="instructor-upload-preview" controls muted playsinline preload="auto" aria-label="Your instructor video preview"></video><p id="instructor-upload-file-info"></p>
    <div class="upload-tools"><label for="instructor-upload-count">Teaching steps</label><select id="instructor-upload-count" aria-label="Number of uploaded teaching steps"><option value="1">1 step</option><option value="2">2 steps</option><option value="3">3 steps</option><option value="4">4 steps</option><option value="5" selected>5 steps</option></select><button type="button" id="instructor-upload-split">Reset suggested boundaries</button></div>
    <p>Suggested boundaries divide the video evenly. Adjust them to natural movement transitions. Scrub the preview and use its current time to set each boundary.</p><div id="instructor-upload-ranges" class="upload-ranges"></div>
    <p>Use a front-facing view with visible hands, shoulders, hips and feet. Unclear source targets remain unassessed.</p></section>
    <div id="instructor-upload-progress-wrap" hidden><progress id="instructor-upload-progress" max="100" value="0" aria-label="Instructor pose analysis"></progress></div>
    <p id="instructor-upload-status" role="status">Choose a video to begin. Camera access is not needed to prepare the lesson.</p><ol id="instructor-upload-quality" class="upload-quality" hidden></ol>
    <div class="upload-actions"><button type="button" id="instructor-upload-analyze" class="upload-primary" disabled>Analyze instructor video</button><button type="button" id="instructor-upload-use" class="upload-primary" hidden>Use this lesson</button><button type="button" id="instructor-upload-cancel" hidden>Cancel analysis</button><button type="button" id="instructor-upload-restore">Use built-in lesson</button></div></div>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector(`#${id}`),preview=$('instructor-upload-preview');
  let selection=null,active=null,file=null,analysis=null,prepared=null,revision=0,controller=null,busy=false,busyMode=null,closed=false;
  const status=t=>{$('instructor-upload-status').textContent=t;};
  const error=t=>{$('instructor-upload-error').textContent=t||'';$('instructor-upload-error').hidden=!t;};
  function setBusy(value,mode='analysis'){
    busy=value;busyMode=value?mode:null;onBusy(value);
    for(const id of ['instructor-video-file','instructor-upload-count','instructor-upload-split','instructor-upload-restore'])$(id).disabled=value;
    $('instructor-upload-analyze').disabled=value||!selection;
    $('instructor-upload-use').disabled=value;
    $('instructor-upload-cancel').hidden=!value||mode!=='analysis';
    $('instructor-upload-close').disabled=value&&mode!=='analysis';
    preview.controls=!value;
    for(const input of $('instructor-upload-ranges').querySelectorAll('input,button'))input.disabled=value;
  }
  function invalidate(){prepared=null;$('instructor-upload-use').hidden=true;$('instructor-upload-quality').hidden=true;}
  function cancel(){if(busy&&busyMode!=='analysis')return;++revision;controller?.abort();controller=null;if(busy){setBusy(false);status('Analysis cancelled. Your existing lesson is still available.');}}
  function renderRanges(){
    if(!selection)return;
    invalidate();const count=Number($('instructor-upload-count').value),duration=selection.duration;
    $('instructor-upload-ranges').replaceChildren(...Array.from({length:count},(_,i)=>{
      const row=document.createElement('div');row.className='upload-range';
      for(const kind of ['title','startSeconds','endSeconds']){
        const label=document.createElement('label');label.textContent=kind==='title'?`Step ${i+1} title`:kind==='startSeconds'?'Start (seconds)':'Finish (seconds)';
        const input=document.createElement('input');input.dataset.field=kind;input.setAttribute('aria-label',`Step ${i+1} ${label.textContent}`);
        input.type=kind==='title'?'text':'number';
        if(kind==='title'){input.maxLength=80;input.value=`Movement ${i+1}`;}
        else{input.min='0';input.max=String(duration);input.step='0.01';input.value=(kind==='startSeconds'?duration*i/count:duration*(i+1)/count).toFixed(2);}
        input.addEventListener('input',invalidate);label.append(input);
        if(kind!=='title'){
          const use=document.createElement('button');use.type='button';use.textContent='Use preview time';
          use.addEventListener('click',()=>{input.value=preview.currentTime.toFixed(2);invalidate();});label.append(use);
        }
        row.append(label);
      }
      return row;
    }));
  }
  function ranges(){
    let previous=0;
    return [...$('instructor-upload-ranges').children].map((row,i)=>{
      const get=key=>row.querySelector(`[data-field="${key}"]`).value;
      const startSeconds=Number(get('startSeconds')),endSeconds=Number(get('endSeconds')),title=get('title').trim()||`Movement ${i+1}`;
      if(!Number.isFinite(startSeconds)||!Number.isFinite(endSeconds)||startSeconds<0||endSeconds-startSeconds<.6||endSeconds>selection.duration+.02||i&&startSeconds<previous-.001)
        throw new Error(`Step ${i+1}: choose an ordered, non-overlapping range of at least 0.6 seconds inside the video.`);
      previous=endSeconds;return {startSeconds,endSeconds:Math.min(endSeconds,selection.duration),title};
    });
  }
  async function selected(){
    cancel();invalidate();analysis=null;error('');file=$('instructor-video-file').files?.[0]??null;
    if(!file)return;
    if(selection&&selection!==active)selection.dispose();selection=null;
    const token=++revision;controller=new AbortController();status('Opening your instructor video…');
    try{
      const lease=await loadRecordedVideo(preview,file,{signal:controller.signal});
      if(token!==revision||closed){lease.dispose();return;}
      selection=lease;$('instructor-upload-editor').hidden=false;$('instructor-upload-analyze').disabled=false;
      $('instructor-upload-file-info').textContent=`${file.name} · ${lease.width} × ${lease.height} · ${lease.duration.toFixed(2)} seconds`;
      // Avoid very short automatic windows while preserving the user's ability to choose 1–5 steps.
      $('instructor-upload-count').value=String(Math.min(5,Math.max(1,Math.floor(lease.duration))));renderRanges();
      status('Choose the movement boundaries, then analyze the actual instructor frames locally.');
    }catch(e){if(token===revision){error(e.message);status('The video could not load. Choose another file.');$('instructor-upload-editor').hidden=true;$('instructor-upload-analyze').disabled=true;}}
  }
  async function analyze(){
    if(!selection||busy)return;
    error('');let selectedRanges;try{selectedRanges=ranges();}catch(e){error(e.message);return;}
    const token=++revision;controller=new AbortController();const signal=controller.signal;
    invalidate();setBusy(true);$('instructor-upload-progress-wrap').hidden=false;$('instructor-upload-progress').value=0;
    try{
      if(!analysis){
        status('Loading the local pose model. This can take a moment…');
        const result=await extractRecordedVideoPoses(preview,{signal,onProgress(progress){
          if(token!==revision)return;$('instructor-upload-progress').value=progress.percent;
          status(`Analyzing instructor frames: ${Math.round(progress.percent)}% (${progress.completed} / ${progress.total}). Keep this tab open.`);
        }});
        if(token!==revision)return;
        status('Checking the video identity and preparing movement targets…');
        const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
        if(token!==revision||signal.aborted)return;
        const sha256=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
        analysis={...result,sha256};
      }
      prepared=buildUploadedLesson({samples:analysis.samples,width:selection.width,height:selection.height,
        durationSeconds:selection.duration,videoUrl:selection.url,sourceSha256:analysis.sha256,fileName:file.name,ranges:selectedRanges});
      const quality=$('instructor-upload-quality');let usable=0;
      quality.replaceChildren(...prepared.manifest.steps.map((step,i)=>{
        const li=document.createElement('li');const ready=prepared.guidanceRefs[i]?.referenceUsable&&prepared.pathRefs[i]?.referenceUsable;
        if(ready)usable++;
        li.textContent=`${step.title}: ${ready?'ready for live practice':prepared.guidanceRefs[i]?.unknownReason||prepared.pathRefs[i]?.unknownReason||'source targets unclear; demonstration only'}`;return li;
      }));quality.hidden=false;
      $('instructor-upload-use').hidden=!usable;
      status(usable?`${usable} of ${selectedRanges.length} steps have supported practice targets. Use this lesson to start live practice and Factory review.`:'No reliable practice targets were found. Trim title cards or choose clearer starting and finishing poses, then analyze again.');
      $('instructor-upload-progress').value=100;
    }catch(e){if(token===revision&&e.name!=='AbortError'){error(e.message);status('Your existing lesson is preserved. Adjust the video or its ranges and try again.');}}
    finally{if(token===revision)setBusy(false);}
  }
  async function apply(){
    if(!prepared||busy)return;error('');setBusy(true,'install');
    try{
      await onApply(prepared);
      if(active&&active!==selection)active.dispose();active=selection;
      button.textContent='Change video';button.title=`Instructor: ${file.name}`;
      status('Your instructor lesson is active. Choose Start practice.');dialog.close();
    }catch(e){error(e.message);}
    finally{setBusy(false);}
  }
  button.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();});
  $('instructor-upload-close').addEventListener('click',()=>{cancel();dialog.close();});
  dialog.addEventListener('cancel',event=>{if(busy&&busyMode!=='analysis')event.preventDefault();else cancel();});
  $('instructor-video-file').addEventListener('change',()=>void selected());
  $('instructor-upload-count').addEventListener('change',renderRanges);$('instructor-upload-split').addEventListener('click',renderRanges);
  $('instructor-upload-analyze').addEventListener('click',()=>void analyze());$('instructor-upload-cancel').addEventListener('click',cancel);
  $('instructor-upload-use').addEventListener('click',()=>void apply());
  $('instructor-upload-restore').addEventListener('click',async()=>{
    cancel();error('');setBusy(true,'install');
    try{await onRestore?.();if(active){if(selection===active){selection=null;file=null;analysis=null;invalidate();$('instructor-video-file').value='';$('instructor-upload-editor').hidden=true;}active.dispose();active=null;}button.textContent='Upload video';button.title='Create a lesson from your own instructor video';status('The built-in lesson is active.');dialog.close();}
    catch(e){error(e.message);}finally{setBusy(false);}
  });
  return {destroy(){closed=true;cancel();if(selection&&selection!==active)selection.dispose();active?.dispose();dialog.remove();style.remove();},
    getState:()=>({busy,prepared:!!prepared,active:!!active,fileName:file?.name??null,duration:selection?.duration??null,sampleCount:analysis?.samples.length??0,limitSeconds:RECORDED_VIDEO_LIMITS.maxDurationSeconds})};
}
