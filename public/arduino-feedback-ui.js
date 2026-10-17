// Wi-Fi transport is preserved in arduino-feedback-client.js for later use.
// import {createArduinoFeedbackClient} from './arduino-feedback-client.js';
import {createArduinoUsbClient} from './arduino-usb-client.js';
import {createHardwareGuidance} from './practice-hardware-guidance.js';

// The local server owns USB serial. An optional peripheral never blocks practice.
export function attachArduinoFeedback({getContext,document:doc=document,
  clientFactory=createArduinoUsbClient,guidanceFactory=createHardwareGuidance,now=()=>performance.now()}={}){
  const $=id=>doc.getElementById(id),guidance=guidanceFactory();
  const connect=$('arduino-connect'),disconnect=$('arduino-disconnect');
  let destroyed=false,lastSignal={state:'idle',reason:'Not practicing.'};
  const client=clientFactory({onState(status){
    $('arduino-status').textContent=status.message;
    connect.disabled=status.connecting||status.connected;
    connect.textContent=status.connecting?'Connecting…':'Connect USB feedback';
    disconnect.disabled=!status.connected&&!status.connecting;
    const indicator=$('hardware-indicator');indicator.hidden=!status.connected;
    indicator.dataset.state=['good','off'].includes(status.state)?status.state:'idle';
    const text=status.state==='good'?'Arduino · green':status.state==='off'?'Arduino · off guide':'Arduino · ready';
    indicator.textContent=text;indicator.setAttribute('aria-label',text);
  }});
  const connectHandler=()=>client.connect();
  const disconnectHandler=()=>{guidance.reset();lastSignal={state:'idle',reason:'Disconnected.'};void client.disconnect();};
  connect.addEventListener('click',connectHandler);disconnect.addEventListener('click',disconnectHandler);
  void client.probe();
  return {
    update(){
      if(destroyed)return;
      try{
        const context=getContext(),nowMs=now();
        lastSignal=guidance.update(context.reference,context.pathReference,context.observation,context.frame,
          {nowMs,active:context.active===true,contextKey:context.contextKey});
      }catch{guidance.reset();lastSignal={state:'idle',reason:'Tracking unavailable.'};}
      client.setSignal(lastSignal);
    },
    neutral(){guidance.reset();lastSignal={state:'idle',reason:'Not practicing.'};client.setSignal(lastSignal);},
    getState:()=>({...client.getState(),guidance:structuredClone(lastSignal)}),
    destroy(){if(destroyed)return;destroyed=true;guidance.reset();client.destroy();
      connect.removeEventListener('click',connectHandler);disconnect.removeEventListener('click',disconnectHandler);},
  };
}

/*
Wi-Fi UI is intentionally commented out while testing USB. Restore the import
and this implementation together with the Wi-Fi relay to return to that mode.
Original Wi-Fi transport, firmware and settings remain separate and unchanged.
import {createArduinoFeedbackClient} from './arduino-feedback-client.js';
import {createHardwareGuidance} from './practice-hardware-guidance.js';

// Optional peripheral. A disconnected Arduino never blocks the lesson.
export function attachArduinoFeedback({getContext,document:doc=document,storage=globalThis.localStorage,
  clientFactory=createArduinoFeedbackClient,guidanceFactory=createHardwareGuidance,now=()=>performance.now()}={}){
  const $=id=>doc.getElementById(id),guidance=guidanceFactory();
  const address=$('arduino-address'),key=$('arduino-key'),connect=$('arduino-connect'),disconnect=$('arduino-disconnect');
  let destroyed=false,lastSignal={state:'idle',reason:'Not practicing.'};
  const client=clientFactory({onState(status){
    $('arduino-status').textContent=status.message;
    connect.disabled=status.connecting;connect.textContent=status.connecting?'Connecting…':'Connect Wi-Fi feedback';
    disconnect.disabled=!status.connected&&!status.connecting;
    address.disabled=status.connected||status.connecting;
    key.disabled=status.connected||status.connecting;
    $('arduino-key-field').hidden=status.pairingConfigured;
    const indicator=$('hardware-indicator');indicator.hidden=!status.connected;
    indicator.dataset.state=status.state;
    const text=status.state==='good'?'Arduino · green':status.state==='off'?'Arduino · off guide':'Arduino · ready';
    indicator.textContent=text;indicator.setAttribute('aria-label',text);
  }});
  try{address.value=storage?.getItem('motiontrial.arduino.address')||'';}catch{}
  const connectHandler=async()=>{
    const connected=await client.connect({address:address.value.trim(),key:key.value.trim()});
    if(connected){key.value='';try{storage?.setItem('motiontrial.arduino.address',address.value.trim());}catch{}}
  };
  const disconnectHandler=()=>{guidance.reset();lastSignal={state:'idle',reason:'Disconnected.'};void client.disconnect();};
  connect.addEventListener('click',connectHandler);disconnect.addEventListener('click',disconnectHandler);
  void client.probe();
  return {
    update(){
      if(destroyed)return;
      // Errors in optional hardware must not interrupt camera inference/playback.
      try{
        const context=getContext(),nowMs=now();
        lastSignal=guidance.update(context.reference,context.pathReference,context.observation,context.frame,
          {nowMs,active:context.active===true,contextKey:context.contextKey});
      }catch{guidance.reset();lastSignal={state:'idle',reason:'Tracking unavailable.'};}
      client.setSignal(lastSignal);
    },
    neutral(){guidance.reset();lastSignal={state:'idle',reason:'Not practicing.'};client.setSignal(lastSignal);},
    getState:()=>({...client.getState(),guidance:structuredClone(lastSignal)}),
    destroy(){if(destroyed)return;destroyed=true;guidance.reset();client.destroy();
      connect.removeEventListener('click',connectHandler);disconnect.removeEventListener('click',disconnectHandler);},
  };
}

*/

