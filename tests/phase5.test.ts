import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, runMigrations } from "../src/database/index.js";
import { createPoll, vote, tally, closePoll, voterCount, hasVoted } from "../src/services/polls.js";
import { createGiveaway, enter, drawWinners, entryCount, participants, randomInt } from "../src/services/giveaways.js";
import { createTicket, claimTicket, closeTicket, autoCloseIdle, touchTicket, ticketStats } from "../src/services/tickets.js";
import { validateWebhookUrl, registerWebhook, signPayload, verifySignature, deliver, deliveryLog, disableWebhook } from "../src/services/webhooks.js";
import { validateManifest, createRegistry, install, enable, disable, uninstall, securityReport, fingerprint, isSecretKey } from "../src/plugins/registry.js";
import { createPkce, authorizeUrl, canManage, verifyRedirect, createSession, readSession, exchangeCode, fetchUser, fetchGuilds } from "../src/auth/oauth.js";

function freshDb(){
 const db=openDatabase(":memory:");
 runMigrations(db);
 return db;
}

const newPoll=(db:ReturnType<typeof openDatabase>,over:Record<string,unknown>={})=>createPoll(db,{
 guildId:"g1",question:"เลือกอะไร",options:["a","b","c"],durationSec:600,createdBy:"m1",...over
} as never);

test("poll validate ตัวเลือกและคำถาม", ()=>{
 const db=freshDb();
 assert.throws(()=>createPoll(db,{guildId:"g",question:"",options:["a","b"],durationSec:60,createdBy:"m"}));
 assert.throws(()=>createPoll(db,{guildId:"g",question:"q",options:["a"],durationSec:60,createdBy:"m"}));
 assert.throws(()=>createPoll(db,{guildId:"g",question:"q",options:["a","a"],durationSec:60,createdBy:"m"}));
 assert.throws(()=>createPoll(db,{guildId:"g",question:"q",options:["a","b"],durationSec:0,createdBy:"m"}));
 db.close();
});

test("poll เลือกได้ตัวเดียว และเปลี่ยนคะแนนได้", ()=>{
 const db=freshDb();
 const p=newPoll(db);
 assert.equal(vote(db,p.id,"u1",0).ok,true);
 const again=vote(db,p.id,"u1",0);
 assert.equal(again.ok,true);
 assert.match(again.reason,/ซ้ำ/);
 const changed=vote(db,p.id,"u1",2);
 assert.match(changed.reason,/เปลี่ยน/);
 assert.equal(voterCount(db,p.id),1);
 const t=tally(db,p.id)!;
 assert.equal(t.totalVotes,1);
 assert.equal(t.options[2].votes,1);
 assert.equal(t.options[0].votes,0);
 db.close();
});

test("poll แบบ multiple ลงได้หลายตัวแต่ตัวเดิมซ้ำไม่ได้", ()=>{
 const db=freshDb();
 const p=newPoll(db,{multiple:true});
 assert.equal(vote(db,p.id,"u1",0).ok,true);
 assert.equal(vote(db,p.id,"u1",1).ok,true);
 const dup=vote(db,p.id,"u1",1);
 assert.match(dup.reason,/ซ้ำ/);
 assert.equal(voterCount(db,p.id),1);
 assert.equal(tally(db,p.id)!.totalVotes,2);
 db.close();
});

test("poll ปิดแล้วลงคะแนนไม่ได้ และนับเสียงถูกต้อง", ()=>{
 const db=freshDb();
 const p=newPoll(db,{multiple:true});
 vote(db,p.id,"a",0);
 vote(db,p.id,"b",0);
 vote(db,p.id,"c",1);
 closePoll(db,p.id);
 const rejected=vote(db,p.id,"d",2);
 assert.equal(rejected.ok,false);
 assert.match(rejected.reason,/ปิด/);
 const t=tally(db,p.id)!;
 assert.equal(t.closed,true);
 assert.equal(t.options[0].votes,2);
 assert.equal(t.options[0].percent,67);
 assert.equal(hasVoted(db,p.id,"a"),true);
 db.close();
});

