
import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {OrbitControls} from 'three/addons/controls/OrbitControls.js';import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;document.querySelector(".model").appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=null;const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
const camera=new THREE.PerspectiveCamera(36,innerWidth/innerHeight,.01,100);camera.position.set(4.2,4,7.9);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.57,1.9);controls.enableDamping=true;controls.enablePan=false;controls.minDistance=2.5;controls.maxDistance=14;
function frameAtNativeResolution(){camera.zoom=2.84;const shift=innerWidth<=760?.18:.17;camera.setViewOffset(innerWidth,innerHeight,-innerWidth*shift,0,innerWidth,innerHeight);camera.updateProjectionMatrix();}
frameAtNativeResolution();addEventListener('resize',frameAtNativeResolution);
const focus=new THREE.Vector3(0,1.57,1.9);function softbox(c,i,w,h,x,y,z){const l=new THREE.RectAreaLight(c,i,w,h);l.position.set(x,y,z);l.lookAt(focus);scene.add(l)}softbox(0xffffff,9,5.5,4,-3.5,6,4.5);softbox(0xffffff,6.5,4,3.2,2.8,4.4,-2.3);softbox(0xfff5ea,2,3,2,4,2.8,3);softbox(0xffffff,4,3.5,3.5,-1,5.5,-1);const fill=new THREE.DirectionalLight(0xffffff,.3);fill.position.set(-2,2,4);scene.add(fill);
// Object-space mould texture: stable across UV seams and camera rotation.
function addMouldGrain(m){
 m.onBeforeCompile=shader=>{
 shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 grainPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\ngrainPosition=position;');
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
 varying vec3 grainPosition;
 float grainHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
 float grainNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(grainHash(i),grainHash(i+vec3(1,0,0)),f.x),mix(grainHash(i+vec3(0,1,0)),grainHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(grainHash(i+vec3(0,0,1)),grainHash(i+vec3(1,0,1)),f.x),mix(grainHash(i+vec3(0,1,1)),grainHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
 `).replace('#include <color_fragment>',`#include <color_fragment>
 float grain=grainNoise(grainPosition*210.0);
 diffuseColor.rgb*=mix(.84,1.16,grain);
 `).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
 roughnessFactor=clamp(roughnessFactor+(grain-.5)*.16,.35,.9);
 `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
 vec3 gx=dFdx(-vViewPosition),gy=dFdy(-vViewPosition);
 vec3 gr1=cross(gy,normal),gr2=cross(normal,gx);
 float gd=dot(gx,gr1);
 vec3 gradient=sign(gd)*(dFdx(grain)*gr1+dFdy(grain)*gr2);
 normal=normalize(abs(gd)*normal-.0007*gradient);
 `);
 };
 m.customProgramCacheKey=()=> 'mould-grain-v1';
}
const recMaterials=[];
// Preserve the opening pose while spinning around the crown's top centre.
const presentation=new THREE.Group(),turntable=new THREE.Group();
presentation.position.copy(focus);presentation.rotation.set(-5*Math.PI/180,0,-12*Math.PI/180);
presentation.add(turntable);scene.add(presentation);
let motionStart=null;
const motionBlur={value:0};
function animatePresentation(time){
 if(motionStart===null)return;
 const seconds=(time-motionStart)/1000;
 // Slow only through the first 20°, then hand the final 10° to the fast spin.
 // 20° over 25.2s is two-thirds of the former slow speed.
 const slowDuration=25.2,fastDuration=.675;
 const phase=seconds%(slowDuration+fastDuration);
 // Integrate a smooth velocity pulse: both sections meet at the same nonzero
 // speed and zero acceleration, including the 360 -> 0 loop boundary.
 const slowSpeed=20/slowDuration;
 const t=Math.max(0,(phase-slowDuration)/fastDuration);
 const pulse=t*t*t*(10+t*(-15+6*t));
 const velocityPulse=30*t*t*(1-t)*(1-t);
 motionBlur.value=.006*velocityPulse;
 const degrees=-10+(phase<slowDuration?slowSpeed*phase:20+slowSpeed*(phase-slowDuration)+(340-slowSpeed*fastDuration)*pulse);
 turntable.rotation.y=THREE.MathUtils.degToRad(degrees);
}
let renderFrame=()=>renderer.render(scene,camera);
import {transparentBloom} from './transparent-bloom.js';
renderFrame=transparentBloom(renderer,scene,camera,motionBlur);
const name=m=>String(m.name||'').toLowerCase(),has=(m,...x)=>x.some(a=>name(m).includes(a));
const sceneAssetManager=new THREE.LoadingManager();let sceneReadyDispatched=false;const dispatchSceneReady=()=>{if(sceneReadyDispatched)return;sceneReadyDispatched=true;requestAnimationFrame(()=>requestAnimationFrame(()=>window.dispatchEvent(new Event('ymkw:scene-ready'))));};sceneAssetManager.onLoad=dispatchSceneReady;
new GLTFLoader(sceneAssetManager).load('/home-scene/cap.gltf',g=>{
 const processed=new Map();
 g.scene.traverse(o=>{
  if(!o.isMesh)return;
  const tune=m=>{
   if(processed.has(m))return processed.get(m);
   const original=m;
   if(has(m,'cap / premium')){
    m=new THREE.MeshPhysicalMaterial({name:m.name,map:m.map,normalMap:m.normalMap,side:m.side});
    m.color.setRGB(.45,.45,.435);m.roughnessMap=null;m.roughness=.96;m.metalness=0;
    m.normalScale.set(.24,.24);m.envMapIntensity=.25;m.specularIntensity=.12;
    m.onBeforeCompile=shader=>{
 shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 cottonPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\ncottonPosition=position;');
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 cottonPosition;').replace('#include <map_fragment>',`#include <map_fragment>
 vec2 textile=vec2(cottonPosition.x,cottonPosition.y+cottonPosition.z)*95.0;
 float warp=.5+.5*cos(textile.x*6.283185);
 float weft=.5+.5*cos(textile.y*6.283185);
 float over=mod(floor(textile.x)+floor(textile.y),2.0);
 float thread=mix(warp,weft,over);
 float filterWidth=max(fwidth(textile.x),fwidth(textile.y));
 float weaveVisibility=1.0-smoothstep(.45,1.2,filterWidth);
 diffuseColor.rgb*=mix(1.0,mix(.68,1.35,smoothstep(.1,.85,thread)),weaveVisibility);
 `);
};
m.customProgramCacheKey=()=> 'cotton-weave-v2';m.sheen=.35;m.sheenColor.setRGB(.12,.12,.12);m.sheenRoughness=1;
   }else if(has(m,'stitching','sweatband')){
    m.color.setRGB(.018,.018,.017);m.roughness=.98;m.metalness=0;m.envMapIntensity=.2;
    if('sheen'in m){m.sheen=.1;m.sheenColor.setRGB(.12,.12,.12);m.sheenRoughness=1}
   }else if(has(m,'protective cover glass')){
    m.color.setRGB(1,1,1);m.transmission=1;m.thickness=0;m.ior=1.46;
    m.roughness=.012;m.metalness=0;m.envMapIntensity=.18;m.clearcoat=0;
    m.side=THREE.FrontSide;
   }else if(has(m,'optical glass')){
    m.color.setRGB(.012,.018,.021);m.transmission=0;m.thickness=0;m.ior=1.55;m.iridescence=.28;m.iridescenceIOR=1.32;m.iridescenceThicknessRange=[180,300];
    m.roughness=.045;m.metalness=0;m.envMapIntensity=.22;m.specularIntensity=.35;m.clearcoat=0;m.side=THREE.FrontSide;
   }else if(has(m,'fine injection')){
    m.color.setRGB(.012,.012,.0115);m.roughness=.5;m.metalness=0;m.envMapIntensity=.45;
    if('specularIntensity'in m)m.specularIntensity=.45;addMouldGrain(m);
   }else if(has(m,'silicone','textured side rubber')){
    m.color.setRGB(.012,.012,.012);m.roughness=.82;m.metalness=0;m.envMapIntensity=.25;
   }else if(has(m,'mount')){
    m.color.setRGB(.01,.01,.01);m.roughness=.48;m.metalness=0;m.envMapIntensity=.4;
   }else if(has(m,'matte lens frame')){
    m.color.setRGB(.012,.012,.012);m.roughness=.48;m.metalness=0;m.envMapIntensity=.5;
   }else if(has(m,'internal light baffles')){
    m.color.setRGB(.0015,.0015,.0015);m.roughness=.94;m.metalness=0;m.envMapIntensity=.5;
   }else if(has(m,'machined','hardware','fastener')){
    m.color.setRGB(.035,.035,.035);m.roughness=.3;m.metalness=.65;m.envMapIntensity=.5;
   }else if(has(m,'rear black display')){
    m.color.setRGB(.004,.004,.004);m.roughness=.12;m.envMapIntensity=.5;
   }else if(has(m,'full-colour front lcd')){
    const screenTexture=new THREE.TextureLoader(sceneAssetManager).load('/home-scene/front_display.jpg');screenTexture.colorSpace=THREE.SRGBColorSpace;screenTexture.flipY=false;
    m=new THREE.MeshBasicMaterial({name:m.name,map:screenTexture,color:0xc4c4c4,toneMapped:false,side:THREE.DoubleSide});
   }else if(has(m,'gopro cyan')){
    m.color.setRGB(.008,.12,.18);m.roughness=.85;m.metalness=0;
   }else if(has(m,'blinking red')){
    m.color.setRGB(.3,0,0);m.emissive.setRGB(1,0,0);m.toneMapped=false;recMaterials.push(m);
   }
   m.needsUpdate=true;processed.set(original,m);return m;
  };
  o.material=Array.isArray(o.material)?o.material.map(tune):tune(o.material);
 // Optical assembly gets dedicated finishes, never the moulded body grain.
 if(/convex aspheric/i.test(o.name)){
  o.material=o.material.clone();
  o.material.onBeforeCompile=shader=>{
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 opticalPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nopticalPosition=position;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 opticalPosition;').replace('#include <color_fragment>',`#include <color_fragment>
    float radius=length(opticalPosition.xy);
    float pupil=smoothstep(.26,.34,radius);
    float edge=smoothstep(.78,.98,radius);
    float ring1=1.0-smoothstep(.008,.02,abs(radius-.54));
    float ring2=1.0-smoothstep(.006,.016,abs(radius-.76));
    diffuseColor.rgb=mix(vec3(.0005),vec3(.009,.016,.019),pupil);
    diffuseColor.rgb+=ring1*vec3(.014,.008,.023)+ring2*vec3(.008,.019,.022);
    diffuseColor.rgb*=1.0-edge*.75;
   `).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=.045+edge*.2;').replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\nmaterial.specularColor*=mix(.08,1.0,pupil);');
  };
  o.material.customProgramCacheKey=()=> 'optical-coated-element-v1';
 }
 if(/lens barrel recessed/i.test(o.name)){
  o.material=o.material.clone();o.material.color.setRGB(.005,.005,.005);o.material.roughness=.36;o.material.metalness=.6;
  o.material.onBeforeCompile=shader=>{
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 barrelPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nbarrelPosition=position;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 barrelPosition;').replace('#include <color_fragment>',`#include <color_fragment>
    float radial=length(barrelPosition.xy-vec2(.272,1.737));
    float groove=.5+.5*cos(radial*2100.0);
    float aa=1.0-smoothstep(.0008,.003,fwidth(radial));
    diffuseColor.rgb*=mix(1.0,mix(.4,1.5,groove),aa);
   `);
  };o.material.customProgramCacheKey=()=> 'machined-optical-barrel-v1';
 }
 });
 // Opaque optical backing blocks the textured outer housing behind the lens.
const opticalBacking=new THREE.Mesh(
 new THREE.PlaneGeometry(.465,.47),
 new THREE.MeshBasicMaterial({color:0x030303,side:THREE.DoubleSide})
);
opticalBacking.name='H11 optical smooth black backing';
opticalBacking.position.set(.272,1.737,2.158);
g.scene.add(opticalBacking);
// Enlarge every camera and mount part around the attachment point, including
// detached exported lens meshes. World-preserving attach prevents misalignment.
g.scene.updateMatrixWorld(true);
const assembly=new THREE.Group();assembly.name='GoPro and mount - 125 percent';
assembly.position.set(0,1.11,1.355);g.scene.add(assembly);g.scene.updateMatrixWorld(true);
const parts=[];g.scene.traverse(o=>{if(o.isMesh && /^(H11|Mount)/i.test(o.name))parts.push(o)});
parts.forEach(o=>assembly.attach(o));assembly.scale.setScalar(1.25);
g.scene.updateMatrixWorld(true);
const crownTop=g.scene.getObjectByName('Top fabric button');
const pivot=crownTop?new THREE.Box3().setFromObject(crownTop).getCenter(new THREE.Vector3()):new THREE.Vector3(0,1.95,0);
// R(p - oldPivot) + oldPivot == R(p - pivot) + compensatedPosition.
presentation.position.copy(pivot).sub(focus).applyQuaternion(presentation.quaternion).add(focus);
g.scene.position.sub(pivot);turntable.add(g.scene);motionStart=performance.now();document.querySelector('#hint').textContent='DRAG TO EXPLORE · SCROLL TO ZOOM';
},undefined,()=>{document.querySelector('#hint').textContent='3D MODEL COULD NOT LOAD';dispatchSceneReady()});addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});renderer.setAnimationLoop((time)=>{recMaterials.forEach(m=>m.emissiveIntensity=24);animatePresentation(time);controls.update();renderFrame();});

