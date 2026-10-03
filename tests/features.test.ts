import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openDatabase, runMigrations } from "../src/database/index.js";
import { balance, credit, debit, transfer, statement, accountSummary } from "../src/services/economy.js";
import { addXp, levelFromXp, progressOf, xpForLevel, leaderboard, rank, levelRewards, grantLevelRewards } from "../src/services/xp.js";
import { createCase, listCases, warningCount, caseStats, escalationFor, MOD_ACTIONS } from "../src/services/moderation.js";
import { generateApiKey, createApiKey } from "../src/services/api-keys.js";
import { RateLimiter } from "../src/services/rate-limit.js";
import { buildRoutes } from "../src/api/health.js";

function freshDb(){
 const db=openDatabase(":memory:");
 runMigrations(db);
 return db;
}

test("credit เพิ่มยอดและเขียน ledger ครบ", ()=>{
 const db=freshDb();
 assert.equal(credit(db,"u1",500,"โบนัส").balance,500);
 assert.equal(credit(db,"u1",250,"โบนัส2").balance,750);
 const rows=statement(db,"u1");
 assert.equal(rows.length,2);
 assert.equal(rows[0].balanceAfter,750);
 assert.equal(accountSummary(db,"u1").lifetimeEarned,750);
 db.close();
});

test("debit หักได้และบัญชีติดลบไม่ได้", ()=>{
 const db=freshDb();
 credit(db,"u1",100,"เริ่มต้น");
 assert.equal(debit(db,"u1",40,"ซื้อของ").balance,60);
 const fail=debit(db,"u1",1000,"ซื้อเกินตัว");
 assert.equal(fail.ok,false);
 assert.match(fail.reason,/ไม่พอ/);
 assert.equal(balance(db,"u1"),60,"ยอดต้องไม่เปลี่ยนเมื่อหักไม่ผ่าน");
 db.close();
});

test("ref กันการให้รางวัลซ้ำ", ()=>{
 const db=freshDb();
 assert.equal(credit(db,"u1",100,"daily","daily:2026-10-03").ok,true);
 const second=credit(db,"u1",100,"daily","daily:2026-10-03");
 assert.equal(second.ok,false);
 assert.match(second.reason,/ถูกใช้ไปแล้ว/);
 assert.equal(balance(db,"u1"),100);
 db.close();
});

test("transfer โอนครบทั้งสองฝั่ง และกันยอดติดลบ", ()=>{
 const db=freshDb();
 credit(db,"a",1000,"เริ่มต้น");
 const ok=transfer(db,"a","b",300,"โอน");
 assert.equal(ok.ok,true);
 assert.equal(balance(db,"a"),700);
 assert.equal(balance(db,"b"),300);
 const bad=transfer(db,"b","a",9999,"โอนเกิน");
 assert.equal(bad.ok,false);
 assert.equal(balance(db,"b"),300,"ผู้รับต้องไม่ถูกหัก");
 assert.equal(balance(db,"a"),700,"ผู้จ่ายต้องไม่ถูกหักเมื่อโอนไม่สำเร็จ");
 db.close();
});

test("โอนให้ตัวเองไม่ได้ และจำนวนต้องเป็นจำนวนเต็มบวก", ()=>{
 const db=freshDb();
 assert.equal(transfer(db,"a","a",10).ok,false);
 assert.equal(credit(db,"a",-5,"ติดลบ").ok,false);
 assert.equal(credit(db,"a",1.5,"ทศนิยม").ok,false);
 db.close();
});

test("level คำนวณจาก xp ตามเส้นโค้ง", ()=>{
 assert.equal(xpForLevel(0),100);
 assert.equal(xpForLevel(5),350);
 assert.equal(levelFromXp(0),0);
 assert.equal(levelFromXp(99),0);
 assert.equal(levelFromXp(100),1);
 assert.equal(levelFromXp(249),1);
 assert.equal(levelFromXp(250),2);
 assert.equal(levelFromXp(449),2);
 assert.equal(levelFromXp(450),3);
 assert.equal(levelFromXp(1050),5);
 const p=progressOf(300);
 assert.equal(p.level,2);
 assert.equal(p.xpIntoLevel,50);
 assert.equal(p.xpForNext,200);
 assert.equal(p.percent,25);
});

test("addXp คุม cooldown และขึ้นเลเวลพร้อมบอก", ()=>{
 const db=freshDb();
 let now=1_000_000;
 const first=addXp(db,"g1","u1",250,60,now);
 assert.equal(first.added,true);
 assert.equal(first.leveledUp,true);
 assert.equal(first.toLevel,2);
 const cooled=addXp(db,"g1","u1",250,60,now+1000);
 assert.equal(cooled.added,false);
 assert.match(cooled.reason,/รออีก/);
 now+=61_000;
 const again=addXp(db,"g1","u1",250,60,now);
 assert.equal(again.added,true);
 db.close();
});

