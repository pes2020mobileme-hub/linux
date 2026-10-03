import crypto from "node:crypto";
import type { Db } from "../database/index.js";

export type WebhookEvent="moderation"|"security"|"ai"|"system"|"raid";

export const WEBHOOK_EVENTS:WebhookEvent[]=["moderation","security","ai","system","raid"];

const PRIVATE_HOST=/^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.internal$|.*\.local$)/i;

export type UrlCheck={ ok:boolean; reason:string };

export function validateWebhookUrl(raw:string):UrlCheck{
 let url:URL;
 try{ url=new URL(raw); }catch{ return {ok:false,reason:"URL ไม่ถูกต้อง"}; }
 if(url.protocol!=="https:") return {ok:false,reason:"ต้องใช้ https เท่านั้น"};
 const host=url.hostname;
 if(PRIVATE_HOST.test(host)) return {ok:false,reason:`ปฏิเสธ host ภายใน ${host} (กัน SSRF)`};
 if(!host.includes(".")) return {ok:false,reason:"host ไม่ครบถ้วน"};
 return {ok:true,reason:"ใช้ได้"};
}

export type WebhookEndpoint={ id:string; guildId:string|null; url:string; events:WebhookEvent[]; active:boolean; createdAt:string };

const now=()=>new Date().toISOString();

function toEndpoint(r:Record<string,unknown>):WebhookEndpoint{
 return {
  id:String(r.id),guildId:r.guild_id?String(r.guild_id):null,url:String(r.url),
  events:String(r.events).split(",").filter(Boolean) as WebhookEvent[],
  active:Number(r.active)===1,createdAt:String(r.created_at)
 };
}

export type RegisterInput={ guildId?:string|null; url:string; events:WebhookEvent[]; secret:string };

