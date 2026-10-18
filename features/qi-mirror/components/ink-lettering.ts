import { inkMarkShapes } from './ink-mark-shapes';
import { inkNoiseGL } from './ink-material';
export type LetteringKind = keyof typeof inkMarkShapes;
export type MarkPlayback = {visible:boolean;paused:boolean;reduced:boolean};
export { inkMarkShapes };

const vertex=`#version 300 es
in vec2 position;out vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment=`#version 300 es
precision highp float;
in vec2 uv;out vec4 outColor;
uniform sampler2D silhouette;
uniform vec2 resolution,pointer,trail,velocity;
uniform float seed,progress,energy,word;
${inkNoiseGL}
float mask(vec2 p){return texture(silhouette,p).a;}
void main(){
 vec2 coord=vec2(uv.x,1.-uv.y);
 float aspect=resolution.x/resolution.y;
 vec2 ratio=vec2(aspect,1.);
 vec2 p=coord;
 float touch=0.,wake=0.;
 // The hand disturbs pigment, not the whole letter. Two settling speeds leave
 // a soft capillary edge behind the finer, directional grain response.
 if(energy>0.){
  vec2 delta=(coord-pointer)*ratio,after=(coord-trail)*ratio;
  touch=energy*exp(-dot(delta,delta)*38.);
  wake=energy*exp(-dot(after,after)*25.);
  vec2 grainFlow=vec2(noise(coord*37.+19.),noise(coord*53.+61.))-.5;
  p-=(velocity*.0028+grainFlow*.0032)*touch/ratio;
 }
 float forming=sin(progress*3.14159265);
 vec2 fiber=vec2(fbm(p*11.+15.),fbm(p*11.+73.))-.47;
 p+=fiber*.006*forming;
 float body=mask(p);
 vec2 texel=1./vec2(textureSize(silhouette,0));
 float water=(mask(p+texel*2.5)+mask(p-texel*2.5)+mask(p+vec2(texel.x,-texel.y)*2.5)+mask(p+vec2(-texel.x,texel.y)*2.5))*.25;
 float paper=fbm(p*vec2(260.,320.)+velocity*touch*.85),deposit=fbm(p*31.+9.);
 float journey=mix(p.y*.79+(1.-p.x)*.09,p.x*.86+p.y*.035,word);
 float age=progress-journey-(fbm(p*15.)-.45)*.17;
 float wet=smoothstep(-.06,.065,age),settled=smoothstep(.01,.23,age);
 float edge=mix(water,body,settled);
 float dry=smoothstep(.63,.81,fbm(p*vec2(155.,24.)+13.));
 float alpha=edge*wet*(.91+.09*paper)*(1.-dry*.25);
 vec3 ink=mix(vec3(.065,.091,.073),vec3(.18,.22,.19),deposit*.35+paper*.24);
 // A diluted capillary fringe precedes the deep pigment as each area settles.
 ink=mix(vec3(.40,.47,.42),ink,settled);
 alpha*=mix(.30,1.,settled);
 float loose=smoothstep(.34,.72,paper);
 alpha*=1.-touch*(.045+loose*.10);
 ink=mix(ink,vec3(.25,.30,.25),touch*(.10+deposit*.08));
 float veil=0.;
 if(energy>0.){
  vec2 spread=texel*(2.+wake*5.);
  float fringe=(mask(p+spread)+mask(p-spread)+mask(p+vec2(spread.x,-spread.y))+mask(p+vec2(-spread.x,spread.y)))*.25;
  veil=max(0.,fringe-body)*wake*.17;
 }
 outColor=vec4(ink*alpha+vec3(.32,.40,.34)*veil,alpha+veil);
}`;

/** Existing mark silhouettes are vector geometry. Pigment and all deformation
 * are computed locally; no original PNG or captured input is read at runtime. */
export function createInkLettering(canvas:HTMLCanvasElement,kind:LetteringKind){
 const shape=inkMarkShapes[kind];
 const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
 if(!gl)throw Error('Lettering uses its vector fallback without WebGL2');
 const maskCanvas=document.createElement('canvas');
 maskCanvas.width=kind==='qi'?1024:1536;maskCanvas.height=Math.round(maskCanvas.width*shape.height/shape.width);
 const ctx=maskCanvas.getContext('2d');if(!ctx)throw Error('Vector mask unavailable');
 ctx.scale(maskCanvas.width/shape.width,maskCanvas.height/shape.height);
 ctx.fillStyle='#fff';ctx.fill(new Path2D(shape.paths.join('')),'evenodd');
 const shaders:WebGLShader[]=[];
 const program=gl.createProgram(),buffer=gl.createBuffer(),texture=gl.createTexture();
 if(!program||!buffer||!texture)throw Error('Lettering allocation');
 const release=()=>{shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);gl.deleteBuffer(buffer);gl.deleteTexture(texture);};
 try{
  for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const s=gl.createShader(type);if(!s)throw Error('Lettering shader');shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'Lettering compile');gl.attachShader(program,s);}
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Lettering link');
 }catch(error){release();throw error;}
 gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 const u=Object.fromEntries(['resolution','pointer','trail','velocity','seed','progress','energy','word','silhouette'].map(n=>[n,gl.getUniformLocation(program,n)]));
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(u.silhouette,0);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,maskCanvas);maskCanvas.width=0;maskCanvas.height=0;
 gl.uniform1f(u.seed,kind==='qi'?71.39:13.42);gl.uniform1f(u.word,kind==='mirror'?1:0);
 const duration=kind==='qi'?2050:1550,delay=kind==='qi'?80:730;
 let elapsed=0,energy=0,charge=0,frame=0,last=0,frames=0,disposed=false,width=0,height=0;
 let pointer:[number,number]=[.5,.5],velocity:[number,number]=[0,0];
 let target:[number,number]=[.5,.5],trail:[number,number]=[.5,.5],push:[number,number]=[0,0];
 let state:MarkPlayback={visible:false,paused:false,reduced:false};
 const allowed=()=>!disposed&&state.visible&&!state.paused&&!state.reduced;
 const resting=()=>elapsed>=duration+delay&&energy===0&&charge===0;
 canvas.dataset.engine='vector-pigment-ink';
 const render=()=>{
  if(disposed||!width||!height)return;
  gl.useProgram(program);gl.viewport(0,0,canvas.width,canvas.height);
  gl.uniform2f(u.resolution,width,height);gl.uniform2f(u.pointer,...pointer);gl.uniform2f(u.trail,...trail);gl.uniform2f(u.velocity,...velocity);
  const progress=Math.max(0,Math.min(1,(elapsed-delay)/duration));
  gl.uniform1f(u.progress,progress);gl.uniform1f(u.energy,energy);
  gl.drawArrays(gl.TRIANGLES,0,3);
  canvas.dataset.progress=progress.toFixed(3);canvas.dataset.energy=energy.toFixed(3);canvas.dataset.frames=String(++frames);
 };
 const stop=()=>{cancelAnimationFrame(frame);frame=0;last=0;};
 const tick=(now:number)=>{
  frame=0;if(!allowed())return;
  if(last&&now-last<20){frame=requestAnimationFrame(tick);return;}
  const dt=last?Math.min(64,now-last):0;last=now;
  elapsed=Math.min(duration+delay,elapsed+dt);
  const follow=1.-Math.exp(-dt/85),linger=1.-Math.exp(-dt/190);
  for(let i=0;i<2;i++){pointer[i]+=(target[i]-pointer[i])*follow;trail[i]+=(pointer[i]-trail[i])*linger;velocity[i]+=(push[i]-velocity[i])*follow;push[i]*=Math.exp(-dt/150);}
  energy+=(charge-energy)*(1.-Math.exp(-dt/(charge>energy?70:160)));
  charge=Math.max(0,charge-dt/700);
  if(charge===0&&energy<.002){energy=0;velocity=[0,0];push=[0,0];}
  render();
  if(!resting())frame=requestAnimationFrame(tick);else{canvas.dataset.state='settled';last=0;}
 };
 return {
  resize(w:number,h:number){width=w;height=h;const dpr=Math.min(devicePixelRatio||1,1.7,Math.sqrt(450000/Math.max(1,w*h)));canvas.width=Math.max(1,Math.ceil(w*dpr));canvas.height=Math.max(1,Math.ceil(h*dpr));render();},
  setPlayback(next:MarkPlayback){
   stop();state=next;
   if(state.reduced||(state.paused&&elapsed===0)){elapsed=delay+duration;energy=0;charge=0;velocity=[0,0];push=[0,0];}
   if(state.visible)render();
   if(allowed()&&!resting()){canvas.dataset.state='drawing';frame=requestAnimationFrame(tick);}
   else canvas.dataset.state=!state.visible?'suspended':state.paused?'paused':'settled';
  },
  interact(x:number,y:number,dx:number,dy:number){
   if(!allowed())return;
   if(energy===0&&charge===0){pointer=[x,y];trail=[x,y];}
   target=[x,y];push=[Math.max(-1,Math.min(1,dx/28)),Math.max(-1,Math.min(1,dy/28))];
   charge=Math.max(charge,.24+Math.min(1,Math.hypot(dx,dy)/28)*.36);
   canvas.dataset.state='responding';if(!frame)frame=requestAnimationFrame(tick);
  },
  dispose(){disposed=true;stop();release();canvas.width=0;canvas.height=0;},
 };
}
