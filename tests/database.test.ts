import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, runMigrations, rollbackLast, tableNames, migrationHistory, checkDatabase } from "../src/database/index.js";
import { MIGRATIONS } from "../src/database/migrations.js";
import { buildRoutes } from "../src/api/health.js";
import http from "node:http";

test("migration ชุดแรกสร้างตารางครบตามที่ประกาศ", ()=>{
 const db=openDatabase(":memory:");
 const r=runMigrations(db);
 assert.equal(r.applied.length,MIGRATIONS.length);
 const tables=tableNames(db);
 for(const t of ["schema_migrations","users","guilds","guild_settings","members","audit_logs","system_logs"]){
  assert.ok(tables.includes(t),`ต้องมีตาราง ${t}`);
 }
 db.close();
});

test("รัน migration ซ้ำไม่ทำอะไรซ้ำ", ()=>{
 const db=openDatabase(":memory:");
 runMigrations(db);
 const second=runMigrations(db);
 assert.equal(second.applied.length,0);
 assert.equal(second.skipped.length,MIGRATIONS.length);
 db.close();
});

test("rollback ล่าสุดแล้วรันกลับมาได้", ()=>{
 const db=openDatabase(":memory:");
 runMigrations(db);
 const target=rollbackLast(db);
 assert.ok(MIGRATIONS.some(m=>m.name===target.replace(/^\d+_/,"")));
 const after=runMigrations(db);
 assert.equal(after.applied.length,1);
 assert.equal(migrationHistory(db).length,MIGRATIONS.length);
 db.close();
});

test("migration ที่ผิดจะถูก rollback และไม่ทิ้งข้อมูลครึ่ง ๆ", ()=>{
 const db=openDatabase(":memory:");
 const brokenSql="CREATE TABLE ok(a); CREATE TABLE bad(";
 assert.throws(()=>runMigrations(db,[{version:1,name:"broken",sql:brokenSql,down:"DROP TABLE IF EXISTS ok;"}]));
 assert.equal(tableNames(db).includes("ok"),false);
 db.close();
});

test("ตรวจ version ซ้ำของ migration ต้องถูกบังคับ", ()=>{
 const db=openDatabase(":memory:");
 assert.throws(()=>runMigrations(db,[
  {version:1,name:"a",sql:"CREATE TABLE a(x);",down:"DROP TABLE IF EXISTS a;"},
  {version:1,name:"b",sql:"CREATE TABLE b(x);",down:"DROP TABLE IF EXISTS b;"}
 ]));
 db.close();
});

test("checkDatabase รายงาน PASS เมื่อ migration ครบ", ()=>{
 const db=openDatabase(":memory:");
 runMigrations(db);
 const c=checkDatabase(db);
 assert.equal(c.state,"PASS");
 assert.match(c.detail,/ตาราง/);
 db.close();
});

async function call(port:string,path:string,method="GET"){
 return new Promise<{code:number;body:any}>((resolve,reject)=>{
  const req=http.request({host:"127.0.0.1",port,path,method},res=>{
   let raw="";
   res.on("data",c=>raw+=c);
   res.on("end",()=>resolve({code:res.statusCode??0,body:raw?JSON.parse(raw):null}));
  });
  req.on("error",reject);
  req.end();
 });
}

test("health API ตอบทุก endpoint และไม่เปิด secret", async ()=>{
 const db=openDatabase(":memory:");
 runMigrations(db);
 const server=http.createServer(buildRoutes({db,runtime:()=>({discord:"online",pingMs:12,uptimeSec:5,guildCount:2})}));
 await new Promise<void>(r=>server.listen(0,r));
 const port=String((server.address() as {port:number}).port);

 const health=await call(port,"/api/health");
 assert.equal(health.code,200);
 assert.equal(health.body.status,"ok");
 assert.equal(health.body.discord,"online");

 const ready=await call(port,"/api/ready");
 assert.equal(ready.code,200);
 assert.equal(ready.body.ready,true);

 const status=await call(port,"/api/status");
 assert.equal(status.code,200);
 assert.equal(status.body.discord.guildCount,2);
 assert.equal(status.body.features.length,13);

 const doctor=await call(port,"/api/doctor");
 assert.ok(doctor.code===200||doctor.code===503);
 assert.ok(doctor.body.summary);

 const setup=await call(port,"/api/setup/status");
 assert.equal(setup.code,200);
 assert.ok(Array.isArray(setup.body.secrets));
 assert.ok(setup.body.secrets.every((s:any)=>!("value" in s)),"setup/status ห้ามคืนค่า secret");

 const missing=await call(port,"/api/nope");
 assert.equal(missing.code,404);

 const wrongMethod=await call(port,"/api/health","POST");
 assert.equal(wrongMethod.code,405);

 server.close();
 db.close();
});

test("ready ต้องตอบ 503 เมื่อบอทยัง offline", async ()=>{
 const db=openDatabase(":memory:");
 runMigrations(db);
 const server=http.createServer(buildRoutes({db,runtime:()=>({discord:"offline",pingMs:null,uptimeSec:1,guildCount:0})}));
 await new Promise<void>(r=>server.listen(0,r));
 const port=String((server.address() as {port:number}).port);
 const ready=await call(port,"/api/ready");
 assert.equal(ready.code,503);
 assert.equal(ready.body.ready,false);
 server.close();
 db.close();
});
