const CDP="http://127.0.0.1:9222";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const targets=await (await fetch(`${CDP}/json/list`)).json();
const page=targets.find(t=>t.type==="page");
const ws=new WebSocket(page.webSocketDebuggerUrl);let seq=0;const pending=new Map();const logs=[];
const send=(m,p={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method:m,params:p}))});
ws.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);return}
if(m.method==="Runtime.consoleAPICalled"){logs.push(m.params.type+": "+(m.params.args||[]).map(a=>a.value??a.description).join(" "))}
if(m.method==="Runtime.exceptionThrown"){logs.push("exception: "+(m.params.exceptionDetails?.exception?.description??m.params.exceptionDetails?.text))}});
await new Promise(r=>ws.addEventListener("open",r,{once:true}));
await send("Page.enable");await send("Runtime.enable");
const ev=async x=>{const r=await send("Runtime.evaluate",{expression:x,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value};
const wait=async(x,l)=>{for(let i=0;i<100;i++){if(await ev(x)===true)return;await sleep(200)}throw new Error("timeout "+l)};
await send("Page.navigate",{url:"http://127.0.0.1:3000/timeline"});
await wait(`document.querySelector('button[aria-haspopup="dialog"]') !== null`,"trigger");
await ev(`(document.querySelector('button[aria-haspopup="dialog"]').click(), true)`);
await wait(`document.querySelector('[role="dialog"]') !== null`,"dialog");
await send("Input.dispatchKeyEvent",{type:"rawKeyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
await sleep(800);
console.log("dialogOpen",await ev(`document.querySelector('[role="dialog"]') !== null`));
console.log("logs",JSON.stringify(logs));
ws.close();
