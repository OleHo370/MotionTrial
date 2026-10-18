'use client';
import { useEffect, useRef } from 'react';
import { useHomeMotion } from './HomeMotion';
import { createInkLettering, inkMarkShapes, type LetteringKind } from './ink-lettering';

function BrushMark({kind}:{kind:LetteringKind}) {
  const host=useRef<HTMLSpanElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const motion=useHomeMotion(),control=useRef(motion),synchronize=useRef(()=>{});
  control.current=motion;
  const shape=inkMarkShapes[kind];
  useEffect(()=>{
    const element=host.current,c=canvas.current;if(!element||!c)return;
    let renderer:ReturnType<typeof createInkLettering>|undefined,intersecting=false,failed=false;
    const fail=()=>{failed=true;renderer?.dispose();renderer=undefined;element.dataset.inkMark='fallback';};
    const sync=()=>{
      if(failed)return;
      try{
        if(!renderer&&intersecting&&control.current.visible){renderer=createInkLettering(c,kind);resize();element.dataset.inkMark='ready';}
        renderer?.setPlayback({visible:intersecting&&control.current.visible,paused:control.current.paused,reduced:control.current.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches});
      }catch{fail();}
    };
    const resize=()=>{const r=element.getBoundingClientRect();renderer?.resize(r.width,r.height);};
    synchronize.current=sync;
    const ro=new ResizeObserver(resize);ro.observe(element);
    const io=new IntersectionObserver(([entry])=>{intersecting=entry.isIntersecting;sync();});io.observe(element);
    const move=(e:PointerEvent)=>{if(e.pointerType==='touch')return;const r=element.getBoundingClientRect();renderer?.interact((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height,e.movementX,e.movementY);};
    const lost=(e:Event)=>{e.preventDefault();fail();};
    element.addEventListener('pointermove',move,{passive:true});c.addEventListener('webglcontextlost',lost);
    return()=>{ro.disconnect();io.disconnect();element.removeEventListener('pointermove',move);c.removeEventListener('webglcontextlost',lost);synchronize.current=()=>{};renderer?.dispose();};
  },[kind]);
  useEffect(()=>synchronize.current(),[motion.paused,motion.reduced,motion.visible]);
  return <span ref={host} className={'home-'+kind+'-mark home-brush-mark'} aria-hidden="true">
    <svg className="home-brush-fallback" viewBox={`0 0 ${shape.width} ${shape.height}`}><path d={shape.paths.join('')} fill="currentColor" fillRule="evenodd"/></svg>
    <canvas ref={canvas} className="home-brush-canvas" />
  </span>;
}
export default function HomeInkMark(){return <h1 id="home-title" className="home-title" aria-label="Qi Mirror"><BrushMark kind="qi"/><BrushMark kind="mirror"/></h1>;}