export function registerWebhook(db:Db,input:RegisterInput):WebhookEndpoint{
 const check=validateWebhookUrl(input.url);
 if(!check.ok) throw new Error(check.reason);
 if(!input.events.length) throw new Error("ต้องเลือก event อย่างน้อย 1 อย่าง");
 const bad=input.events.filter(e=>!WEBHOOK_EVENTS.includes(e));
 if(bad.length) throw new Error(`event ไม่ถูกต้อง: ${bad.join(", ")}`);
 if(!input.secret||input.secret.length<16) throw new Error("secret ต้องยาวอย่างน้อย 16 ตัวอักษร");
 const id=crypto.randomUUID();
 const createdAt=now();
 const secretHash=crypto.createHash("sha256").update(input.secret,"utf8").digest("hex");
 db.prepare("INSERT INTO webhook_endpoints (id, guild_id, url, secret_hash, events, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
  .run(id,input.guildId??null,input.url,secretHash,input.events.join(","),createdAt);
 return {id,guildId:input.guildId??null,url:input.url,events:input.events,active:true,createdAt};
}

export function listWebhooks(db:Db,guildId?:string|null){
 if(guildId) return db.prepare("SELECT * FROM webhook_endpoints WHERE guild_id = ? ORDER BY created_at DESC").all(guildId).map(r=>toEndpoint(r as Record<string,unknown>));
 return db.prepare("SELECT * FROM webhook_endpoints ORDER BY created_at DESC").all().map(r=>toEndpoint(r as Record<string,unknown>));
}

export function disableWebhook(db:Db,id:string){
 db.prepare("UPDATE webhook_endpoints SET active = 0 WHERE id = ?").run(id);
}

export function signPayload(secret:string,body:string,timestamp=Date.now()){
 const stamped=`${timestamp}.${body}`;
 const signature=crypto.createHmac("sha256",secret).update(stamped,"utf8").digest("hex");
 return {stamped,signature,header:`t=${timestamp},v1=${signature}`};
}

export function verifySignature(secret:string,body:string,header:string,toleranceMs=300000){
 const parts=Object.fromEntries(header.split(",").map(p=>p.split("=") as [string,string]));
 const timestamp=Number(parts.t);
 const signature=parts.v1;
 if(!timestamp||!signature) return {ok:false,reason:"header ไม่ครบ"};
 if(Math.abs(Date.now()-timestamp)>toleranceMs) return {ok:false,reason:"timestamp เก่าเกินไป"};
 const expected=crypto.createHmac("sha256",secret).update(`${timestamp}.${body}`,"utf8").digest("hex");
 const a=Buffer.from(expected,"hex");
 const b=Buffer.from(signature,"hex");
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return {ok:false,reason:"ลายเซ็นไม่ตรง"};
 return {ok:true,reason:"ถูกต้อง"};
}

export type SendResult={ ok:boolean; status:number|null; attempts:number; error?:string; durationMs:number };

export type FetchLike=(url:string,init:{method:string;headers:Record<string,string>;body:string;signal:AbortSignal})=>Promise<{status:number}>;

export async function deliver(db:Db,endpointId:string,event:WebhookEvent,payload:unknown,secret:string,fetchImpl:FetchLike,attempts=3,timeoutMs=5000):Promise<SendResult>{
 const started=Date.now();
 const endpoint=db.prepare("SELECT * FROM webhook_endpoints WHERE id = ?").get(endpointId) as Record<string,unknown>|undefined;
 if(!endpoint) return {ok:false,status:null,attempts:0,error:"ไม่พบ endpoint",durationMs:Date.now()-started};
 if(Number(endpoint.active)!==1) return {ok:false,status:null,attempts:0,error:"endpoint ถูกปิดใช้งาน",durationMs:Date.now()-started};
 if(!(String(endpoint.events).split(",") as string[]).includes(event)) return {ok:false,status:null,attempts:0,error:`endpoint นี้ไม่ได้ติดตาม ${event}`,durationMs:Date.now()-started};
 const body=JSON.stringify({event,guildId:endpoint.guild_id?String(endpoint.guild_id):null,payload,sentAt:now()});
 const url=String(endpoint.url);
 let delay=500;
 let lastError="";
 for(let attempt=1;attempt<=attempts;attempt++){
  const t0=Date.now();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const {header}=signPayload(secret,body);
   const res=await fetchImpl(url,{method:"POST",headers:{"content-type":"application/json","x-linuxbot-signature":header},body,signal:controller.signal});
   const ok=res.status>=200&&res.status<300;
   logDelivery(db,endpointId,event,attempt,res.status,ok,ok?null:`HTTP ${res.status}`,Date.now()-t0);
   if(ok) return {ok:true,status:res.status,attempts:attempt,durationMs:Date.now()-started};
   lastError=`HTTP ${res.status}`;
   if(res.status<500&&res.status!==429) break;
  }catch(e){
   lastError=e instanceof Error?e.message:String(e);
   logDelivery(db,endpointId,event,attempt,null,false,lastError,Date.now()-t0);
  }finally{
   clearTimeout(timer);
  }
  if(attempt<attempts){
   await new Promise(r=>setTimeout(r,delay));
   delay*=2;
  }
 }
 return {ok:false,status:null,attempts,error:lastError,durationMs:Date.now()-started};
}

function logDelivery(db:Db,endpointId:string,event:string,attempt:number,status:number|null,ok:boolean,error:string|null,durationMs:number){
 db.prepare("INSERT INTO webhook_logs (endpoint_id, event, attempt, status_code, ok, error, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
  .run(endpointId,event,attempt,status,ok?1:0,error,durationMs,now());
}

export function deliveryLog(db:Db,endpointId:string,limit=20){
 return db.prepare("SELECT attempt, status_code, ok, error, duration_ms, created_at FROM webhook_logs WHERE endpoint_id = ? ORDER BY id DESC LIMIT ?")
  .all(endpointId,limit)
  .map(r=>({
   attempt:Number((r as Record<string,unknown>).attempt),
   statusCode:(r as Record<string,unknown>).status_code===null?null:Number((r as Record<string,unknown>).status_code),
   ok:Number((r as Record<string,unknown>).ok)===1,
   error:(r as Record<string,unknown>).error?String((r as Record<string,unknown>).error):null,
   durationMs:Number((r as Record<string,unknown>).duration_ms),
   createdAt:String((r as Record<string,unknown>).created_at)
  }));
}
