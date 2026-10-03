import crypto from "node:crypto";
import http from "node:http";
import type { Db } from "../database/index.js";
import { authenticateApiKey, type ApiScope } from "../services/api-keys.js";
import { RateLimiter, retryAfterHeader } from "../services/rate-limit.js";
import { balance, accountSummary, statement, transfer } from "../services/economy.js";
import { leaderboard, rank } from "../services/xp.js";
import { createCase, listCases, MOD_ACTIONS } from "../services/moderation.js";
import { checkDatabase } from "../database/index.js";

export type ApiContext={ db:Db; limiter:RateLimiter; runtimeStatus:()=>{ discord:string; uptimeSec:number }; guildIdFor?:string|null };

export type ApiReply={ code:number; body:unknown; headers?:Record<string,string> };

type Handler=(ctx:ApiContext,req:{method:string;path:string;params:string[];query:URLSearchParams;body:any;requestId:string;keyId:string|null})=>ApiReply|Promise<ApiReply>;

export type Route={ method:string; pattern:string; scope:ApiScope; handler:Handler };

function audit(ctx:ApiContext,requestId:string,keyId:string|null,action:string,result:string,detail:string){
 try{
  ctx.db.prepare("INSERT INTO audit_logs (guild_id, actor_id, action, target_id, result, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
   .run(null,keyId,action,requestId,result,detail,new Date().toISOString());
 }catch{}
}

const asInt=(v:unknown,field:string)=>{
 const n=Number(v);
 if(!Number.isInteger(n)) throw new Error(`${field} ต้องเป็นจำนวนเต็ม`);
 return n;
};

export const ROUTES:Route[]=[
 {method:"GET",pattern:"/api/guilds",scope:"guilds",handler:ctx=>{
  const rows=ctx.db.prepare("SELECT id, name, created_at FROM guilds ORDER BY created_at DESC").all() as Array<Record<string,unknown>>;
  return {code:200,body:{count:rows.length,guilds:rows.map(r=>({id:String(r.id),name:String(r.name),createdAt:String(r.created_at)}))}};
 }},
 {method:"GET",pattern:"/api/guild/:id",scope:"guilds",handler:ctx=>{
  const id=ctx.guildIdFor??"";
  const row=ctx.db.prepare("SELECT id, name, created_at FROM guilds WHERE id = ?").get(id) as Record<string,unknown>|undefined;
  if(!row) return {code:404,body:{error:"ไม่พบ server นี้"}};
  return {code:200,body:{id:String(row.id),name:String(row.name),createdAt:String(row.created_at)}};
 }},
 {method:"GET",pattern:"/api/guild/:id/stats",scope:"guilds",handler:ctx=>{
  const id=ctx.guildIdFor??"";
  const members=Number((ctx.db.prepare("SELECT COUNT(*) AS n FROM members WHERE guild_id = ?").get(id) as {n:number}).n);
  const cases=Number((ctx.db.prepare("SELECT COUNT(*) AS n FROM moderation_cases WHERE guild_id = ?").get(id) as {n:number}).n);
  const security=Number((ctx.db.prepare("SELECT COUNT(*) AS n FROM security_events WHERE guild_id = ?").get(id) as {n:number}).n);
  return {code:200,body:{guildId:id,members,cases,securityEvents:security,uptimeSec:ctx.runtimeStatus().uptimeSec}};
 }},
 {method:"GET",pattern:"/api/guild/:id/settings",scope:"guilds",handler:ctx=>{
  const id=ctx.guildIdFor??"";
  const rows=ctx.db.prepare("SELECT key, value, updated_at FROM guild_settings WHERE guild_id = ? ORDER BY key").all(id) as Array<Record<string,unknown>>;
  return {code:200,body:{guildId:id,settings:Object.fromEntries(rows.map(r=>[String(r.key),r.value===null?null:String(r.value)]))}};
 }},
 {method:"POST",pattern:"/api/guild/:id/moderation",scope:"moderation",handler:(ctx,req)=>{
  const input=req.body??{};
  const allowed=new Set(MOD_ACTIONS);
  if(!allowed.has(input.action)) return {code:400,body:{error:`action ไม่ถูกต้อง ต้องเป็นหนึ่งใน: ${MOD_ACTIONS.join(", ")}`}};
  if(!input.userId) return {code:400,body:{error:"ต้องระบุ userId"}};
  if(!input.moderatorId) return {code:400,body:{error:"ต้องระบุ moderatorId (ผู้สั่ง)"}};
  try{
   const c=createCase(ctx.db,{guildId:ctx.guildIdFor??"",moderatorId:String(input.moderatorId),userId:String(input.userId),action:input.action,reason:String(input.reason??""),evidence:input.evidence?String(input.evidence):undefined,durationSec:input.durationSec===undefined?undefined:asInt(input.durationSec,"durationSec")});
   return {code:201,body:c};
  }catch(e){
   return {code:400,body:{error:e instanceof Error?e.message:String(e)}};
  }
 }},
 {method:"GET",pattern:"/api/guild/:id/moderation",scope:"moderation",handler:ctx=>({code:200,body:{cases:listCases(ctx.db,ctx.guildIdFor??"",20)}})}
];

export function matchRoute(method:string,path:string){
 for(const r of allRoutes()){
  if(r.method!==method) continue;
  const a=r.pattern.split("/");
  const b=path.split("/");
  if(a.length!==b.length) continue;
  const params:string[]=[];
  let ok=true;
  for(let i=0;i<a.length;i++){
   if(a[i].startsWith(":")) params.push(decodeURIComponent(b[i]));
   else if(a[i]!==b[i]){ok=false;break;}
  }
  if(ok) return {route:r,params};
 }
 return null;
}

export function handleRequest(ctx:ApiContext,req:http.IncomingMessage,res:http.ServerResponse,readBody:()=>Promise<any>,requestId:string){
 return (async()=>{
  const url=new URL(req.url??"/","http://localhost");
  const path=url.pathname.replace(/\/+$/,"")||"/";
  const method=req.method??"GET";
  const keyHeader=String(req.headers["x-api-key"]??"");
  const matched=matchRoute(method,path);

  if(!matched){
   audit(ctx,requestId,null,"api.unknown_route","DENIED",`${method} ${path}`);
   return json(res,404,{error:"ไม่พบ route นี้",requestId});
  }

  const limit=ctx.limiter.checkAll({ip:req.socket.remoteAddress??"unknown",apikey:keyHeader||"anonymous",route:path});
  if(!limit.allowed){
   audit(ctx,requestId,null,"api.rate_limit","DENIED",`${method} ${path} เกินโควตา ${limit.scope}`);
   return json(res,429,{error:"เกินอัตราการเรียก",scope:limit.scope,retryAfterSec:limit.resetInSec,requestId},{"retry-after":String(limit.resetInSec)});
  }

  const auth=keyHeader?authenticateApiKey(ctx.db,keyHeader,matched.route.scope):{ok:false,reason:"ไม่ได้ส่ง x-api-key"};
  if(!auth.ok){
   audit(ctx,requestId,null,"api.auth","DENIED",`${method} ${path}: ${auth.reason}`);
   return json(res,401,{error:auth.reason,requiredScope:matched.route.scope,requestId});
  }

  let body:any=null;
  if(method==="POST"||method==="PUT"||method==="PATCH"){
   try{ body=await readBody(); }
   catch{ return json(res,400,{error:"อ่าน JSON body ไม่สำเร็จ",requestId}); }
  }

  const requestCtx={
   method,path,params:matched.params,query:url.searchParams,body,
   requestId,keyId:auth.key?.id??null
  };
  const guildId=auth.key?.guildId??null;
  const routeCtx:ApiContext={...ctx,guildIdFor:guildId};

  try{
   const reply=await matched.route.handler(routeCtx,requestCtx);
   audit(ctx,requestId,requestCtx.keyId,"api.route",String(reply.code),`${method} ${path}`);
   return json(res,reply.code,reply.body?{...(reply.body as object),requestId}:{requestId},reply.headers);
  }catch(e){
   const message=e instanceof Error?e.message:String(e);
   audit(ctx,requestId,requestCtx.keyId,"api.error","ERROR",`${method} ${path}: ${message}`);
   return json(res,500,{error:message,requestId});
  }
 })();
}

export function json(res:http.ServerResponse,code:number,body:unknown,headers:Record<string,string>={}){
 res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers});
 res.end(JSON.stringify(body,null,2));
}