test("leaderboard เรียงตาม xp และ rank คำนวณถูก", ()=>{
 const db=freshDb();
 addXp(db,"g1","low",10,0,1000);
 addXp(db,"g1","high",1000,0,1000);
 addXp(db,"g1","mid",500,0,1000);
 const lb=leaderboard(db,"g1",10);
 assert.deepEqual(lb.map(e=>e.userId),["high","mid","low"]);
 assert.equal(rank(db,"g1","mid").rank,2);
 db.close();
});

test("level rewards คืนเฉพาะของใหม่ที่ยังไม่ได้รับ", ()=>{
 assert.deepEqual(levelRewards(2),[]);
 assert.deepEqual(levelRewards(3),["role:member-tier1"]);
 assert.deepEqual(grantLevelRewards({}, "g", "u", 2, 3),["role:member-tier1"]);
 assert.deepEqual(grantLevelRewards({}, "g", "u", 3, 4),[]);
 assert.deepEqual(grantLevelRewards({}, "g", "u", 0, 6),["role:member-tier1","role:member-tier2"]);
});

test("moderation case บังคับ action และเหตุผล", ()=>{
 const db=freshDb();
 const c=createCase(db,{guildId:"g1",moderatorId:"m1",userId:"u1",action:"warn",reason:"ส่งสแปม"});
 assert.ok(c.caseId);
 assert.equal(warningCount(db,"g1","u1"),1);
 assert.throws(()=>createCase(db,{guildId:"g1",moderatorId:"m1",userId:"u1",action:"hack" as never,reason:"x"}));
 assert.throws(()=>createCase(db,{guildId:"g1",moderatorId:"m1",userId:"u1",action:"warn",reason:"  "}));
 assert.throws(()=>createCase(db,{guildId:"g1",moderatorId:"m1",userId:"u1",action:"timeout",reason:"x"}));
 createCase(db,{guildId:"g1",moderatorId:"m1",userId:"u1",action:"timeout",reason:"x",durationSec:600});
 assert.equal(listCases(db,"g1").length,2);
 assert.deepEqual(caseStats(db,"g1")[0],{action:"warn",count:1});
 db.close();
});

test("escalation เลื่อนขั้นตามจำนวนคำเตือน", ()=>{
 assert.equal(escalationFor(1).tier,"none");
 assert.equal(escalationFor(3).tier,"watch");
 assert.equal(escalationFor(5).tier,"restrict");
 assert.equal(escalationFor(9).tier,"remove");
 assert.ok(MOD_ACTIONS.includes("ban"));
});

async function call(server:http.Server,path:string,opts:RequestInit={}){
 const port=String((server.address() as {port:number}).port);
 return new Promise<{code:number;body:any}>((resolve,reject)=>{
  const req=http.request({host:"127.0.0.1",port,path,method:opts.method??"GET",headers:{...opts.headers,connection:"close"},agent:false},res=>{
   let raw="";
   res.on("data",c=>raw+=c);
   res.on("end",()=>resolve({code:res.statusCode??0,body:raw?JSON.parse(raw):null}));
  });
  req.on("error",reject);
  if(opts.body) req.write(opts.body);
  req.end();
 });
}

async function withServer(db:ReturnType<typeof openDatabase>,run:(s:http.Server)=>Promise<void>){
 const server=http.createServer(buildRoutes({db,limiter:new RateLimiter({apikey:{limit:1000,windowSec:60},route:{limit:1000,windowSec:60},ip:{limit:1000,windowSec:60}}),runtime:()=>({discord:"online",pingMs:5,uptimeSec:1,guildCount:1})}));
 await new Promise<void>(r=>server.listen(0,r));
 await run(server);
 server.closeAllConnections();
 server.close();
}

test("public API ปฏิเสธเมื่อไม่มี api key", async ()=>{
 const db=freshDb();
 await withServer(db,async s=>{
  const r=await call(s,"/api/guilds");
  assert.equal(r.code,401);
  assert.match(r.body.error,/x-api-key/);
  assert.equal(r.body.requiredScope,"guilds");
 });
 db.close();
});

test("public API ผ่านเมื่อ key ถูกต้อง และคืน requestId", async ()=>{
 const db=freshDb();
 const created=generateApiKey(["guilds","moderation","health"]);
 createApiKey(db,created,"test","guild-1");
 await withServer(db,async s=>{
  const r=await call(s,"/api/guilds",{headers:{"x-api-key":created.plaintext}});
  assert.equal(r.code,200);
  assert.ok(r.body.requestId,"ต้องมี requestId");
  assert.equal(r.body.count,0);
 });
 db.close();
});

test("public API ปฏิเสธเมื่อ scope ไม่พอ", async ()=>{
 const db=freshDb();
 const created=generateApiKey(["health"]);
 createApiKey(db,created,"test");
 await withServer(db,async s=>{
  const r=await call(s,"/api/guilds",{headers:{"x-api-key":created.plaintext}});
  assert.equal(r.code,401);
  assert.match(r.body.error,/ไม่มีสิทธิ์/);
 });
 db.close();
});