test("poll หมดเวลาแล้วถือว่าปิด", ()=>{
 const db=freshDb();
 const p=newPoll(db,{durationSec:1});
 const r=vote(db,p.id,"u1",0,Date.now()+2000);
 assert.equal(r.ok,false);
 assert.match(r.reason,/ปิด/);
 db.close();
});

test("giveaway สร้างและเข้าร่วมครั้งเดียว", ()=>{
 const db=freshDb();
 const g=createGiveaway(db,{guildId:"g1",title:"รางวัล",winners:2,durationSec:600,createdBy:"m1"});
 const e=enter(db,g.id,{userId:"u1",accountCreatedAt:new Date().toISOString(),roleIds:[]});
 assert.equal(e.ok,true);
 const dup=enter(db,g.id,{userId:"u1",accountCreatedAt:new Date().toISOString(),roleIds:[]});
 assert.equal(dup.ok,false);
 assert.match(dup.reason,/เข้าร่วมไปแล้ว/);
 assert.equal(entryCount(db,g.id),1);
 db.close();
});

test("giveaway บังคับอายุบัญชีและ role", ()=>{
 const db=freshDb();
 const g=createGiveaway(db,{guildId:"g1",title:"r",winners:1,durationSec:600,createdBy:"m",requirements:{minAccountAgeDays:30,roleIds:["role-x"]}});
 const young=enter(db,g.id,{userId:"u1",accountCreatedAt:new Date(Date.now()-86400000).toISOString(),roleIds:["role-x"]});
 assert.equal(young.ok,false);
 assert.match(young.reason,/อายุ/);
 const norole=enter(db,g.id,{userId:"u2",accountCreatedAt:new Date(Date.now()-400*86400000).toISOString(),roleIds:[]});
 assert.equal(norole.ok,false);
 assert.match(norole.reason,/role/);
 const okEntry=enter(db,g.id,{userId:"u3",accountCreatedAt:new Date(Date.now()-400*86400000).toISOString(),roleIds:["role-x"]});
 assert.equal(okEntry.ok,true);
 db.close();
});

test("giveaway สุ่มผู้ชนะไม่เกินจำนวนที่ขอและสุ่มซ้ำไม่ได้", ()=>{
 const db=freshDb();
 const g=createGiveaway(db,{guildId:"g1",title:"r",winners:2,durationSec:600,createdBy:"m"});
 for(const u of ["a","b","c"]) enter(db,g.id,{userId:u,accountCreatedAt:new Date().toISOString(),roleIds:[]});
 const r=drawWinners(db,g.id);
 assert.equal(r.winners.length,2);
 assert.equal(new Set(r.winners).size,2);
 for(const w of r.winners) assert.ok(participants(db,g.id).includes(w));
 assert.throws(()=>drawWinners(db,g.id),/สุ่มผู้ชนะไปแล้ว/);
 db.close();
});

test("giveaway สุ่มไม่ได้เมื่อไม่มีผู้เข้าร่วม และ randomInt ใช้ crypto", ()=>{
 const db=freshDb();
 const g=createGiveaway(db,{guildId:"g1",title:"r",winners:1,durationSec:600,createdBy:"m"});
 assert.throws(()=>drawWinners(db,g.id),/ไม่มีผู้เข้าร่วม/);
 const seen=new Set<number>();
 for(let i=0;i<200;i++){ const v=randomInt(5); assert.ok(v>=0&&v<5); seen.add(v); }
 assert.equal(seen.size,5,"ควรกระจายครบทุกค่า");
 assert.throws(()=>randomInt(0));
 db.close();
});

