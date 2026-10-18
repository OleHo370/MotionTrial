'use client';
import { useEffect, useRef, useState } from 'react';
import { useHomeMotion } from './HomeMotion';
import { createInkSurface, type InkKind, type Playback } from './ink-material';

/** Illustration only. Pointer coordinates remain ephemeral and local. */
export default function InkSurface({ kind, active=true, mode=0 }: { kind:InkKind; active?:boolean; mode?:number }) {
  const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const renderer=useRef<ReturnType<typeof createInkSurface>|null>(null);
  const gesture=useRef<HTMLButtonElement>(null),cancelGesture=useRef<()=>void>(()=>{});
  const motion=useHomeMotion();
  const controls=useRef<Playback>({visible:false,active,mode,paused:motion.paused,reduced:motion.reduced});
  const intersecting=useRef(false);
  const synchronize=useRef<()=>void>(()=>{});
  const [status,setStatus]=useState('pending');
  const [impression,setImpression]=useState(0);
  useEffect(()=>{
    let disposed=false,failed=false;
    if(!canvas.current||!host.current)return;
    const target=host.current;
    setStatus('pending');
    const fail=()=>{failed=true;renderer.current?.dispose();renderer.current=null;if(!disposed)setStatus('fallback');};
    try {
      const seed=new Uint32Array(1);crypto.getRandomValues(seed);
      const resize=()=>{const rect=target.getBoundingClientRect();renderer.current?.resize(rect.width,rect.height);};
      const c=canvas.current;
      synchronize.current=()=>{
        if(disposed||failed)return;
        try{
          if(!renderer.current&&controls.current.visible&&controls.current.active){
            const next=createInkSurface(c,kind,seed[0]);renderer.current=next;resize();
            next.ready.then(()=>{if(!disposed&&!failed&&renderer.current===next){next.setPlayback(controls.current);setStatus('ready');}}).catch(()=>{if(!disposed)fail();});
          }
          renderer.current?.setPlayback(controls.current);
        }catch{fail();}
      };
      const ro=new ResizeObserver(resize);ro.observe(target);
      const io=new IntersectionObserver(([entry])=>{
        intersecting.current=entry.isIntersecting;
        controls.current={...controls.current,visible:entry.isIntersecting&&!document.hidden};
        if(!controls.current.visible)cancelGesture.current();
        synchronize.current();
      },{threshold:0});io.observe(target);
      const lost=(event:Event)=>{event.preventDefault();fail();};
      canvas.current.addEventListener('webglcontextlost',lost);
      const interactionTarget=kind==='hero'?target.closest('.home-cover'):target.parentElement;
      const stir=(event:Event)=>{const pointer=event as PointerEvent;if(pointer.pointerType==='touch')return;const rect=target.getBoundingClientRect();renderer.current?.interact((pointer.clientX-rect.left)/rect.width,(pointer.clientY-rect.top)/rect.height);};
      interactionTarget?.addEventListener('pointermove',stir,{passive:true});
      const pad=gesture.current;
      let contact:{id:number;x:number;y:number;lastX:number;lastY:number;touch:boolean;started:boolean}|null=null;
      const canStir=()=>{const s=controls.current;return !!renderer.current&&s.active&&s.visible&&!s.paused&&!s.reduced;};
      const release=(cancel=false)=>{
        if(!contact)return;
        const id=contact.id;contact=null;target.dataset.dragging='false';
        renderer.current?.endDrag(cancel);
        if(pad?.hasPointerCapture(id))pad.releasePointerCapture(id);
      };
      cancelGesture.current=()=>release(true);
      const down=(event:PointerEvent)=>{
        if(!canStir()||!event.isPrimary||event.button!==0)return;
        contact={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,touch:event.pointerType==='touch',started:false};
      };
      const move=(event:PointerEvent)=>{
        if(!contact||event.pointerId!==contact.id)return;
        if(!canStir()){release(true);return;}
        const dx=event.clientX-contact.x,dy=event.clientY-contact.y;
        if(!contact.started){
          // A vertical touch belongs to the page. Only a deliberate sideways
          // gesture starts stirring; pan-y and pinch zoom remain native.
          if(contact.touch&&Math.abs(dy)>Math.abs(dx)*1.15&&Math.abs(dy)>6){release(true);return;}
          if(Math.hypot(dx,dy)<6)return;
          contact.started=true;pad?.setPointerCapture(event.pointerId);
          target.dataset.dragging='true';renderer.current?.beginDrag();
        }
        const rect=target.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
        const px=contact.lastX-cx,py=contact.lastY-cy,nx=event.clientX-cx,ny=event.clientY-cy;
        let delta=(event.clientX-contact.lastX)/rect.width*3.;
        if(!contact.touch&&Math.min(Math.hypot(px,py),Math.hypot(nx,ny))>rect.width*.10){
          delta=Math.atan2(ny,nx)-Math.atan2(py,px);
          delta=Math.atan2(Math.sin(delta),Math.cos(delta));
        }
        renderer.current?.drag(delta);
        contact.lastX=event.clientX;contact.lastY=event.clientY;
      };
      const up=(event:PointerEvent)=>{if(event.pointerId===contact?.id)release();};
      const cancel=()=>release(true);
      const key=(event:KeyboardEvent)=>{
        if(!canStir())return;
        if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();renderer.current?.nudge(event.key==='ArrowLeft'?-1:1);}
        if(event.key==='Escape'){event.preventDefault();release(true);renderer.current?.endDrag(true);}
      };
      pad?.addEventListener('pointerdown',down);pad?.addEventListener('pointermove',move);
      pad?.addEventListener('pointerup',up);pad?.addEventListener('pointercancel',cancel);pad?.addEventListener('lostpointercapture',cancel);
      pad?.addEventListener('keydown',key);
      return()=>{
        disposed=true;cancelGesture.current();cancelGesture.current=()=>{};synchronize.current=()=>{};
        io.disconnect();ro.disconnect();c.removeEventListener('webglcontextlost',lost);interactionTarget?.removeEventListener('pointermove',stir);
        pad?.removeEventListener('pointerdown',down);pad?.removeEventListener('pointermove',move);pad?.removeEventListener('pointerup',up);
        pad?.removeEventListener('pointercancel',cancel);pad?.removeEventListener('lostpointercapture',cancel);pad?.removeEventListener('keydown',key);
        renderer.current?.dispose();renderer.current=null;
      };
    } catch {fail();}
    return()=>{disposed=true;renderer.current?.dispose();renderer.current=null;};
  },[kind,impression]);
  useEffect(()=>{
    // Explicit selection can precede the observer's first delivery after a jump.
    // Recheck the real rectangle on selection rather than leave a blank field.
    if(active&&host.current){const r=host.current.getBoundingClientRect();intersecting.current=r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}
    controls.current={visible:intersecting.current&&motion.visible,active,mode,paused:motion.paused,reduced:motion.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches};
    if(!controls.current.active||!controls.current.visible||controls.current.paused||controls.current.reduced)cancelGesture.current();
    synchronize.current();
  },[active,mode,motion.paused,motion.reduced,motion.visible]);
  return <div ref={host} className={'ink-surface ink-surface-'+kind} data-ink-status={status} data-active={active} data-mode={mode} data-impression={impression}>
    <img className="ink-surface-fallback" src={'/qi-mirror/landing-art/ink-'+kind+(kind==='rhythm'&&mode===0?'-guided':'')+'.png'} alt="" loading={kind==='hero'?'eager':'lazy'} />
    <canvas ref={canvas} className="ink-surface-canvas" aria-hidden="true" />
    {kind==='wheel'&&<button ref={gesture} type="button" className="ink-gesture" hidden={!active||status!=='ready'||motion.reduced} aria-disabled={motion.paused} aria-label="Stir the ink" aria-description="Drag sideways or use the left and right arrow keys. Release to let the ink settle." onClick={event=>{if(event.detail===0)renderer.current?.nudge(1);}} />}
    {kind==='wheel'&&active&&status==='ready'&&!motion.paused&&!motion.reduced&&<span className="ink-gesture-hint" aria-hidden="true">Drag to stir</span>}
    {kind!=='hero'&&active&&<button type="button" className="ink-replay" aria-disabled={status!=='ready'} aria-label={'Create another '+(kind==='rhythm'?'rhythm':kind==='culture'?'ink impression':'ink pattern')} onClick={()=>{if(status==='ready')setImpression(n=>n+1);}}><span>New ink</span><span aria-hidden="true">↻</span></button>}
  </div>;
}
