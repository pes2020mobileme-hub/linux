import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, runMigrations } from "../src/database/index.js";
import { RaidDetector, DEFAULT_RAID_CONFIG } from "../src/security/anti-raid.js";
import { generateApiKey, hashKey, createApiKey, authenticateApiKey, revokeApiKey, rotateApiKey, listApiKeys, verifyApiKey } from "../src/services/api-keys.js";
import { RateLimiter } from "../src/services/rate-limit.js";
import { runSetup, stepResult, lastSetupResult } from "../src/setup/setup-engine.js";
import type { SetupContext } from "../src/setup/setup-engine.js";

function freshDb(){
 const db=openDatabase(":memory:");
 runMigrations(db);
 return db;
}

test("anti-raid เพิ่มระดับตาม threshold และรูดกลับเมื่อหลุดหน้าต่างเวลา", ()=>{
 const d=new RaidDetector({windowSec:10,suspicious:5,raid:10,lockdown:20});
 const t0=1_000_000;
 assert.equal(d.record("g1","mass_join",1,t0).level,"NORMAL");
 assert.equal(d.record("g1","mass_join",1,t0+100).level,"NORMAL");
 assert.equal(d.record("g1","mass_join",3,t0+200).level,"SUSPICIOUS");
 assert.equal(d.record("g1","mass_join",5,t0+300).level,"RAID");
 assert.equal(d.record("g1","mass_join",10,t0+400).level,"LOCKDOWN");
 assert.equal(d.record("g1","mass_join",1,t0+30_000).level,"NORMAL");
});

test("anti-raid แยก guild และ event type ไม่ปนกัน", ()=>{
 const d=new RaidDetector();
 d.record("g1","mass_join",10,1000);
 assert.equal(d.record("g2","mass_join",1,1000).level,"NORMAL");
 assert.equal(d.record("g1","mass_ban",1,1000).level,"NORMAL");
 assert.equal(d.levelOf("g1","mass_join"),"RAID");
});

test("anti-raid บันทึก security_events เฉพาะเมื่อถึง action threshold", ()=>{
 const db=freshDb();
 const d=new RaidDetector({suspicious:2,raid:4,lockdown:8,actionThreshold:4},v=>{
  if(!v.shouldAct) return;
  db.prepare("INSERT INTO security_events (guild_id, kind, level, count, detail, created_at) VALUES (?,?,?,?,?,?)")
   .run(v.guildId,v.kind,v.level,v.count,v.reason,new Date().toISOString());
 });
 const count=()=>Number((db.prepare("SELECT COUNT(*) AS n FROM security_events").get() as {n:number}).n);

 assert.equal(d.record("g1","mass_join",1,1000).level,"NORMAL");
 assert.equal(d.record("g1","mass_join",1,1100).level,"SUSPICIOUS");
 assert.equal(count(),0,"ยังไม่ถึง actionThreshold จึงยังไม่บันทึก");
 assert.equal(d.record("g1","mass_join",1,1200).level,"SUSPICIOUS");
 assert.equal(count(),0);
 assert.equal(d.record("g1","mass_join",1,1300).level,"RAID");
 assert.equal(count(),1,"ถึง actionThreshold แล้วจึงบันทึก");
 db.close();
});

test("anti-raid ปฏิเสธ threshold ที่เรียงผิด", ()=>{
 assert.throws(()=>new RaidDetector({suspicious:10,raid:5,lockdown:20}));
 assert.throws(()=>new RaidDetector({suspicious:1,raid:2,lockdown:2}));
 assert.equal(DEFAULT_RAID_CONFIG.suspicious<DEFAULT_RAID_CONFIG.raid,true);
});

test("api key เก็บแค่ hash ไม่มี plaintext ในฐานข้อมูล", ()=>{
 const db=freshDb();
 const created=generateApiKey(["health","announce"]);
 createApiKey(db,created,"test key");
 const row=db.prepare("SELECT * FROM api_keys WHERE id = ?").get(created.id) as Record<string,unknown>;
 assert.equal(String(row.hash).length,64);
 assert.ok(!JSON.stringify(row).includes(created.plaintext));
 assert.equal(String(row.hash),hashKey(created.plaintext));
 db.close();
});

test("authenticate ผ่านเมื่อ key ถูกและมี scope", ()=>{
 const db=freshDb();
 const created=generateApiKey(["health"]);
 createApiKey(db,created,"k");
 const r=authenticateApiKey(db,created.plaintext,"health");
 assert.equal(r.ok,true);
 assert.ok(r.key);
 db.close();
});