test("ticket จำกัดจำนวนที่เปิดพร้อมกันและ claim ได้คนเดียว", ()=>{
 const db=freshDb();
 createTicket(db,{guildId:"g1",userId:"u1",subject:"a",limitPerUser:2});
 createTicket(db,{guildId:"g1",userId:"u1",subject:"b",limitPerUser:2});
 assert.throws(()=>createTicket(db,{guildId:"g1",userId:"u1",subject:"c",limitPerUser:2}),/ไม่เกิน 2/);
 const t=createTicket(db,{guildId:"g1",userId:"u2",subject:"x"});
 assert.equal(claimTicket(db,t.id,"staff1").claimedBy,"staff1");
 assert.throws(()=>claimTicket(db,t.id,"staff2"),/ถูกรับไปแล้ว/);
 assert.equal(closeTicket(db,t.id).status,"closed");
 assert.throws(()=>claimTicket(db,t.id,"staff3"),/ปิดแล้ว/);
 db.close();
});

test("ticket auto-close เฉพาะที่ไม่มี activity เกินเวลา", ()=>{
 const db=freshDb();
 const old=new Date(Date.now()-120*60000).toISOString();
 const idle=createTicket(db,{guildId:"g1",userId:"u1",subject:"idle"});
 const active=createTicket(db,{guildId:"g1",userId:"u2",subject:"active"});
 db.prepare("UPDATE tickets SET last_activity_at = ? WHERE id = ?").run(old,idle.id);
 touchTicket(db,active.id);
 const r=autoCloseIdle(db,"g1",60);
 assert.deepEqual(r.closed,[idle.id]);
 assert.equal(ticketStats(db,"g1").closed,1);
 db.close();
});

test("webhook URL บล็อก http และ host ภายใน (กัน SSRF)", ()=>{
 assert.equal(validateWebhookUrl("https://example.com/hook").ok,true);
 assert.equal(validateWebhookUrl("http://example.com/hook").ok,false);
 assert.equal(validateWebhookUrl("https://localhost/hook").ok,false);
 assert.equal(validateWebhookUrl("https://127.0.0.1/hook").ok,false);
 assert.equal(validateWebhookUrl("https://10.0.0.5/hook").ok,false);
 assert.equal(validateWebhookUrl("https://192.168.1.1/hook").ok,false);
 assert.equal(validateWebhookUrl("https://169.254.169.254/latest/meta-data").ok,false);
 assert.equal(validateWebhookUrl("not-a-url").ok,false);
});

test("webhook ลงทะเบียนแล้วส่งพร้อมลายเซ็นที่ตรวจสอบได้", async ()=>{
 const db=freshDb();
 const secret="s".repeat(32);
 const ep=registerWebhook(db,{url:"https://example.com/hook",events:["moderation"],secret});
 let received:{url:string;header:string;body:string}|null=null;
 const fetchImpl=async(url:string,init:{headers:Record<string,string>;body:string})=>{
  received={url,header:init.headers["x-linuxbot-signature"],body:init.body};
  return {status:200};
 };
 const r=await deliver(db,ep.id,"moderation",{reason:"test"},secret,fetchImpl);
 assert.equal(r.ok,true);
 assert.equal(r.attempts,1);
 const check=verifySignature(secret,(received as unknown as {body:string}).body,(received as unknown as {header:string}).header);
 assert.equal(check.ok,true);
 assert.equal(verifySignature("other-secret",(received as unknown as {body:string}).body,(received as unknown as {header:string}).header).ok,false);
 db.close();
});

test("webhook retry เมื่อ server ล้ม และหยุดเมื่อ 4xx", async ()=>{
 const db=freshDb();
 const secret="s".repeat(32);
 const ep=registerWebhook(db,{url:"https://example.com/hook",events:["system"],secret});
 let calls=0;
 const failing=async()=>{calls++;throw new Error("connection reset");};
 const r=await deliver(db,ep.id,"system",{a:1},secret,failing,3,100);
 assert.equal(r.ok,false);
 assert.equal(calls,3,"ต้อง retry ครบ 3 ครั้ง");
 assert.equal(deliveryLog(db,ep.id).length,3);

 let badCalls=0;
 const badRequest=async()=>{badCalls++;return {status:400};};
 const r2=await deliver(db,ep.id,"system",{a:1},secret,badRequest,3,100);
 assert.equal(r2.ok,false);
 assert.equal(badCalls,1,"4xx ไม่ควร retry");
 db.close();
});

