import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';

// Preserve the original scene alpha; bloom contributes alpha only where it glows.
export function transparentBloom(renderer, scene, camera, motionBlur={value:0}) {
 const base = new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
 const composer = new EffectComposer(renderer);
 composer.renderTarget1.samples=4;composer.renderTarget2.samples=4;
 composer.renderToScreen=false;
 composer.addPass(new RenderPass(scene,camera));
 composer.addPass(new UnrealBloomPass(new THREE.Vector2(1,1),1.5,.35,1.0));
 const material=new THREE.ShaderMaterial({
  uniforms:{base:{value:base.texture},bloom:{value:null},motionBlur},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`varying vec2 vUv;uniform sampler2D base;uniform sampler2D bloom;uniform float motionBlur;
  void main(){vec4 b=vec4(0.);vec3 bloomColor=vec3(0.);float total=0.;
  // A short, speed-driven directional shutter smear, confined to the 3D layer.
  for(int i=-3;i<=3;i++){float weight=4.-abs(float(i));vec2 uv=clamp(vUv+vec2(float(i)/3.*motionBlur,0.),vec2(0.),vec2(1.));
   b+=texture2D(base,uv)*weight;bloomColor+=texture2D(bloom,uv).rgb*weight;total+=weight;}
  b/=total;bloomColor/=total;vec3 delta=max(bloomColor-b.rgb,vec3(0.));
  float red=max(delta.r-max(delta.g,delta.b)*1.25,0.);
  vec3 glow=vec3(red,red*.025,red*.01);
  float a=max(b.a,clamp(max(glow.r,max(glow.g,glow.b)),0.,1.));
  gl_FragColor=vec4((b.rgb+glow)/max(a,.00001),a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  }`,depthTest:false,depthWrite:false
 });
 const output=new THREE.Scene();output.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
 const ortho=new THREE.Camera();
 function resize(){const size=renderer.getDrawingBufferSize(new THREE.Vector2());base.setSize(size.x,size.y);composer.setSize(innerWidth,innerHeight);}
 resize();addEventListener('resize',resize);
 return ()=>{renderer.setRenderTarget(base);renderer.clear();renderer.render(scene,camera);renderer.setRenderTarget(null);composer.render();material.uniforms.bloom.value=composer.readBuffer.texture;renderer.setRenderTarget(null);renderer.render(output,ortho);};
}
