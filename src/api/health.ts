import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import { checkDatabase, type Db } from "../database/index.js";
import { runDoctor, summarize } from "../setup/doctor.js";
import { listFeatures } from "../config/features.js";
import { RateLimiter } from "../services/rate-limit.js";
import { handleRequest, matchRoute } from "./routes.js";


export type RuntimeStatus={ discord:"online"|"offline"|"unknown"; pingMs:number|null; uptimeSec:number; guildCount:number };

export type HealthDeps={
 db?:Db;
 runtime?:()=>RuntimeStatus;
 limiter?:RateLimiter;
};

function json(res:http.ServerResponse,code:number,body:unknown){
 const payload=JSON.stringify(body,null,2);
 res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
 res.end(payload);
}

function readJsonBody(req:http.IncomingMessage){
 return new Promise<any>((resolve,reject)=>{
  let raw="";
  let size=0;
  req.on("data",chunk=>{
   size+=chunk.length;
   if(size>256*1024){reject(new Error("body ใหญ่เกิน 256KB"));req.destroy();return;}
   raw+=chunk;
  });
  req.on("end",()=>{
   if(!raw.trim()){resolve(null);return;}
   try{resolve(JSON.parse(raw));}catch(e){reject(e);}
  });
  req.on("error",reject);
 });
}

export function buildRoutes(deps:HealthDeps){
 const limiter=deps.limiter??new RateLimiter();
 const runtime=deps.runtime??(()=>({discord:"unknown",pingMs:null,uptimeSec:Math.floor(process.uptime()),guildCount:0}));
 const apiCtx=deps.db?{db:deps.db,limiter,runtimeStatus:()=>({discord:runtime().discord,uptimeSec:runtime().uptimeSec})}:null;
 return (req:http.IncomingMessage,res:http.ServerResponse)=>{
  const path=(req.url??"/").split("?")[0].replace(/\/+$/,"")||"/";
  const runtimeStatus=runtime();
  const dbCheck=deps.db?checkDatabase(deps.db):{state:"UNKNOWN" as const,detail:"ยังไม่ได้เปิด database"};

  if(req.method!=="GET"){
   if(apiCtx&&matchRoute(req.method??"",path)) return void handleRequest(apiCtx,req,res,()=>readJsonBody(req),crypto.randomUUID());
   return json(res,405,{error:"method not allowed"});
  }

  if(apiCtx&&matchRoute("GET",path)) return void handleRequest(apiCtx,req,res,()=>readJsonBody(req),crypto.randomUUID());

  if(path==="/api/health"){
   const rt=runtime();
   const checks=[{id:"database",state:dbCheck.state,detail:dbCheck.detail}];
   const fail=checks.some(c=>c.state==="FAIL");
   return json(res,fail?503:200,{
    status:fail?"fail":"ok",
    uptime:rt.uptimeSec,
    database:dbCheck,
    discord:rt.discord,
    checks
   });
  }

  if(path==="/api/ready"){
   const rt=runtime();
   const dbOk=dbCheck.state==="PASS";
   const botOk=rt.discord==="online";
   return json(res,dbOk&&botOk?200:503,{ready:dbOk&&botOk,database:dbOk,discord:botOk});
  }

  if(path==="/api/status"){
   const rt=runtime();
   return json(res,200,{
    uptimeSec:rt.uptimeSec,
    memory:{rssMb:Math.round(process.memoryUsage().rss/1048576),heapMb:Math.round(process.memoryUsage().heapUsed/1048576)},
    host:{platform:process.platform,arch:process.arch,cpus:os.cpus().length,loadavg:os.loadavg()[0]?.toFixed(2)},
    discord:rt,
    database:dbCheck,
    features:listFeatures()
   });
  }

  if(path==="/api/doctor"){
   const checks=runDoctor();
   const s=summarize(checks);
   return json(res,s.FAIL>0?503:200,{summary:s,checks});
  }

  if(path==="/api/setup/status"){
   const checks=runDoctor();
   return json(res,200,{
    environment:checks.filter(c=>c.group==="Environment"),
    secrets:checks.filter(c=>c.group==="Secrets").map(({id,label,state})=>({id,label,state})),
    database:dbCheck,
    discord:checks.filter(c=>c.group==="Discord"),
    ai:checks.filter(c=>c.group==="AI"),
    features:listFeatures()
   });
  }

  return json(res,404,{error:"not found",available:["/api/health","/api/ready","/api/status","/api/doctor","/api/setup/status"]});
 };
}

export function startHealthServer(deps:HealthDeps&{port?:number}){
 const port=deps.port??Number(process.env.PORT??8787);
 const server=http.createServer(buildRoutes(deps));
 server.listen(port,()=>console.log(`✓ Health API ฟังที่ http://localhost:${port}/api/health`));
 return server;
}