test("authenticate ปฏิเสธเมื่อ scope ไม่ตรง หรือ key ถูกเพิกถอน หรือหมดอายุ", ()=>{
 const db=freshDb();
 const created=generateApiKey(["health"]);
 createApiKey(db,created,"k");
 assert.equal(authenticateApiKey(db,created.plaintext,"announce").ok,false);
 assert.equal(authenticateApiKey(db,"dh_live_wrong","health").ok,false);

 revokeApiKey(db,created.id);
 assert.equal(authenticateApiKey(db,created.plaintext,"health").reason.includes("เพิกถอน"),true);

 const short=generateApiKey(["health"],-1);
 createApiKey(db,short,"expired");
 assert.equal(authenticateApiKey(db,short.plaintext,"health").reason.includes("หมดอายุ"),true);
 db.close();
});

test("หมุน key ใหม่แล้วใบเก่าใช้ไม่ได้", ()=>{
 const db=freshDb();
 const created=generateApiKey(["health"]);
 createApiKey(db,created,"k");
 const next=rotateApiKey(db,created.id,["health","ai"]);
 assert.equal(authenticateApiKey(db,created.plaintext,"health").ok,false);
 assert.equal(authenticateApiKey(db,next.plaintext,"ai").ok,true);
 assert.equal(listApiKeys(db).length,1);
 db.close();
});

test("verifyApiKey เทียบแบบ constant time และรับ hash ถูกต้อง", ()=>{
 const c=generateApiKey();
 assert.equal(verifyApiKey(c.plaintext,hashKey(c.plaintext)),true);
 assert.equal(verifyApiKey(c.plaintext,hashKey("other")),false);
});

test("rate limit นับต่อ key และปล่อยหลังหน้าต่างเวลา", ()=>{
 let now=0;
 const rl=new RateLimiter({ip:{limit:3,windowSec:10}},()=>now);
 assert.equal(rl.check("ip","1.1.1.1").allowed,true);
 assert.equal(rl.check("ip","1.1.1.1").allowed,true);
 assert.equal(rl.check("ip","1.1.1.1").allowed,true);
 const blocked=rl.check("ip","1.1.1.1");
 assert.equal(blocked.allowed,false);
 assert.ok(blocked.resetInSec>0);
 assert.equal(rl.check("ip","2.2.2.2").allowed,true);
 now=11_000;
 assert.equal(rl.check("ip","1.1.1.1").allowed,true);
});

test("rate limit รวมหลาย scope แล้วบล็อกถ้ามีสัก scope ที่เกิน", ()=>{
 let now=0;
 const rl=new RateLimiter({ip:{limit:10,windowSec:60},user:{limit:1,windowSec:60}},()=>now);
 const first=rl.checkAll({ip:"a",user:"u1",route:"/api/health"});
 assert.equal(first.allowed,true);
 const second=rl.checkAll({ip:"a",user:"u1",route:"/api/health"});
 assert.equal(second.allowed,false);
 assert.equal(second.scope,"user");
});

test("setup engine รันตามลำดับและบันทึกลงฐานข้อมูล", async ()=>{
 const db=freshDb();
 const ctx:SetupContext={env:{},db,state:{}};
 const report=await runSetup([
  {id:"a",label:"step A",run:()=>stepResult("a","step A","ทำแล้ว")},
  {id:"b",label:"step B",run:()=>stepResult("b","step B","ทำแล้ว")}
 ],ctx,db);
 assert.equal(report.ready,true);
 assert.equal(report.results.length,2);
 assert.equal(report.results[0].id,"a");
 assert.equal(report.results[1].id,"b");
 const saved=lastSetupResult(db);
 assert.ok(saved);
 assert.equal(saved?.status,"READY");
 assert.equal(saved?.results.length,2);
 db.close();
});

test("setup engine ข้าม required step ถัดไปเมื่อขั้นก่อนพัง และไม่ throw", async ()=>{
 const db=freshDb();
 const ctx:SetupContext={env:{},db,state:{}};
 const report=await runSetup([
  {id:"boom",label:"boom",required:true,run:()=>{throw new Error("พัง");}},
  {id:"never",label:"never",required:true,run:()=>stepResult("never","never","ไม่ควรรัน")},
  {id:"optional",label:"optional",run:()=>stepResult("optional","optional","รันต่อได้")}
 ],ctx,db);
 assert.equal(report.ready,false);
 assert.deepEqual(report.blockedBy,["boom"]);
 assert.equal(report.results[0].status,"FAIL");
 assert.equal(report.results[1].status,"SKIP");
 assert.equal(report.results[2].status,"PASS");
 assert.equal(lastSetupResult(db)?.status,"BLOCKED");
 db.close();
});

test("setup engine จับ error เป็น FAIL ไม่ให้ process ล้ม", async ()=>{
 const db=freshDb();
 const ctx:SetupContext={env:{},db,state:{}};
 const report=await runSetup([{id:"x",label:"x",run:async()=>{throw new Error("db ล่ม");}}],ctx);
 assert.equal(report.results[0].status,"FAIL");
 assert.match(report.results[0].detail,/db ล่ม/);
 db.close();
});