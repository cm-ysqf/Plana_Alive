const s = window.spine, canvas = document.getElementById('render');
import { expressionLabels } from './emotions.js';
const gl = canvas.getContext('webgl', { alpha: true, preserveDrawingBuffer: true });
const shader = s.webgl.Shader.newTwoColoredTextured(gl), batcher = new s.webgl.PolygonBatcher(gl);
const renderer = new s.webgl.SkeletonRenderer(gl), matrix = new s.webgl.Matrix4();
const catalog = await fetch('/api/catalog').then(r => r.json());
let generation = 0;
async function draw(character) {
  const token = ++generation, meta = catalog[character];
  document.getElementById('status').textContent = '生成图鉴…';
  const manager = new s.webgl.AssetManager(gl), atlas = `/assets/${meta.file}.atlas`, binary = `/assets/${meta.file}.skel`;
  manager.loadTextureAtlas(atlas); manager.loadBinary(binary);
  await new Promise((resolve,reject)=>{ const poll=()=>{if(manager.hasErrors())reject(new Error('资源加载失败'));else if(manager.isLoadingComplete())resolve();else setTimeout(poll,25);};poll(); });
  if(token !== generation) { manager.dispose(); return; }
  const data = new s.SkeletonBinary(new s.AtlasAttachmentLoader(manager.get(atlas))).readSkeletonData(manager.get(binary));
  const sheet = document.getElementById('sheet'); const cellW=240,cellH=292,cols=6;
  sheet.width=cols*cellW;sheet.height=Math.ceil(meta.expressions.length/cols)*cellH;
  const ctx=sheet.getContext('2d');ctx.fillStyle='#252e40';ctx.fillRect(0,0,sheet.width,sheet.height);
  const notes=[];
  for(const [i,id] of meta.expressions.entries()) {
    const skeleton=new s.Skeleton(data), state=new s.AnimationState(new s.AnimationStateData(data));
    state.setAnimation(0,'Idle_01',true);state.setAnimation(1,id,true);state.update(.45);state.apply(skeleton);skeleton.updateWorldTransform();
    gl.viewport(0,0,240,250);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    matrix.ortho2d(-300,680,600,625);
    shader.bind();shader.setUniformi(s.webgl.Shader.SAMPLER,0);shader.setUniform4x4f(s.webgl.Shader.MVP_MATRIX,matrix.values);
    batcher.begin(shader);renderer.premultipliedAlpha=false;renderer.draw(batcher,skeleton);batcher.end();shader.unbind();
    const x=i%cols*cellW,y=Math.floor(i/cols)*cellH;
    ctx.drawImage(canvas,x,y);ctx.strokeStyle='#414b60';ctx.strokeRect(x+.5,y+.5,cellW-1,cellH-1);
    ctx.fillStyle='#ece4ff';ctx.font='bold 20px Segoe UI';ctx.fillText(id,x+14,y+271);
    const halo = [...new Set(skeleton.slots.filter(slot=>/halo/i.test(slot.data.name)&&slot.attachment&&slot.color.a>.05).map(slot=>slot.attachment.name.match(/halo_(normal|happy|love|suprise|depressed|angry)/i)?.[1]).filter(Boolean))];
    const label=id==='99'?'闭眼待机':expressionLabels[character][Number(id)];
    ctx.fillStyle='#aab8d0';ctx.font='14px Segoe UI';ctx.fillText(label,x+52,y+270);
    const article=document.createElement('article');article.className='note';article.innerHTML=`<b>${id} · ${label}</b><small>光环：${halo.join(' / ') || '原始'} · 画面解读</small>`;
    const button=document.createElement('button');button.textContent='使用表情 '+id;button.onclick=async()=>{await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({character,expression:id,mouthMode:'original',halo:'auto',blush:-1,sweat:-1,tears:-1})});};article.append(button);notes.push(article);
  }
  document.getElementById('notes').replaceChildren(...notes);
  sheet.dataset.character=character;sheet.dataset.count=String(meta.expressions.length);
  document.getElementById('status').textContent=meta.name+' · '+meta.expressions.length+' 个表情';
  manager.dispose();
}
document.getElementById('character').onchange=e=>draw(e.target.value).catch(e=>document.getElementById('status').textContent=e.message);
draw(document.getElementById('character').value).catch(e=>document.getElementById('status').textContent=e.message);
