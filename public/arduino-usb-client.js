// USB serial is owned by the local practice server, so the in-app browser can
// use it without Web Serial support. Only idle/good/off commands are sent.
export function createArduinoUsbClient({fetchFn=(...args)=>fetch(...args),
  now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,onState=()=>{}}={}){
  let status={transport:'usb',supported:false,connected:false,connecting:false,port:null,
    state:'idle',message:'Checking the local USB relay…'};
  let generation=0,sessionId=null,sequence=0,timer=null,destroyed=false;
  let signal={state:'idle',reason:'Not practicing.',updatedAt:-Infinity};
  const requests=new Set();
  const snapshot=()=>({...status,signalReason:signal.reason});
  const publish=patch=>{status={...status,...patch};try{onState(snapshot());}catch{}};
  const validState=value=>['good','off'].includes(value)?value:'idle';
  function cancelTimer(){if(timer!==null)clearTimer(timer);timer=null;}
  function abortRequests(){for(const controller of requests)controller.abort();}
  async function request(path,body,{keepalive=false,timeoutMs=900}={}){
    const controller=new AbortController();requests.add(controller);
    let rejectAbort,expired=false;
    const aborted=new Promise((resolve,reject)=>{rejectAbort=()=>reject(Error(expired
      ?'Arduino USB request timed out. Check the cable and close Serial Monitor.':'USB request canceled.'));
      controller.signal.addEventListener('abort',rejectAbort,{once:true});});
    const timeout=setTimer(()=>{expired=true;controller.abort();},timeoutMs);
    try{
      return await Promise.race([aborted,(async()=>{
        const response=await fetchFn('/api/arduino/'+path,{method:body===undefined?'GET':'POST',
          headers:body===undefined?{}:{'Content-Type':'application/json'},
          body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:controller.signal,keepalive});
        let data;try{data=await response.json();}catch{throw Error('USB relay unavailable. Restart the local practice server.');}
        if(!response.ok)throw Error(typeof data?.message==='string'?data.message:'The Arduino USB connection failed.');
        return data;
      })()]);
    }finally{
      clearTimer(timeout);controller.signal.removeEventListener('abort',rejectAbort);requests.delete(controller);
    }
  }
  function schedule(token){
    cancelTimer();if(!destroyed&&sessionId&&generation===token)
      timer=setTimer(()=>{timer=null;void pump(token);},100);
  }
  async function pump(token){
    if(destroyed||!sessionId||token!==generation)return;
    const at=now(),age=at-signal.updatedAt;
    const state=Number.isFinite(at)&&Number.isFinite(age)&&age>=0&&age<=450?signal.state:'idle';
    try{
      const result=await request('signal',{sessionId,sequence:++sequence,state});
      if(token!==generation||destroyed)return;
      if(result.connected!==true||result.transport!==undefined&&result.transport!=='usb')
        throw Error(result.message||'Arduino USB disconnected. Reconnect when ready.');
      // A relay command state is not physical LED confirmation or a pose grade.
      publish({connected:true,state:validState(result.state),
        message:result.message||`USB feedback connected${status.port?' · '+status.port:''}.`});
    }catch(error){
      if(token!==generation||destroyed)return;
      sessionId=null;cancelTimer();
      publish({connected:false,connecting:false,state:'idle',message:error.message||'Arduino USB disconnected.'});
      return;
    }
    schedule(token);
  }
  async function disconnect({keepalive=false}={}){
    const id=sessionId;++generation;cancelTimer();abortRequests();sessionId=null;
    signal={state:'idle',reason:'Not practicing.',updatedAt:now()};
    publish({connecting:false,connected:false,port:null,state:'idle',message:'USB feedback disconnected.'});
    if(id)try{await request('disconnect',{sessionId:id},{keepalive});}catch{}
  }
  return {
    async probe(){
      if(destroyed||status.connecting||sessionId)return snapshot();
      const token=generation;
      try{
        const result=await request('status');
        if(token===generation&&!destroyed){
          const supported=result.transport==='usb'&&result.supported===true;
          publish({supported,message:supported?'Connect the Arduino by USB, then choose Connect USB feedback.'
            :'Restart the local practice server to enable USB feedback.'});
        }
      }catch{if(token===generation&&!destroyed)publish({supported:false,
        message:'USB relay unavailable. Restart the local practice server.'});}
      return snapshot();
    },
    async connect({port}={}){
      if(destroyed)return false;
      const token=++generation;cancelTimer();abortRequests();sessionId=null;sequence=0;
      signal={state:'idle',reason:'Waiting for your next imitation.',updatedAt:now()};
      publish({connecting:true,connected:false,port:null,state:'idle',message:'Finding and connecting the Arduino over USB…'});
      try{
        const result=await request('connect',typeof port==='string'&&port.trim()?{port:port.trim()}:{},{timeoutMs:15000});
        if(token!==generation||destroyed)return false;
        if(result.transport!=='usb'||result.connected!==true||typeof result.sessionId!=='string'||!result.sessionId)
          throw Error('The local server did not confirm an Arduino USB connection.');
        sessionId=result.sessionId;
        signal={state:'idle',reason:'Waiting for your next imitation.',updatedAt:now()};
        publish({supported:true,connecting:false,connected:true,port:result.port??null,state:'idle',
          message:`USB feedback connected${result.port?' · '+result.port:''}. Ready for your turn.`});
        schedule(token);return true;
      }catch(error){
        if(token===generation&&!destroyed)publish({connecting:false,connected:false,state:'idle',
          message:error.message||'Could not connect to the Arduino over USB.'});
        return false;
      }
    },
    setSignal(value){
      if(destroyed)return;
      const previous=signal.state;
      signal={state:validState(value?.state),reason:typeof value?.reason==='string'?value.reason:'Tracking unavailable.',updatedAt:now()};
      if(signal.state==='idle'&&previous!=='idle'&&sessionId){
        // A pause or missing tracking supersedes a pending warning immediately.
        // Generation guards ignore its late response; the higher sequence lets
        // the server reject a delayed older command as well.
        const token=++generation;cancelTimer();abortRequests();publish({state:'idle'});void pump(token);
      }
    },
    disconnect,
    getState:snapshot,
    destroy(){if(destroyed)return;void disconnect({keepalive:true});destroyed=true;},
  };
}
