// Only small hardware states cross the loopback relay. Camera frames, poses,
// movement scores and Wi-Fi credentials never enter this transport.
export function createArduinoFeedbackClient({fetchFn=(...args)=>fetch(...args),
  now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,onState=()=>{}}={}){
  let status={supported:false,pairingConfigured:false,connected:false,connecting:false,
    address:null,state:'idle',message:'Checking the local Wi-Fi relay…'};
  let generation=0,sessionId=null,sequence=0,timer=null,inFlight=null,destroyed=false;
  let signal={state:'idle',reason:'Not practicing.',updatedAt:-Infinity};
  const snapshot=()=>({...status,signalReason:signal.reason});
  const publish=patch=>{status={...status,...patch};try{onState(snapshot());}catch{}};
  function cancelTimer(){if(timer!==null)clearTimer(timer);timer=null;}
  async function request(path,body,{keepalive=false}={}){
    const controller=new AbortController(),timeout=setTimer(()=>controller.abort(),900);
    inFlight=controller;
    try{
      const response=await fetchFn('/api/arduino/'+path,{method:body===undefined?'GET':'POST',
        headers:body===undefined?{}:{'Content-Type':'application/json'},
        body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:controller.signal,keepalive});
      let data;try{data=await response.json();}catch{throw Error('Wi-Fi relay unavailable. Restart the local practice server.');}
      if(!response.ok)throw Error(typeof data?.message==='string'?data.message:'The Arduino connection failed.');
      return data;
    }finally{clearTimer(timeout);if(inFlight===controller)inFlight=null;}
  }
  function schedule(token){
    cancelTimer();if(!destroyed&&sessionId&&generation===token)
      timer=setTimer(()=>{timer=null;void pump(token);},100);
  }
  async function pump(token){
    if(destroyed||!sessionId||token!==generation)return;
    const id=sessionId,at=now(),state=at-signal.updatedAt<=450&&at>=signal.updatedAt?signal.state:'idle';
    try{
      const result=await request('signal',{sessionId:id,sequence:++sequence,state});
      if(token!==generation||destroyed)return;
      if(result.connected!==true)throw Error(result.message||'Arduino disconnected. Reconnect when ready.');
      // This is the relay's desired command state, not a hardware ACK or grade.
      publish({connected:true,state:result.state??'idle',message:result.message||'Wi-Fi feedback connected.'});
    }catch(error){
      if(token!==generation||destroyed)return;
      sessionId=null;cancelTimer();
      publish({connected:false,connecting:false,state:'idle',message:error.message||'Arduino disconnected.'});
      return;
    }
    schedule(token);
  }
  return {
    async probe(){
      const token=generation;
      try{const result=await request('status');if(token===generation&&!destroyed)
        publish({supported:result.supported===true,pairingConfigured:result.pairingConfigured===true,
          message:result.supported?'Enter the Arduino IP address, then connect.':'Restart the local practice server to enable Wi-Fi feedback.'});
      }catch{if(token===generation&&!destroyed)publish({supported:false,
        message:'Wi-Fi relay unavailable. Restart the local practice server.'});}
      return snapshot();
    },
    async connect({address,key}={}){
      if(destroyed)return false;
      const token=++generation;cancelTimer();inFlight?.abort();sessionId=null;sequence=0;
      signal={state:'idle',reason:'Waiting for your next imitation.',updatedAt:now()};
      publish({connecting:true,connected:false,state:'idle',message:'Connecting to Arduino…'});
      try{
        const result=await request('connect',{address,...(key?{key}:{})});
        if(token!==generation||destroyed)return false;
        if(result.connected!==true||typeof result.sessionId!=='string'||!result.sessionId)
          throw Error('The relay did not confirm an Arduino connection.');
        sessionId=result.sessionId;publish({supported:true,connecting:false,connected:true,
          address:result.address??address,state:'idle',message:'Wi-Fi feedback connected. Ready for your turn.'});
        schedule(token);return true;
      }catch(error){if(token===generation&&!destroyed)publish({connecting:false,connected:false,state:'idle',
        message:error.message||'Could not connect to Arduino.'});return false;}
    },
    setSignal(value){
      if(destroyed)return;
      const previous=signal.state;
      signal={state:['good','off'].includes(value?.state)?value.state:'idle',
        reason:typeof value?.reason==='string'?value.reason:'Tracking unavailable.',updatedAt:now()};
      if(signal.state==='idle'&&previous!=='idle'&&sessionId){
        // Silence takes priority over an outstanding warning/green request.
        // A newer sequence and generation reject late responses and commands.
        const token=++generation;cancelTimer();inFlight?.abort();
        publish({state:'idle'});void pump(token);
      }
    },
    async disconnect({keepalive=false}={}){
      const id=sessionId;++generation;cancelTimer();inFlight?.abort();sessionId=null;
      signal={state:'idle',reason:'Not practicing.',updatedAt:now()};
      publish({connecting:false,connected:false,state:'idle',message:'Wi-Fi feedback disconnected.'});
      if(id)try{await request('disconnect',{sessionId:id},{keepalive});}catch{}
    },
    getState:snapshot,
    destroy(){if(destroyed)return;void this.disconnect({keepalive:true});destroyed=true;},
  };
}