test("webhook ปฏิเสธ event ที่ไม่ได้ติดตาม และ endpoint ที่ปิด", async ()=>{
 const db=freshDb();
 const secret="s".repeat(32);
 const ep=registerWebhook(db,{url:"https://example.com/hook",events:["system"],secret});
 let called=0;
 const f=async()=>{called++;return {status:200};};
 const wrong=await deliver(db,ep.id,"ai",{},secret,f);
 assert.equal(wrong.ok,false);
 assert.equal(called,0,"ต้องไม่ยิงจริงเมื่อ event ไม่ตรง");
 disableWebhook(db,ep.id);
 const disabled=await deliver(db,ep.id,"system",{},secret,f);
 assert.equal(disabled.ok,false);
 assert.equal(called,0);
 db.close();
});

const manifest={name:"hello-plugin",version:"1.0.0",author:"me",description:"d",permissions:["register_command"],dependencies:[],commands:[{name:"hello",description:"h"}],events:[],routes:[]};

test("plugin manifest validate รับของถูกต้อง ตีค่าที่ผิด", ()=>{
 assert.equal(validateManifest(manifest).ok,true);
 assert.equal(validateManifest({...manifest,version:"1.0"}).ok,false);
 assert.equal(validateManifest({...manifest,name:"Bad Name"}).ok,false);
 assert.equal(validateManifest({...manifest,permissions:["nope"]}).ok,false);
 assert.equal(validateManifest({...manifest,permissions:["write_settings"]}).ok,false);
 assert.equal(validateManifest({...manifest,commands:[{name:"a"},{name:"a"}]}).ok,false);
 assert.equal(validateManifest({...manifest,routes:[{method:"FETCH",path:"x"}]}).ok,false);
 assert.equal(validateManifest(null).ok,false);
});

test("plugin register คำสั่ง/event/route และถอดออกได้ครบ", ()=>{
 const r=createRegistry();
 const res=install(r,manifest);
 assert.equal(res.ok,true);
 const api=(r.plugins.get("hello-plugin") as unknown as {api:{registerCommand:(n:string,d:string,h:()=>void)=>void}}).api;
 api.registerCommand("hello","h",()=>1);
 assert.equal(r.commands.has("hello"),true);
 enable(r,"hello-plugin");
 assert.equal(r.enabled.has("hello-plugin"),true);
 uninstall(r,"hello-plugin");
 assert.equal(r.commands.has("hello"),false);
 assert.equal(r.plugins.has("hello-plugin"),false);
});

test("plugin ติดตั้งซ้ำไม่ได้ และบังคับ dependency", ()=>{
 const r=createRegistry();
 assert.equal(install(r,manifest).ok,true);
 assert.equal(install(r,manifest).ok,false);
 assert.equal(install(r,{...manifest,name:"needs-dep",dependencies:["nope"]}).ok,false);
});

test("plugin ถูกจองชื่อคำสั่งซ้ำไม่ได้", ()=>{
 const r=createRegistry();
 install(r,manifest);
 const a=(r.plugins.get("hello-plugin") as unknown as {api:{registerCommand:(n:string,d:string,h:()=>void)=>void}}).api;
 a.registerCommand("x","x",()=>1);
 assert.throws(()=>a.registerCommand("x","x",()=>1),/จองไว้แล้ว/);
});

test("plugin อ่านหรือเขียน secret ไม่ได้แม้จะมี read_settings", ()=>{
 const r=createRegistry();
 const m={...manifest,permissions:["read_settings","write_settings"]};
 install(r,m);
 const api=(r.plugins.get("hello-plugin") as unknown as {api:{getSetting:(k:string)=>string|null;setSetting:(k:string,v:string)=>void}}).api;
 assert.equal(isSecretKey("DISCORD_TOKEN"),true);
 assert.equal(isSecretKey("theme_color"),false);
 assert.throws(()=>api.getSetting("DISCORD_TOKEN"),/secret/);
 assert.throws(()=>api.setSetting("SESSION_SECRET","x"),/secret/);
 api.setSetting("theme_color","dark");
 assert.equal(api.getSetting("theme_color"),"dark");
});

