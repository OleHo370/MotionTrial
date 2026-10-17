/**
 * Deterministic software lifecycle checks use an explicitly FAKE speech
 * engine, fake utterances and a fake clock. No sound is produced, and no
 * physical speaker, installed voice or browser audibility is validated here.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createFeedbackSpeech} from '../public/practice-feedback-speech.js';

const checks=[];
const voice=(name,lang='en-US',localService=true,isDefault=false)=>({name,lang,localService,default:isDefault});
const english=voice('Fake installed English voice'),remote=voice('Fake remote English voice','en-US',false,true);
class Clock{
  now=0;next=1;timers=new Map();
  set=(fn,delay)=>{const id=this.next++;this.timers.set(id,{at:this.now+delay,fn});return id;};
  clear=id=>this.timers.delete(id);
  advance(ms){
    const until=this.now+ms;
    for(let count=0;;count++){
      assert.ok(count<100,'Fake clock cannot loop indefinitely');
      const next=[...this.timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(!next||next[1].at>until)break;
      this.now=next[1].at;this.timers.delete(next[0]);next[1].fn();
    }
    this.now=until;
  }
}
class FakeUtterance{constructor(text){this.text=text;}}
class FakeSynthesis extends EventTarget{
  constructor(voices=[english]){super();this.voices=voices;}
  spoken=[];cancels=0;resumes=0;paused=false;throwSpeak=false;throwCancel=false;throwVoices=false;
  getVoices(){if(this.throwVoices)throw Error('Constructed voice-list error');return this.voices;}
  speak(utterance){if(this.throwSpeak)throw Error('Constructed speech-start error');this.spoken.push(utterance);}
  cancel(){this.cancels++;if(this.throwCancel)throw Error('Constructed cancel error');}
  resume(){this.resumes++;this.paused=false;}
  changeVoices(voices){this.voices=voices;this.dispatchEvent(new Event('voiceschanged'));}
}
function fixture({voices=[english],enabled=true,onState,Utterance=FakeUtterance}={}){
  const clock=new Clock(),engine=new FakeSynthesis(voices),states=[];
  const speech=createFeedbackSpeech({synthesis:engine,Utterance,enabled,setTimer:clock.set,clearTimer:clock.clear,
    onState:state=>{states.push(state);onState?.(state);}});
  return {clock,engine,states,speech,last:()=>engine.spoken.at(-1)};
}
const match={status:'match',percent:97,messages:['Both hands reached the finish.','Your timing was close enough.']};
const mismatch={status:'mismatch',messages:['Your left hand moved too far outward.']};
const unknown={status:'unknown',percent:99,reason:'Your left foot was hidden.'};

{
  const clock=new Clock(),speech=createFeedbackSpeech({synthesis:null,Utterance:null,setTimer:clock.set,clearTimer:clock.clear});
  assert.equal(speech.getState().supported,false);assert.equal(speech.unlock(),false);
  assert.equal(speech.speakReview(match),false);assert.equal(speech.isBusy(),false);assert.equal(clock.timers.size,0);
  assert.match(speech.getState().message,/Written feedback/);speech.cancel();speech.destroy();
  checks.push('Unsupported browser APIs safely keep written feedback available, never claim to be busy, and never schedule speech.');
}

{
  const localGb=voice('Fake local British default','en-GB',true,true),localUs=voice('Fake local US','en-US');
  const f=fixture({voices:[remote,localGb,voice('Fake local French','fr-FR'),localUs]});
  assert.equal(f.engine.spoken.length,0);assert.equal(f.speech.speakReview(match),false);
  assert.equal(f.speech.unlock(),true);assert.equal(f.engine.spoken.length,0,'Unlock has no announcement');
  f.speech.setEnabled(false);assert.equal(f.speech.speakReview(match),false);f.speech.setEnabled(true);
  assert.equal(f.engine.spoken.length,0,'Enabling does not replay or automatically announce anything');
  const before=JSON.stringify(match);assert.equal(f.speech.speakReview(match),true);
  const utterance=f.last();assert.equal(utterance.voice,localUs);assert.equal(utterance.lang,'en-US');
  assert.ok(utterance.rate>=1.05&&utterance.rate<=1.1);assert.equal(utterance.volume,1);
  assert.match(utterance.text,/^Close enough\./);assert.ok(match.messages.every(text=>utterance.text.includes(text)));
  assert.match(utterance.text,/next clip/i);assert.doesNotMatch(utterance.text,/97|percent|%/);
  assert.equal(f.speech.getState().voiceName,localUs.name);assert.equal(JSON.stringify(match),before);
  utterance.onend();assert.equal(f.speech.isBusy(),false);assert.equal(f.clock.timers.size,0);f.speech.destroy();
  checks.push('The controller must call unlock before speaking; initialization, unlock and enable are silent. Only explicitly local English fake voices are selected, preferring en-US, with explicit voice/lang/rate/volume and the existing review text.');
}

{
  const f=fixture();f.speech.unlock();
  for(const [result,prefix]of [[mismatch,'Try again.'],[unknown,'Tracking unclear.']]){
    assert.equal(f.speech.speakReview(result),true);assert.ok(f.last().text.startsWith(prefix));
    assert.doesNotMatch(f.last().text,/Close enough|99|percent|%|Not assessed|next demonstration/i);
    assert.ok(f.last().text.includes(result.reason||result.messages[0]));
    assert.match(f.last().text,/starting squares/);
    f.last().onend();
  }
  f.speech.destroy();checks.push('Mismatch and tracking-unclear outcomes retain their actual reasons and return to the starting squares; unknown tracking never becomes a skip, success announcement or invented percentage.');
}

{
  const f=fixture();f.speech.unlock();f.speech.speakReview(match);
  const oldEnd=f.last().onend,oldError=f.last().onerror;
  f.speech.speakReview(mismatch);const replacement=f.last();
  assert.equal(f.engine.spoken.length,2);assert.equal(f.engine.cancels,1);assert.equal(f.speech.isBusy(),true);
  oldEnd();oldError();assert.equal(f.speech.isBusy(),true);assert.equal(f.last(),replacement);
  const replacementEnd=replacement.onend;f.speech.cancel();assert.equal(f.engine.cancels,2);
  assert.equal(f.speech.isBusy(),false);assert.equal(f.clock.timers.size,0);replacementEnd();assert.equal(f.speech.isBusy(),false);
  f.speech.cancel();assert.equal(f.engine.cancels,2,'An idle cancellation does not cancel unrelated browser speech');
  f.speech.speakReview(match);f.last().onend();assert.equal(f.speech.isBusy(),false);f.speech.destroy();
  checks.push('New attempts cancel and replace the old utterance rather than queueing it. Late callbacks from replaced or canceled attempts cannot change the current attempt or resurrect a finished one.');
}

{
  const f=fixture({voices:[]});f.speech.unlock();f.speech.speakReview(mismatch);
  assert.equal(f.speech.isBusy(),true);assert.equal(f.engine.spoken.length,0);
  f.clock.advance(900);f.engine.changeVoices([remote,voice('Fake installed British','en-GB')]);
  assert.equal(f.engine.spoken.length,1);assert.equal(f.last().voice.localService,true);assert.equal(f.last().voice.lang,'en-GB');
  f.engine.dispatchEvent(new Event('voiceschanged'));assert.equal(f.engine.spoken.length,1,'A voice event starts the pending attempt only once');
  f.clock.advance(17099);assert.equal(f.speech.isBusy(),true);
  f.clock.advance(1);assert.equal(f.clock.now,18000);assert.equal(f.speech.isBusy(),false);assert.equal(f.engine.cancels,1);
  assert.equal(f.clock.timers.size,0);assert.match(f.speech.getState().message,/timed out/);f.speech.destroy();
  checks.push('An initially empty voice list waits for voiceschanged and starts once when a local English voice arrives. The fixed 18-second watchdog includes the 900 ms voice-loading delay and clears stalled speech.');
}

{
  const f=fixture({voices:[]});f.speech.unlock();f.speech.speakReview(match);
  f.clock.advance(999);assert.equal(f.speech.isBusy(),true);f.clock.advance(1);
  assert.equal(f.speech.isBusy(),false);assert.equal(f.engine.spoken.length,0);assert.equal(f.clock.timers.size,0);
  assert.match(f.speech.getState().message,/No installed English/);
  f.engine.changeVoices([english]);assert.equal(f.engine.spoken.length,0,'A timed-out review is not replayed when voices arrive later');
  assert.equal(f.speech.speakReview(match),true);f.last().onend();f.speech.destroy();
  for(const voices of [[remote],[voice('Fake French','fr-FR')],[{name:'Unspecified local flag',lang:'en-US'}]]){
    const denied=fixture({voices});denied.speech.unlock();assert.equal(denied.speech.speakReview(match),false);
    assert.equal(denied.speech.isBusy(),false);assert.equal(denied.engine.spoken.length,0);assert.equal(denied.clock.timers.size,0);denied.speech.destroy();
  }
  checks.push('Voice discovery ends after one second; late voices never replay expired reviews. Remote voices, non-English voices and voices without explicit localService=true are rejected with written-feedback fallback.');
}

{
  const voiceFailure=fixture();voiceFailure.engine.throwVoices=true;voiceFailure.speech.unlock();
  assert.doesNotThrow(()=>voiceFailure.speech.speakReview(match));assert.equal(voiceFailure.speech.isBusy(),false);voiceFailure.speech.destroy();
  const constructorFailure=fixture({Utterance:class{constructor(){throw Error('Constructed utterance error');}}});
  constructorFailure.speech.unlock();assert.equal(constructorFailure.speech.speakReview(match),false);assert.equal(constructorFailure.clock.timers.size,0);constructorFailure.speech.destroy();
  const startFailure=fixture({onState(){throw Error('Constructed presentation callback error');}});startFailure.engine.throwSpeak=true;startFailure.speech.unlock();
  assert.doesNotThrow(()=>startFailure.speech.speakReview(match));assert.equal(startFailure.speech.isBusy(),false);assert.equal(startFailure.clock.timers.size,0);
  startFailure.engine.throwSpeak=false;startFailure.speech.speakReview(match);startFailure.last().onerror({error:'audio-busy'});
  assert.equal(startFailure.speech.isBusy(),false);assert.equal(startFailure.clock.timers.size,0);
  startFailure.speech.speakReview(match);startFailure.engine.throwCancel=true;assert.doesNotThrow(()=>startFailure.speech.cancel());
  assert.equal(startFailure.speech.isBusy(),false);assert.equal(startFailure.clock.timers.size,0);startFailure.speech.destroy();
  checks.push('Voice enumeration, utterance construction, speech start, speech error, cancellation and presentation-callback exceptions are isolated; every failure clears busy/timers so written practice can continue.');
}

{
  const f=fixture();f.speech.unlock();f.speech.speakReview(match);const oldEnd=f.last().onend;
  f.speech.setEnabled(false);assert.equal(f.speech.isBusy(),false);assert.equal(f.engine.cancels,1);oldEnd();
  assert.equal(f.speech.getState().enabled,false);f.speech.setEnabled(true);assert.equal(f.engine.spoken.length,1);
  f.speech.speakReview(match);const finalEnd=f.last().onend;f.speech.destroy();
  assert.equal(f.engine.cancels,2);assert.equal(f.speech.isBusy(),false);assert.equal(f.clock.timers.size,0);finalEnd();
  assert.equal(f.speech.unlock(),false);assert.equal(f.speech.speakReview(match),false);
  const before=f.speech.getState();f.engine.changeVoices([voice('A later voice')]);assert.deepEqual(f.speech.getState(),before);
  checks.push('Disabling and destroying cancel active speech and all pending timers; re-enabling is silent, stale completion callbacks are ignored, and destruction removes the voiceschanged listener.');
}

{
  const clock=new Clock();let priorCalls=0;
  const prior=()=>priorCalls++,engine={voices:[],spoken:[],onvoiceschanged:prior,getVoices(){return this.voices;},speak(u){this.spoken.push(u);},cancel(){}};
  const speech=createFeedbackSpeech({synthesis:engine,Utterance:FakeUtterance,setTimer:clock.set,clearTimer:clock.clear});
  speech.unlock();speech.speakReview(match);engine.voices=[english];engine.onvoiceschanged(new Event('voiceschanged'));
  assert.equal(priorCalls,1);assert.equal(engine.spoken.length,1);speech.destroy();assert.equal(engine.onvoiceschanged,prior);
  let reentrantSpeech;
  const f=fixture({onState:state=>{if(state.message==='Speaking feedback…')reentrantSpeech?.cancel();}});reentrantSpeech=f.speech;
  f.speech.unlock();assert.equal(f.speech.speakReview(match),false);assert.equal(f.engine.spoken.length,0);assert.equal(f.clock.timers.size,0);f.speech.destroy();
  checks.push('The legacy onvoiceschanged property fallback preserves and restores an existing handler. A reentrant UI cancellation before speak() cannot emit stale audio.');
}

{
  const f=fixture();f.speech.unlock();const long={status:'mismatch',reason:Array.from({length:300},(_,i)=>`word${i}`).join(' ')};
  const before=JSON.stringify(long);f.speech.speakReview(long);
  assert.ok(f.last().text.split(/\s+/).length<=44);assert.match(f.last().text,/starting squares/);assert.equal(JSON.stringify(long),before);
  f.engine.paused=true;f.speech.speakReview(match);assert.equal(f.engine.resumes,1);f.last().onend();f.speech.destroy();
  checks.push('Spoken text stays concise without changing the full written result, and a paused speech engine resumes for the new explicitly requested feedback.');
}

const report={passed:true,checkGroups:checks.length,checks,
  provenance:'Deterministic software lifecycle regression using an explicitly FAKE speech synthesis engine, fake voices/utterances and a fake clock. No sound was produced. No real browser speech output, installed voice availability, physical speakers or audibility is claimed.',
  limitations:['Actual browser autoplay behavior, installed local English voice availability, output volume and audibility require browser/device testing.']};
const directory=new URL('../artifacts/spoken-feedback-review/',import.meta.url);await mkdir(directory,{recursive:true});
await writeFile(new URL('speech-summary.json',directory),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
