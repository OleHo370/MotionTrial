// Local browser speech for an already-computed practice review. This module
// never assesses movement, changes a result, or sends feedback to a service.
const VOICE_WAIT_MS=1000,MAXIMUM_SPEECH_MS=18000;
const clean=text=>typeof text==='string'?text.replace(/\s+/g,' ').trim():'';
const sentence=text=>/[.!?]$/.test(text)?text:`${text}.`;

function reviewText(result){
  if(result?.feedbackStyle==='compact')return (result.messages??[]).map(clean).filter(Boolean).join(' ');
  const status=result?.status;
  const outcome=status==='match'?'Close enough':status==='mismatch'?'Try again':'Tracking unclear';
  const next=status==='match'?'The next clip will begin.':'Return to the starting squares and try again.';
  const messages=Array.isArray(result?.messages)?result.messages.map(clean).filter(Boolean):[];
  let detail=messages.join(' ')||clean(result?.reason)||'A reliable result is unavailable.';
  // Keep spoken feedback brief; the complete original feedback stays on screen.
  // The fixed watchdog is still required because browser speech can stall.
  const allowance=44-outcome.split(' ').length-next.split(' ').length;
  detail=detail.split(' ').slice(0,allowance).join(' ');
  if(detail.length>240){const cut=detail.lastIndexOf(' ',240);detail=detail.slice(0,cut>0?cut:240);}
  return `${sentence(outcome)} ${sentence(detail)} ${next}`;
}

