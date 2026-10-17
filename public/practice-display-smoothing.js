// Presentation only. Never feed these filtered coordinates into grading,
// timing, readiness, saved observations, or confidence decisions.
export const DISPLAY_SMOOTHING_RULES = Object.freeze({
  version:'adaptive-display-smoothing-v1',
  handMinCutoffHz:1.2,
  footMinCutoffHz:0.8,
  beta:8,
  derivativeCutoffHz:1,
  maximumGapMs:300,
});

const DEFAULT_INDICES = [33,34,35,36];
const alpha = (cutoff,dt) => dt/(dt+1/(2*Math.PI*cutoff));
const cloneSample = sample => sample == null ? null : ({
  ...sample,
  landmarks:Array.isArray(sample.landmarks) ? sample.landmarks.map(point=>({...point})) : [],
});

export function createDisplaySmoother({indices=DEFAULT_INDICES,minimumVisibility=0.45}={}) {
  const selected=indices===null ? null : new Set(indices);
  const history=new Map();
  let lastTime=null,lastAspect=null,lastContext;
  function reset(){history.clear();lastTime=null;lastAspect=null;lastContext=undefined;}
  function trusted(point){
    return Number.isFinite(point.x)&&point.x>=0&&point.x<=1
      &&Number.isFinite(point.y)&&point.y>=0&&point.y<=1
      &&Number.isFinite(point.visibility)&&point.visibility>=minimumVisibility&&point.visibility<=1
      &&(point.presence===undefined||(Number.isFinite(point.presence)
        &&point.presence>=minimumVisibility&&point.presence<=1));
  }
  function update(sample,{aspect=1,contextKey=null,timestampMs=sample?.tMs}={}) {
    const shown=cloneSample(sample);
    if(!sample||sample.status!=='pose'||!Array.isArray(sample.landmarks)){
      reset();return shown;
    }
    if(!Number.isFinite(timestampMs)||!Number.isFinite(aspect)||aspect<=0){
      reset();return shown;
    }
    if(lastTime!==null&&(contextKey!==lastContext||aspect!==lastAspect
      ||timestampMs<lastTime||timestampMs-lastTime>DISPLAY_SMOOTHING_RULES.maximumGapMs))reset();
    lastTime=timestampMs;lastAspect=aspect;lastContext=contextKey;
    const counts=new Map();
    for(const point of sample.landmarks)counts.set(point.index,(counts.get(point.index)||0)+1);
    // Missing and untrusted identities lose their history immediately; a
    // recovered point starts at its actual observation without a warmup gate.
    for(const index of history.keys())if(!counts.has(index))history.delete(index);
    for(const point of shown.landmarks){
      const index=point.index;
      if(selected&&!selected.has(index))continue;
      if(!Number.isInteger(index)||counts.get(index)!==1||!trusted(point)){
        history.delete(index);continue;
      }
      const rawX=point.x*aspect,rawY=point.y,previous=history.get(index);
      if(!previous){
        history.set(index,{time:timestampMs,rawX,rawY,x:rawX,y:rawY,dx:0,dy:0});continue;
      }
      const dt=(timestampMs-previous.time)/1000;
      if(dt>0){
        const derivativeAlpha=alpha(DISPLAY_SMOOTHING_RULES.derivativeCutoffHz,dt);
        const dx=previous.dx+derivativeAlpha*((rawX-previous.rawX)/dt-previous.dx);
        const dy=previous.dy+derivativeAlpha*((rawY-previous.rawY)/dt-previous.dy);
        const minimumCutoff=index===35||index===36
          ?DISPLAY_SMOOTHING_RULES.footMinCutoffHz:DISPLAY_SMOOTHING_RULES.handMinCutoffHz;
        const positionAlpha=alpha(minimumCutoff+DISPLAY_SMOOTHING_RULES.beta*Math.hypot(dx,dy),dt);
        previous.x+=positionAlpha*(rawX-previous.x);previous.y+=positionAlpha*(rawY-previous.y);
        Object.assign(previous,{time:timestampMs,rawX,rawY,dx,dy});
      }
      // Same-timestamp canvas redraws reuse the result rather than applying
      // another filter step or inventing extra movement between observations.
      point.x=previous.x/aspect;point.y=previous.y;
    }
    return shown;
  }
  return {update,reset,version:DISPLAY_SMOOTHING_RULES.version};
}
