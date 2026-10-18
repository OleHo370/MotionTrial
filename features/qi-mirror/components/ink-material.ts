/** Original spatial pigment artwork: seeded material flow, translucent deposits,
 * paper-fringe absorption and bounded formation. An artistic model, not a fluid solver.
 * No body input is used. Paused, hidden and settled surfaces submit no frames. */
export type InkKind='hero'|'culture'|'wheel'|'rhythm';
export type Playback={visible:boolean;active:boolean;paused:boolean;reduced:boolean;mode:number};
export function dimensions(kind:InkKind):[number,number]{return kind==='hero'?[1440,900]:kind==='rhythm'?[680,420]:kind==='wheel'?[560,560]:[600,600];}

export const inkNoiseGL=`
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32+seed);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
float fbm(vec2 p){float n=0.,a=.56;mat2 r=mat2(.8,-.6,.6,.8);for(int i=0;i<4;i++){n+=noise(p)*a;p=r*p*2.03+17.1;a*=.47;}return n;}
`;
const flatVertex=`#version 300 es
in vec2 position;out vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const coverFragment=`#version 300 es
precision highp float;
in vec2 uv;out vec4 outColor;
uniform vec2 resolution,pointer;
uniform float seed,progress,impulse;
uniform sampler2D artwork;
uniform vec3 pigment,secondary;
${inkNoiseGL}
float rnd(float n){return hash(vec2(n*1.731+8.4,n*.317+2.8));}
mat2 rotation(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
vec4 bloom(vec2 coord,bool lower){
 float side=lower?0.:27.;
 float aspect=resolution.x/resolution.y;
 float deviceScale=min(1.,aspect/.86);
 vec2 center=lower?vec2(.095,1.015):vec2(.935,-.065);
 vec2 local=(coord-center)*vec2(aspect,1.);
 float angle=(lower?-.18:2.89)+(rnd(3.+side)-.5)*.22;
 vec2 size=vec2(1.08,.72)*deviceScale*(lower?1.:.88)*(.96+rnd(2.+side)*.08);
 vec2 p=rotation(angle)*local/size+.5;
 if(any(lessThan(p,vec2(0.)))||any(greaterThan(p,vec2(1.))))return vec4(0.);
 // Preserve the cloud's open volume; never pinch its texture into a polar fan.
 vec2 bend=vec2(fbm(p*4.+side+9.),fbm(p*4.+side+37.))-.46;
 p+=bend*.032;
 vec4 ink=texture(artwork,p);
 vec2 texel=1./vec2(textureSize(artwork,0));
 vec4 water=(texture(artwork,p+texel*5.)+texture(artwork,p-texel*5.)+texture(artwork,p+vec2(texel.x,-texel.y)*5.)+texture(artwork,p+vec2(-texel.x,texel.y)*5.))*.25;
 vec2 origin=lower?vec2(.035,.974):vec2(.972,.022);
 vec2 drop=(coord-origin)*vec2(aspect,1.);
 float paper=fbm(drop*38.+side),drift=fbm(drop*9.+side);
 float distanceToDrop=length(drop)/deviceScale;
 float travel=max(0.,distanceToDrop+(drift-.46)*.040+(paper-.46)*.009);
 float age=progress-pow(travel/(lower?.60:.51),1.42)*.90;
 float wet=smoothstep(-.055,.07,age),settled=smoothstep(.02,.28,age);
 vec4 material=mix(water,ink,settled);
 float tone=clamp(dot(material.rgb,vec3(.2126,.7152,.0722)),0.,1.);
 vec3 color=mix(secondary*.92,mix(secondary,vec3(.93,.95,.92),.80),smoothstep(.28,.95,tone));
 float alpha=material.a*wet*mix(.32,1.,settled)*(.18+.55*(1.-tone));
 // Quietly feather the page-facing edge, away from the headline and controls.
 float radial=length(local/size*vec2(1.5,1.8));
 alpha*=1.-smoothstep(.69,1.05,radial);
 return vec4(color*alpha,alpha)*(lower?1.:.77);
}
void main(){
 vec2 coord=vec2(uv.x,1.-uv.y);
 // A shallow, uneven drift opens the mist's layers without a rotating funnel.
 // Zero input follows the exact original sample path, so rest never drifts.
 vec2 sampleAt=coord;
 float touch=0.;
 if(impulse>0.){
  float aspect=resolution.x/resolution.y;
  vec2 delta=(coord-pointer)*vec2(aspect,1.);
  touch=impulse*exp(-dot(delta,delta)*24.);
  vec2 drift=vec2(fbm(coord*9.+pointer*3.),fbm(coord*14.+17.))-.47;
  sampleAt+=(drift*.012+vec2(-delta.y,delta.x)*.018)*touch/vec2(aspect,1.);
 }
 vec4 lower=bloom(sampleAt,true),upper=bloom(sampleAt,false);
 if(impulse>0.){
  float grain=fbm(coord*46.+13.);
  lower*=1.+touch*(grain-.45)*.22;
  upper*=1.-touch*(grain-.45)*.16;
 }
 float clearCenter=smoothstep(1.,1.45,length((coord-vec2(.5))/vec2(.26)));
 outColor=(lower+upper*(1.-lower.a))*smoothstep(0.,.035,progress)*clearCenter;
}`;

// The approved A material is AI generated. The local reveal, seeded deformation,
// density changes and depth-dependent pointer response below are original code.
// This is a bounded 2.5D material treatment, not a physical fluid simulation.
const materialFragment=`#version 300 es
precision highp float;
precision highp int;
in vec2 uv;out vec4 outColor;
uniform sampler2D artwork;
uniform vec2 resolution,pointer;
uniform float seed,progress,clock,impulse,dark,turnOffset,turnEnergy;
uniform int kind,mode;
uniform vec3 pigment,secondary,accent;
${inkNoiseGL}
float rnd(float n){return hash(vec2(n*1.731+8.4,n*.317+2.8));}
mat2 rotation(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float luminance(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
void main(){
 vec2 p=vec2(uv.x,1.-uv.y);
 float aspect=resolution.x/resolution.y,artAspect=kind==3?2.04:1.;
 vec2 fit=vec2(aspect/artAspect,1.)*max(1.,artAspect/aspect);
 p=(p-.5)*fit+.5;
 float scale=kind==3?.96:kind==2?.64:.87;
 p=(p-.5)/scale+.5;
 vec2 original=p;
 // A fresh seed changes the composition, not only its starting opacity.
 float turn=(rnd(3.)-.5)*(kind==3?.12:.36)+(kind==2?turnOffset:0.);
 p=rotation(turn)*(p-.5)*vec2(.93+rnd(5.)*.14,.94+rnd(7.)*.12)+.5;
 vec2 q=p-.5;
 float angle=atan(q.y,q.x),radius=length(q);
 vec2 bend=vec2(fbm(p*3.4+17.),fbm(p*3.4+61.))-.46;
 p+=bend*.095;
 p+=vec2(sin(p.y*7.+seed),cos(p.x*8.+seed))*.009;
 vec4 base=texture(artwork,p);
 float height=luminance(base.rgb);
 // The pigment's light folds and shadow layers respond at different depths.
 vec2 nearPointer=(pointer-.5)*fit;
 float pointerReach=exp(-dot(original-pointer,original-pointer)*11.);
 vec2 parallax=nearPointer*(height-.35)*impulse*.026*pointerReach;
 float forming=sin(progress*3.14159265);
 vec2 tangent=normalize(vec2(-q.y,q.x)+vec2(.0001));
 if(kind==2)p+=tangent*sin(radius*17.+angle*2.-turnOffset)*turnEnergy*.022;
 vec2 localFlow=kind==3?vec2(1.,sin(p.x*7.+seed)*.35):tangent;
 float flowNoise=fbm(p*7.+vec2(clock*.10,-clock*.05));
 p+=localFlow*(flowNoise-.48)*.042*forming+parallax;
 p+=(1.-progress)*localFlow*.024*sin(radius*15.+seed);
 vec4 ink=texture(artwork,p);
 float paper=fbm(original*32.+seed*.11);
 float structure=fbm(original*5.+seed*.21);
 float journey;
 if(kind==3){journey=min(length((original-vec2(.11,.62))*vec2(.88,1.1)),length((original-vec2(.86,.34))*vec2(1.,1.2)));}
 else {journey=min(length(original-vec2(.25,.73)),length(original-vec2(.77,.25))*.98);}
 // Two uneven absorption fronts spread through the artwork, leaving a wetter
 // diluted edge before the dense pigment settles. The substrate is fixed.
 float arrival=pow(journey,1.25)*1.28+(paper-.46)*.17+(structure-.42)*.12;
 float age=progress-arrival;
 float wet=smoothstep(-.075,.075,age);
 float settled=smoothstep(.015,.28,age);
 vec2 texel=1./vec2(textureSize(artwork,0));
 vec4 dilute=(texture(artwork,p+texel*2.4)+texture(artwork,p-texel*2.4)+texture(artwork,p+vec2(texel.x,-texel.y)*2.4)+texture(artwork,p+vec2(-texel.x,texel.y)*2.4))*.25;
 float density=.83+structure*.27;
 vec4 material=mix(dilute,ink,settled);
 float alpha=material.a*wet*mix(.35,1.,settled)*density;
 if(kind!=3)alpha*=smoothstep(kind==2?.15:.13,kind==2?.185:.18,length(original-.5));
 if(kind==3&&mode==0){float selected=smoothstep(.21,.32,original.x)*(1.-smoothstep(.67,.78,original.x));alpha*=mix(.24,1.,selected);}
 vec3 color=material.rgb;
 // Preserve the approved warm folds while integrating the site's sage palette.
 float pale=smoothstep(.35,.90,luminance(color));
 vec3 tint=mix(secondary,pigment,pale);
 color=mix(color,color*mix(vec3(1.),tint/.83,.36),.45);
 color*=.95+rnd(9.)*.10;
 if(dark<.5){float tone=pow(clamp(luminance(material.rgb),0.,1.),.65);color=mix(secondary,pigment,tone);alpha*=.52+tone*.48;}
 if(kind==2){
  // Dark depth becomes transparency, with every deposit in the sage family.
  // This keeps the background visible instead of painting black folds onto it.
  float tone=pow(clamp(luminance(material.rgb),0.,1.),.65);
  color=mix(secondary,mix(secondary,pigment,.63),tone);
  float screenRadius=length((vec2(uv.x,1.-uv.y)-.5)*fit);
  alpha*=mix(.10,.47,smoothstep(.12,.88,tone))*smoothstep(.153,.185,screenRadius)*(1.-smoothstep(.32,.37,screenRadius));
 }
 alpha=clamp(alpha,0.,1.)*smoothstep(0.,.035,progress);
 outColor=vec4(color*alpha,alpha);
}`;

type RGB=[number,number,number];
function rgb(value:string,fallback:RGB):RGB{const m=/^#([0-9a-f]{6})$/i.exec(value.trim());return m?[parseInt(m[1].slice(0,2),16)/255,parseInt(m[1].slice(2,4),16)/255,parseInt(m[1].slice(4,6),16)/255]:fallback;}

export function createInkSurface(canvas:HTMLCanvasElement,kind:InkKind,seedValue:number,assetSource?:string){
 const start=performance.now();
 const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
 if(!gl)throw new Error('WebGL2 unavailable; static ink retained');
 const shaders:WebGLShader[]=[];
 function shader(type:number,source:string){const s=gl!.createShader(type);if(!s)throw new Error('Ink shader allocation');shaders.push(s);gl!.shaderSource(s,source);gl!.compileShader(s);if(!gl!.getShaderParameter(s,gl!.COMPILE_STATUS))throw new Error(gl!.getShaderInfoLog(s)||'Ink shader compilation');return s;}
 const program=gl.createProgram(),buffer=gl.createBuffer(),texture=gl.createTexture();if(!program||!buffer||!texture)throw new Error('Ink field allocation');
 const release=()=>{shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);gl.deleteBuffer(buffer);gl.deleteTexture(texture);};
 try{gl.attachShader(program,shader(gl.VERTEX_SHADER,flatVertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,kind==='hero'?coverFragment:materialFragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Ink field linking');}catch(error){release();throw error;}
 gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 const uniforms=Object.fromEntries(['resolution','seed','progress','clock','impulse','pointer','kind','mode','pigment','secondary','accent','artwork','dark','turnOffset','turnEnergy'].map(name=>[name,gl.getUniformLocation(program,name)]));
 gl.uniform1f(uniforms.seed,seedValue%8191/97);gl.uniform1i(uniforms.kind,['hero','culture','wheel','rhythm'].indexOf(kind));
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(uniforms.artwork,0);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 let state:Playback={visible:false,active:true,paused:false,reduced:false,mode:0};
 let elapsed=0,last=0,frame=0,frames=0,disposed=false,complete=false,width=0,height=0,hover=0,loaded=false;
 let turn=0,velocity=0,energy=0,dragging=false;
 let mouse:[number,number]=[.5,.5];const duration=kind==='hero'?3600:kind==='wheel'?3400:kind==='rhythm'?3200:3400;
 let palette={dark:1,pigment:[.89,.89,.83] as RGB,secondary:[.53,.61,.57] as RGB,accent:[.72,.77,.70] as RGB};
 canvas.dataset.seed=String(seedValue);canvas.dataset.engine=kind==='hero'?'radial-mist-ink':'spatial-material-ink';canvas.dataset.materialMs=(performance.now()-start).toFixed(1);
 function colors(){const style=getComputedStyle(canvas);palette={dark:style.getPropertyValue('--ink-on-dark').trim()==='0'?0:1,pigment:rgb(style.getPropertyValue('--ink-primary'),[.89,.89,.83]),secondary:rgb(style.getPropertyValue('--ink-secondary'),[.53,.61,.57]),accent:rgb(style.getPropertyValue('--ink-accent'),[.72,.77,.70])};}
 function render(){
  if(disposed||!loaded||!width||!height)return;
  gl!.useProgram(program);gl!.viewport(0,0,canvas.width,canvas.height);gl!.uniform2f(uniforms.resolution,width,height);
  gl!.uniform1f(uniforms.progress,complete?1:Math.min(1,elapsed/duration));gl!.uniform1f(uniforms.clock,elapsed/1000);gl!.uniform1f(uniforms.impulse,hover);gl!.uniform2f(uniforms.pointer,...mouse);gl!.uniform1i(uniforms.mode,state.mode);
  gl!.uniform3f(uniforms.pigment,...palette.pigment);gl!.uniform3f(uniforms.secondary,...palette.secondary);gl!.uniform3f(uniforms.accent,...palette.accent);
  gl!.uniform1f(uniforms.dark,palette.dark);gl!.uniform1f(uniforms.turnOffset,turn);gl!.uniform1f(uniforms.turnEnergy,energy);
  canvas.dataset.turn=turn.toFixed(4);canvas.dataset.energy=energy.toFixed(4);canvas.dataset.impulse=hover.toFixed(4);
  gl!.drawArrays(gl!.TRIANGLES,0,3);canvas.dataset.frames=String(++frames);canvas.dataset.progress=(complete?1:Math.min(1,elapsed/duration)).toFixed(3);
 }
 function stop(){cancelAnimationFrame(frame);frame=0;last=0;}
 function atRest(){return complete&&hover===0&&velocity===0&&energy===0;}
 function allowed(){return !disposed&&loaded&&state.visible&&state.active&&!state.paused&&!state.reduced;}
 function respond(){if(!frame){canvas.dataset.state='responding';frame=requestAnimationFrame(tick);}}
 let lastDrag=0;
 function tick(now:number){
  frame=0;if(disposed)return;if(last&&now-last<15){frame=requestAnimationFrame(tick);return;}const dt=last?Math.min(50,now-last):0;last=now;
  if(!complete){elapsed+=dt;if(elapsed>=duration){complete=true;elapsed=duration;}}
  hover=Math.max(0,hover-dt/(kind==='hero'?1900:1300));
  if(!dragging){turn=(turn+velocity*dt/1000)%(Math.PI*2);velocity*=Math.exp(-dt/420);if(Math.abs(velocity)<.002)velocity=0;}
  else if(now-lastDrag>90)velocity=0;
  energy=Math.max(0,energy-dt/1100);render();
  if(atRest()){canvas.dataset.state='settled';last=0;}else frame=requestAnimationFrame(tick);
 }
 function update(){
  stop();if(disposed)return;if(!state.active||!state.visible){canvas.dataset.state='suspended';return;}if(!loaded){canvas.dataset.state='loading';return;}
  if(state.reduced||(state.paused&&elapsed===0)){complete=true;elapsed=duration;hover=0;velocity=0;energy=0;}render();
  if(atRest()){canvas.dataset.state='settled';return;}if(state.paused){canvas.dataset.state='paused';return;}
  canvas.dataset.state='drawing';frame=requestAnimationFrame(tick);
 }
 let image:HTMLImageElement|undefined;
 const ready=new Promise<void>((resolve,reject)=>{
  image=new Image();image.decoding='async';image.onload=()=>{
   if(disposed){resolve();return;}
   try{gl!.activeTexture(gl!.TEXTURE0);gl!.bindTexture(gl!.TEXTURE_2D,texture);gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl!.texImage2D(gl!.TEXTURE_2D,0,gl!.RGBA,gl!.RGBA,gl!.UNSIGNED_BYTE,image!);loaded=true;canvas.dataset.assetMs=(performance.now()-start).toFixed(1);update();resolve();}catch(error){reject(error);}
  };image.onerror=()=>reject(new Error('Ink material unavailable; static ink retained'));image.src=assetSource||'/qi-mirror/landing-art/ink-sculpture-'+(kind==='hero'?'mist':kind)+'.webp';
 });
 return{
  ready,
  setPlayback(next:Playback){
   if((next.active&&!state.active)||next.mode!==state.mode){elapsed=0;complete=false;hover=0;turn=0;}
   if(!next.active||!next.visible||next.paused||next.reduced){dragging=false;velocity=0;energy=0;}
   state=next;update();
  },
  resize(w:number,h:number){width=w;height=h;colors();const dpr=Math.min(window.devicePixelRatio||1,1.5,Math.sqrt(1200000/Math.max(1,w*h)));canvas.width=Math.max(1,Math.ceil(w*dpr));canvas.height=Math.max(1,Math.ceil(h*dpr));render();},
  interact(x:number,y:number){if(!allowed())return;mouse=[x,y];hover=kind==='hero'?.38:.85;respond();},
  beginDrag(){if(!allowed()||kind!=='wheel')return;dragging=true;velocity=0;lastDrag=performance.now();},
  drag(delta:number){
   if(!allowed()||!dragging)return;
   const now=performance.now(),dt=Math.max(16,now-lastDrag),step=Math.max(-.14,Math.min(.14,delta));
   turn=(turn+step)%(Math.PI*2);velocity=Math.max(-.9,Math.min(.9,step*1000/dt))*.65+velocity*.35;
   energy=Math.min(.8,energy+Math.abs(step)*3.);lastDrag=now;respond();
  },
  endDrag(cancel=false){
   dragging=false;
   if(cancel){velocity=0;energy=0;hover=0;}
   else if(performance.now()-lastDrag>100)velocity=0;
   if(allowed())respond();
  },
  nudge(direction:number){if(!allowed()||kind!=='wheel')return;turn+=direction*.055;velocity=direction*.65;energy=.45;respond();},
  dispose(){disposed=true;stop();if(image){image.onload=null;image.onerror=null;image.src='';}release();canvas.width=0;canvas.height=0;},
 };
}