test("POST moderation ผ่าน API บันทึก case จริง และ validate input", async ()=>{
 const db=freshDb();
 const created=generateApiKey(["moderation"]);
 createApiKey(db,created,"mod","guild-9");
 await withServer(db,async s=>{
  const bad=await call(s,"/api/guild/x/moderation",{method:"POST",headers:{"x-api-key":created.plaintext,"content-type":"application/json"},body:JSON.stringify({action:"nope",userId:"u",moderatorId:"m",reason:"r"})});
  assert.equal(bad.code,400);
  const good=await call(s,"/api/guild/x/moderation",{method:"POST",headers:{"x-api-key":created.plaintext,"content-type":"application/json"},body:JSON.stringify({action:"ban",userId:"u2",moderatorId:"m1",reason:"โกง"})});
  assert.equal(good.code,201);
  assert.equal(good.body.action,"ban");
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM moderation_cases").get() as {n:number}).n),1);
 });
 db.close();
});

test("GET balance และ statement อ่านค่าจริงจากฐานข้อมูล", async ()=>{
 const db=freshDb();
 const created=generateApiKey(["health"]);
 createApiKey(db,created,"eco");
 credit(db,"u7",500,"เริ่ม");
 await withServer(db,async s=>{
  const b=await call(s,"/api/user/u7/balance",{headers:{"x-api-key":created.plaintext}});
  assert.equal(b.code,200);
  assert.equal(b.body.userId,"u7");
  assert.equal(b.body.balance,500);
  const st=await call(s,"/api/user/u7/statement",{headers:{"x-api-key":created.plaintext}});
  assert.equal(st.code,200);
  assert.equal(st.body.transactions.length,1);
 });
 db.close();
});

test("GET leaderboard และ rank ใช้ guild ของ key", async ()=>{
 const db=freshDb();
 const created=generateApiKey(["guilds"]);
 createApiKey(db,created,"lb","guild-77");
 addXp(db,"guild-77","a",100,0,1000);
 addXp(db,"guild-77","b",500,0,1000);
 await withServer(db,async s=>{
  const lb=await call(s,"/api/guild/x/leaderboard",{headers:{"x-api-key":created.plaintext}});
  assert.equal(lb.code,200);
  assert.deepEqual(lb.body.entries.map((e:any)=>e.userId),["b","a"]);
  const rk=await call(s,"/api/guild/x/rank/a",{headers:{"x-api-key":created.plaintext}});
  assert.equal(rk.code,200);
  assert.equal(rk.body.userId,"a");
  assert.equal(rk.body.rank,2);
 });
 db.close();
});

test("POST economy transfer ผ่าน API และตอบ 409 เมื่อยอดไม่พอ", async ()=>{
 const db=freshDb();
 const created=generateApiKey(["health"]);
 createApiKey(db,created,"eco");
 credit(db,"a",100,"เริ่ม");
 await withServer(db,async s=>{
  const ok=await call(s,"/api/economy/transfer",{method:"POST",headers:{"x-api-key":created.plaintext,"content-type":"application/json"},body:JSON.stringify({from:"a",to:"b",amount:40})});
  assert.equal(ok.code,200);
  assert.equal(balance(db,"b"),40);
  const bad=await call(s,"/api/economy/transfer",{method:"POST",headers:{"x-api-key":created.plaintext,"content-type":"application/json"},body:JSON.stringify({from:"b",to:"a",amount:999})});
  assert.equal(bad.code,409);
  const invalid=await call(s,"/api/economy/transfer",{method:"POST",headers:{"x-api-key":created.plaintext,"content-type":"application/json"},body:JSON.stringify({from:"b",to:"a",amount:"x"})});
  assert.equal(invalid.code,500);
 });
 db.close();
});

test("ทุก request ถูกบันทึกลง audit log", async ()=>{
 const db=freshDb();
 const created=generateApiKey(["guilds"]);
 createApiKey(db,created,"audited");
 await withServer(db,async s=>{
  await call(s,"/api/guilds",{headers:{"x-api-key":created.plaintext}});
  await call(s,"/api/guilds");
 });
 const rows=db.prepare("SELECT action, result FROM audit_logs ORDER BY id").all() as Array<Record<string,unknown>>;
 assert.ok(rows.length>=2);
 assert.equal(rows.some(r=>String(r.action)==="api.auth"&&String(r.result)==="DENIED"),true);
 db.close();
});

test("health endpoint เดิมยังใช้ได้", async ()=>{
 const db=freshDb();
 await withServer(db,async s=>{
  const h=await call(s,"/api/health");
  assert.equal(h.code,200);
  assert.equal(h.body.status,"ok");
 });
 db.close();
});