export function createFeedbackSpeech({
  synthesis=globalThis.speechSynthesis,
  Utterance=globalThis.SpeechSynthesisUtterance,
  enabled=true,onState=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,
}={}){
  const supported=!!synthesis&&typeof synthesis.getVoices==='function'
    &&typeof synthesis.speak==='function'&&typeof synthesis.cancel==='function'&&typeof Utterance==='function';
  let isEnabled=!!enabled,unlocked=false,destroyed=false,active=null,sequence=0;
  let selectedVoice=null,voiceState='loading',message='',published=null;
  let detachVoices=()=>{};

  function getState(){return {supported,enabled:isEnabled,unlocked,busy:!!active&&!destroyed,
    message,voiceName:active?.utterance?.voice?.name||selectedVoice?.name||null};}
  function publish(){
    const snapshot=getState(),key=JSON.stringify(snapshot);if(key===published)return;
    published=key;
    try{onState(snapshot);}catch{/* Presentation callbacks cannot break feedback or speech cleanup. */}
  }
  function readyMessage(){
    if(!supported)return 'Spoken feedback is unavailable in this browser. Written feedback remains available.';
    if(!isEnabled)return 'Spoken feedback off. Written feedback remains available.';
    if(voiceState==='missing'||voiceState==='error')return 'No installed English voice is available. Written feedback remains available.';
    if(!unlocked)return 'Spoken feedback will be enabled when you start practice.';
    if(!selectedVoice)return 'Waiting for an installed English voice. Written feedback remains available.';
    return 'Spoken feedback ready.';
  }
  function readVoices(){
    if(!supported)return;
    try{
      const voices=Array.from(synthesis.getVoices()||[]);
      // Never use a remote voice or fall back to the browser's unspecified
      // default voice. localService must explicitly confirm on-device speech.
      const localEnglish=voices.filter(voice=>voice?.localService===true&&/^en(?:[-_]|$)/i.test(voice.lang||''));
      localEnglish.sort((a,b)=>{
        const priority=voice=>(/^en[-_]us$/i.test(voice.lang)?0:2)+(voice.default?0:1);
        return priority(a)-priority(b)||String(a.name||'').localeCompare(String(b.name||''));
      });
      selectedVoice=localEnglish[0]||null;
      voiceState=selectedVoice?'available':voices.length?'missing':'loading';
    }catch{selectedVoice=null;voiceState='error';}
  }
  function clearRequest(request){
    if(!request)return;
    for(const key of ['voiceTimer','watchdog']){
      if(request[key]!==null){try{clearTimer(request[key]);}catch{}request[key]=null;}
    }
    if(request.utterance){request.utterance.onend=null;request.utterance.onerror=null;}
  }
  const current=request=>!destroyed&&active===request&&request.token===sequence;
  function cancelEngine(){try{synthesis.cancel();}catch{/* Written feedback must remain usable. */}}
  function finish(request,nextMessage,{cancelSpeech=false}={}){
    if(!current(request))return;
    active=null;sequence++;clearRequest(request);
    if(cancelSpeech&&request.utterance)cancelEngine();
    message=nextMessage;publish();
  }
  function cancelActive({notify=true}={}){
    const previous=active;active=null;sequence++;clearRequest(previous);
    if(previous?.utterance)cancelEngine();
    message=readyMessage();if(notify)publish();
  }
  function start(request){
    if(!current(request)||request.started||!selectedVoice)return;
    if(!isEnabled||!unlocked){cancelActive();return;}
    request.started=true;
    if(request.voiceTimer!==null){try{clearTimer(request.voiceTimer);}catch{}request.voiceTimer=null;}
    try{
      const utterance=new Utterance(request.text);request.utterance=utterance;
      utterance.voice=selectedVoice;utterance.lang=selectedVoice.lang;
      utterance.rate=1.08;utterance.volume=1;
      utterance.onend=()=>finish(request,'Spoken feedback complete.');
      utterance.onerror=()=>finish(request,'Speech could not finish. Written feedback remains available.',{cancelSpeech:true});
      message='Speaking feedback…';publish();
      if(!current(request))return;
      if(synthesis.paused&&typeof synthesis.resume==='function')synthesis.resume();
      if(!current(request))return;
      synthesis.speak(utterance);
    }catch{finish(request,'Speech could not start. Written feedback remains available.',{cancelSpeech:true});}
  }
  function voicesChanged(){
    if(destroyed)return;
    readVoices();
    if(active&&!active.started){
      if(selectedVoice)start(active);
      else if(voiceState!=='loading')finish(active,readyMessage());
    }else if(!active){message=readyMessage();publish();}
  }
  if(supported){
    readVoices();
    try{
      if(typeof synthesis.addEventListener==='function'){
        synthesis.addEventListener('voiceschanged',voicesChanged);
        detachVoices=()=>synthesis.removeEventListener?.('voiceschanged',voicesChanged);
      }else{
        const previous=synthesis.onvoiceschanged;
        const handler=event=>{try{previous?.call(synthesis,event);}catch{}voicesChanged();};
        synthesis.onvoiceschanged=handler;
        detachVoices=()=>{if(synthesis.onvoiceschanged===handler)synthesis.onvoiceschanged=previous;};
      }
    }catch{/* A later attempt reads the voice list again even without this event. */}
  }
  message=readyMessage();publish();

  return {
    unlock(){
      if(destroyed)return false;
      // Called only by the controller's real Start/enable click handlers.
      // No empty utterance or announcement is played during activation.
      unlocked=true;readVoices();if(!active){message=readyMessage();publish();}
      return supported&&isEnabled;
    },
    setEnabled(value){
      if(destroyed)return getState();
      isEnabled=!!value;
      if(!isEnabled)cancelActive();
      else{readVoices();if(!active){message=readyMessage();publish();}}
      return getState();
    },
    speakReview(result){
      if(destroyed)return false;
      cancelActive({notify:false});readVoices();
      if(!supported||!isEnabled||!unlocked){message=readyMessage();publish();return false;}
      if(voiceState==='missing'||voiceState==='error'){message=readyMessage();publish();return false;}
      const request={token:++sequence,text:reviewText(result),utterance:null,voiceTimer:null,watchdog:null,started:false};
      active=request;message=selectedVoice?'Preparing spoken feedback…':'Loading an installed English voice…';
      try{
        // This deadline includes voice discovery; it is never extended by
        // voiceschanged, onstart, repeated callbacks, or browser queue delays.
        request.watchdog=setTimer(()=>finish(request,'Speech timed out. Written feedback remains available.',{cancelSpeech:true}),MAXIMUM_SPEECH_MS);
        publish();if(!current(request))return false;
        if(selectedVoice)start(request);
        else request.voiceTimer=setTimer(()=>{
          if(!current(request))return;
          readVoices();
          if(selectedVoice)start(request);
          else{voiceState='missing';finish(request,readyMessage());}
        },VOICE_WAIT_MS);
      }catch{finish(request,'Speech could not start. Written feedback remains available.',{cancelSpeech:true});}
      return !!active;
    },
    cancel(){if(!destroyed)cancelActive();},
    isBusy(){return !!active&&!destroyed;},
    getState,
    destroy(){
      if(destroyed)return;
      cancelActive({notify:false});destroyed=true;
      try{detachVoices();}catch{}
      message='Spoken feedback stopped.';publish();
    },
  };
}