test("plugin ที่ขอสิทธิ์ครบทุกตัวต้องถูก flag", ()=>{
 const r=createRegistry();
 install(r,{...manifest,permissions:["read_settings","write_settings","register_command","register_event","register_route","register_model"]});
 assert.ok(securityReport(r).length>0);
 assert.equal(fingerprint(manifest).length,16);
});

test("oauth PKCE และ authorize url ถูกต้อง", ()=>{
 process.env.DISCORD_REDIRECT_URI="https://bot.example.com/callback";
 const pkce=createPkce();
 assert.ok(pkce.verifier.length>=43);
 assert.ok(pkce.state.length>=20);
 const url=authorizeUrl({...pkce,clientId:"123"});
 assert.ok(url.startsWith("https://discord.com/oauth2/authorize?"));
 assert.ok(url.includes("code_challenge_method=S256"));
 assert.ok(url.includes("code_challenge="));
 assert.ok(url.includes("scope=identify+guilds"));
});

test("oauth ต้องมี DISCORD_REDIRECT_URI ถึงจะสร้าง URL ได้", ()=>{
 const prev=process.env.DISCORD_REDIRECT_URI;
 delete process.env.DISCORD_REDIRECT_URI;
 assert.throws(()=>authorizeUrl({...createPkce(),clientId:"1"}),/DISCORD_REDIRECT_URI/);
 if(prev) process.env.DISCORD_REDIRECT_URI=prev;
});

test("oauth ตรวจสิทธิ์ Manage Server จาก permission bits จริง", ()=>{
 assert.equal(canManage({id:"1",name:"g",permissions:"256",owner:false}).ok,true);
 assert.equal(canManage({id:"1",name:"g",permissions:"32",owner:false}).ok,true);
 assert.equal(canManage({id:"1",name:"g",permissions:"0",owner:false}).ok,false);
 assert.equal(canManage({id:"1",name:"g",permissions:"0",owner:true}).ok,true);
});

test("oauth redirect uri ต้องตรงกับที่ตั้งไว้", ()=>{
 assert.equal(verifyRedirect("https://bot.example.com/callback","https://bot.example.com/callback").ok,true);
 assert.equal(verifyRedirect("https://bot.example.com/callback","https://evil.com/callback").ok,false);
 assert.equal(verifyRedirect(undefined,"https://x.com").ok,false);
});

test("oauth session หมดอายุตามเวลา", ()=>{
 const user={id:"u1",username:"me"};
 const guilds=[{id:"g1",name:"G",permissions:"32",owner:false}];
 const s=createSession(user,guilds,60,1000);
 assert.equal(readSession(s,2000).ok,true);
 assert.equal(readSession(s,1000+61000).ok,false);
 assert.equal(readSession(null).ok,false);
});

test("oauth exchangeCode และ fetch ตรวจ error จาก Discord จริง", async ()=>{
 const okFetch=async()=>({status:200,json:async()=>({access_token:"tok",token_type:"Bearer",expires_in:604800,scope:"identify"})});
 const cfg={clientId:"1",clientSecret:"s",redirectUri:"https://x.com/cb"};
 const pkce=createPkce();
 const t=await exchangeCode(cfg,pkce,"code123",okFetch);
 assert.equal(t.access_token,"tok");

 const userFetch=async()=>({status:200,json:async()=>({id:"u1",username:"me"})});
 assert.equal((await fetchUser("tok",userFetch)).id,"u1");

 const guildFetch=async()=>({status:200,json:async()=>[{id:"g1",name:"G",permissions:"32",owner:false}]});
 assert.equal((await fetchGuilds("tok",guildFetch))[0].id,"g1");

 const badFetch=async()=>({status:401,json:async()=>({error:"invalid_grant",error_description:"bad code"})});
 await assert.rejects(()=>exchangeCode(cfg,pkce,"bad",badFetch),/token exchange ล้มเหลว \(401\)/);
});