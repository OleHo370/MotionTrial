import {createFeedbackSpeech} from './practice-feedback-speech.js';

// Explicitly fixed QA text. This is never presented as an observed learner result.
const sampleResult=Object.freeze({status:'mismatch',messages:Object.freeze([
  'Your hands moved too fast. Move more slowly on the next try.',
])});
const speakButton=document.getElementById('speak-sample');
const stopButton=document.getElementById('stop-speech');
const status=document.getElementById('speech-status');
let speech=null;
function render(state){
  status.textContent=[
    `Status: ${state.message}`,
    `Voice: ${state.voiceName||'No installed local English voice selected'}`,
    `Supported: ${state.supported}`,
    `Unlocked: ${state.unlocked}`,
    `Busy: ${state.busy}`,
    'Source: fixed sample feedback only; not a live learner result.',
  ].join('\n');
  speakButton.disabled=!state.supported;
  stopButton.disabled=!state.busy;
}
// The initial onState callback uses only existing DOM references, so it is
// safe even though the service has not yet been assigned to speech.
speech=createFeedbackSpeech({enabled:true,onState:render});
speakButton.addEventListener('click',()=>{
  speech.unlock();
  speech.speakReview(sampleResult);
});
stopButton.addEventListener('click',()=>speech.cancel());
window.addEventListener('pagehide',()=>speech.destroy(),{once:true});