export function economyRoutes():Route[]{
 return [
 {method:"GET",pattern:"/api/user/:id/balance",scope:"health",handler:(ctx,req)=>({code:200,body:{userId:req.params[0],...accountSummary(ctx.db,req.params[0]),balance:balance(ctx.db,req.params[0])}})},
 {method:"GET",pattern:"/api/user/:id/statement",scope:"health",handler:(ctx,req)=>({code:200,body:{userId:req.params[0],transactions:statement(ctx.db,req.params[0],20)}})},
  {method:"GET",pattern:"/api/guild/:id/leaderboard",scope:"guilds",handler:(ctx,req)=>({code:200,body:{guildId:ctx.guildIdFor??"",entries:leaderboard(ctx.db,ctx.guildIdFor??"",10)}})},
  {method:"GET",pattern:"/api/guild/:id/rank/:userId",scope:"guilds",handler:(ctx,req)=>({code:200,body:rank(ctx.db,ctx.guildIdFor??"",req.params[1])})},
  {method:"POST",pattern:"/api/economy/transfer",scope:"health",handler:(ctx,req)=>{
   const {from,to,amount}=req.body??{};
   if(!from||!to) return {code:400,body:{error:"ต้องระบุ from และ to"}};
   const r=transfer(ctx.db,String(from),String(to),asInt(amount,"amount"),"โอนผ่าน API",req.body?.ref?String(req.body.ref):null);
   return r.ok?{code:200,body:r}:{code:409,body:r};
  }}
 ];
}

export function allRoutes(){
 return [...ROUTES,...economyRoutes()];
}

export function databaseOk(db:Db){
 return checkDatabase(db).state==="PASS";
}
