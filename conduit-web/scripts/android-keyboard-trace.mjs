/*
 * Every frame of a keyboard travel in the Android shell, not the last nine.
 *
 * The on-screen probe is a nine-row ring because it has to fit on a phone.
 * Nothing here has that constraint, and two bugs survived several rounds
 * because they were looked for through the phone-sized window anyway: a jump
 * at the very start of a close, which the ring had already lost by the time it
 * was read, and a transcript that failed to move only when it was scrolled to
 * the bottom, which needs the scroll position beside the height to see at all.
 *
 *   ADB=$ANDROID_HOME/platform-tools/adb node scripts/android-keyboard-trace.mjs seed 6
 *   ADB=... node scripts/android-keyboard-trace.mjs bottom
 *   ADB=... node scripts/android-keyboard-trace.mjs scrolled
 *
 * Needs `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
 * against the shell, and a chat with enough history to scroll -- `seed` only
 * fills one if the server it is pointed at can actually answer.
 */
import WebSocket from "ws";
import { execFileSync } from "node:child_process";
const ADB = process.env.ADB || "adb";
const t=(await (await fetch("http://127.0.0.1:9333/json")).json()).find(x=>x.type==="page");
const ws=new WebSocket(t.webSocketDebuggerUrl,{maxPayload:1<<28});
let id=0;const pend=new Map();
ws.on("message",r=>{const m=JSON.parse(r.toString());if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
const send=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true});return r.result?.result?.value??r.result?.exceptionDetails?.text;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await new Promise(r=>ws.once("open",r));
const DPR=3.75, tap=(x,y)=>execFileSync(ADB,["shell","input","tap",String(Math.round(x*DPR)),String(Math.round(y*DPR))]);
const key=k=>execFileSync(ADB,["shell","input","keyevent",String(k)]);

const composer=async()=>await ev(`(()=>{const t=document.querySelector("textarea");if(!t)return null;const r=t.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);

if (process.argv[2]==="seed") {
  const n=Number(process.argv[3]||6);
  const para="The cartographer unrolled the map across the table, tracing a river that no longer existed. Every name on it had outlived the place it described, which is the usual fate of names. ";
  for (let i=0;i<n;i++){
    const c=await composer(); if(!c){console.log("no composer");break;}
    tap(c.x,c.y); await wait(900);
    await send("Input.insertText",{text:`Message ${i+1}. `+para.repeat(6)});
    await wait(300); key(66); await wait(1800);
  }
  console.log("scroller:", await ev(`(()=>{const v=document.querySelector(".message-scroller-viewport");return v?{scrollHeight:v.scrollHeight,clientHeight:v.clientHeight,max:v.scrollHeight-v.clientHeight}:null})()`));
  ws.close(); process.exit(0);
}

// full trace, unbounded, of every frame of a keyboard travel
const RECORD=`(()=>{window.__tr=[];const s=performance.now();const cs=getComputedStyle(document.documentElement);
 const v=document.querySelector(".message-scroller-viewport");
 const tick=()=>{const h=parseInt(cs.getPropertyValue("--app-height"))||0;
  const row={t:Math.round(performance.now()-s),h,st:v?Math.round(v.scrollTop):-1,ch:v?Math.round(v.clientHeight):-1,sh:v?Math.round(v.scrollHeight):-1};
  const l=window.__tr[window.__tr.length-1];
  if(!l||l.h!==row.h||l.st!==row.st||l.ch!==row.ch)window.__tr.push(row);
  if(performance.now()-s<2500)requestAnimationFrame(tick);};requestAnimationFrame(tick);})()`;

const show=(label,rows)=>{
  console.log(`\n--- ${label} (${rows.length} distinct frames) ---`);
  console.log("   t   app   scrollTop  clientH  scrollH   fromBottom");
  for(const r of rows) console.log(String(r.t).padStart(4), String(r.h).padStart(5), String(r.st).padStart(10), String(r.ch).padStart(8), String(r.sh).padStart(8), String(r.sh-r.st-r.ch).padStart(12));
};

const where=process.argv[2]||"bottom";
await ev(`(()=>{const v=document.querySelector(".message-scroller-viewport");if(!v)return;v.scrollTop=${where==="bottom"?"v.scrollHeight":"Math.max(0,(v.scrollHeight-v.clientHeight)/2)"};})()`);
await wait(700);
console.log("start:", await ev(`(()=>{const v=document.querySelector(".message-scroller-viewport");return v?{st:Math.round(v.scrollTop),ch:v.clientHeight,sh:v.scrollHeight,fromBottom:Math.round(v.scrollHeight-v.scrollTop-v.clientHeight)}:null})()`));
const c=await composer();
await ev(RECORD); tap(c.x,c.y); await wait(2800);
show(`OPEN @ ${where}`, await ev("window.__tr"));
await ev(RECORD); key(4); await wait(2800);
show(`CLOSE @ ${where}`, await ev("window.__tr"));
ws.close();
