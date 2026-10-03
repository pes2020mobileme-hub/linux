import { Client, Events, GatewayIntentBits } from "discord.js";
import { ENV_SPECS, validateValue } from "../config/env.js";
import { listFeatures, isEnabled } from "../config/features.js";
import { ensureInternalSecrets } from "./secret-manager.js";
import { runDoctor, summarize } from "./doctor.js";
import { openDatabase, runMigrations, checkDatabase } from "../database/index.js";
import { pickGuildId } from "../config/discovery.js";
import { registerCommands } from "../bot/auto-register.js";
import { stepResult, type SetupContext, type SetupStep } from "./setup-engine.js";
import { RaidDetector } from "../security/anti-raid.js";
import { checkOpenRouter, DEFAULT_MODEL } from "../ai/provider.js";

export function buildBootSteps():SetupStep[]{
 return [
  {id:"detect",label:"ตรวจ environment",run:ctx=>{
   const bad=ENV_SPECS.filter(s=>s.required&&!ctx.env[s.key]).map(s=>s.key);
   const invalid=ENV_SPECS.filter(s=>ctx.env[s.key]&&validateValue(s.key,ctx.env[s.key]!)).map(s=>s.key);
   if(bad.length) return stepResult("detect","ตรวจ environment","ไม่ครบ: "+bad.join(", "),"FAIL","ใส่ค่าที่ขาดใน .env หรือ GitHub Secrets");
   if(invalid.length) return stepResult("detect","ตรวจ environment","รูปแบบผิด: "+invalid.join(", "),"FAIL","แก้ค่าใน .env");
   const set=ENV_SPECS.filter(s=>ctx.env[s.key]).length;
   return stepResult("detect","ตรวจ environment",`${set} ตัวแปรถูกตั้ง ครบทุกตัวที่จำเป็น`);
  }},
  {id:"secrets",label:"สร้าง secret ภายใน",run:ctx=>{
   const r=ensureInternalSecrets(ctx.env);
   return r.persisted
    ? stepResult("secrets","สร้าง secret ภายใน",`สร้างใหม่ ${r.created.length} ตัว: ${r.created.join(", ")}`)
    : stepResult("secrets","สร้าง secret ภายใน","มีครบแล้ว ไม่ต้องสร้างใหม่");
  }},
  {id:"database",label:"เปิด database และ migrate",required:true,run:ctx=>{
   if(!ctx.db) ctx.db=openDatabase();
   const m=runMigrations(ctx.db);
   const c=checkDatabase(ctx.db);
   return c.state==="PASS"
    ? stepResult("database","เปิด database และ migrate",m.applied.length?`รันใหม่: ${m.applied.join(", ")}`:`ไม่ต้อง migrate ใหม่ (${m.skipped.length} เวอร์ชัน) · ${c.detail}`)
    : stepResult("database","เปิด database และ migrate",c.detail,"FAIL");
  }},
  {id:"seed",label:"ใส่ค่าเริ่มต้น",run:ctx=>{
   if(!ctx.db) return stepResult("seed","ใส่ค่าเริ่มต้น","ไม่มี database","SKIP");
   const now=new Date().toISOString();
   const stmt=ctx.db.prepare("INSERT INTO system_logs (level, scope, message, created_at) VALUES (?, ?, ?, ?)");
   stmt.run("INFO","setup","first boot ของระบบ",now);
   return stepResult("seed","ใส่ค่าเริ่มต้น","บันทึก system log ของ first boot แล้ว");
  }},
  {id:"discord-login",label:"เข้า Discord",required:true,run:async ctx=>{
   const token=ctx.env.DISCORD_TOKEN;
   if(!token) return stepResult("discord-login","เข้า Discord","ไม่มี DISCORD_TOKEN","FAIL","ใส่ DISCORD_TOKEN ใน .env");
   const client=new Client({intents:[GatewayIntentBits.Guilds]});
   const ready=new Promise<void>((resolve,reject)=>{
    client.once(Events.ClientReady,()=>resolve());
    setTimeout(()=>reject(new Error("ต่อ Discord Gateway ไม่ได้ภายใน 30 วินาที")),30000);
   });
   try{
    await client.login(token);
    await ready;
   }catch(e){
    try{client.destroy();}catch{}
    return stepResult("discord-login","เข้า Discord",e instanceof Error?e.message:String(e),"FAIL","ตรวจว่า token ถูกต้องและบอทถูกเชิญเข้า server แล้ว");
   }
   ctx.state.client=client;
   ctx.clientId=client.user?.id;
   const ping=client.ws.ping;
   const pingText=Number.isFinite(ping)&&ping>=0?`${Math.round(ping)}ms`:"ยังไม่มี heartbeat (รอจังหวะแรก)";
   return stepResult("discord-login","เข้า Discord",`ออนไลน์แล้วในชื่อ ${client.user?.tag} · ping ${pingText} · ${client.guilds.cache.size} server`);
  }},
  {id:"guild",label:"เลือก server ที่ใช้งาน",required:true,run:ctx=>{
   const client=ctx.state.client as Client|undefined;
   if(!client) return stepResult("guild","เลือก server ที่ใช้งาน","ยังไม่ได้ login","SKIP");
   const picked=pickGuildId(client);
   if(!picked.ok) return stepResult("guild","เลือก server ที่ใช้งาน",picked.reason,"FAIL","ตั้ง GUILD_ID หรือเชิญบอทเข้า server เดียว");
   ctx.guildId=picked.id;
   const g=client.guilds.cache.get(picked.id);
   return stepResult("guild","เลือก server ที่ใช้งาน",`${g?.name??picked.id} (${picked.id}) — ${picked.how}`);
  }},
  {id:"commands",label:"register slash commands",run:async ctx=>{
   if(!ctx.clientId||!ctx.guildId) return stepResult("commands","register slash commands","ยังไม่รู้ client ID หรือ guild ID","SKIP");
   const r=await registerCommands(ctx.clientId,ctx.guildId);
   return r.ok
    ? stepResult("commands","register slash commands",`สำเร็จ (ลอง ${r.attempts} ครั้ง)`)
    : stepResult("commands","register slash commands",`ล้มเหลวหลัง ${r.attempts} ครั้ง: ${r.error}`,"WARN","บอทยังทำงานได้ แต่คำสั่งใน Discord อาจไม่ตรงกับโค้ด");
  }},
  {id:"oauth",label:"ตรวจ OAuth2",run:ctx=>{
   if(!ctx.env.DISCORD_CLIENT_SECRET) return stepResult("oauth","ตรวจ OAuth2","ไม่ได้ตั้ง DISCORD_CLIENT_SECRET — ยืนยันไม่ได้","UNKNOWN","สร้าง Client Secret ใน Discord Developer Portal เพื่อเปิดใช้ login ของ Dashboard");
   return stepResult("oauth","ตรวจ OAuth2","ตั้งค่าแล้ว แต่ยังไม่ได้ทดสอบ token exchange","UNKNOWN");
  }},
  {id:"ai",label:"ตรวจ AI provider",required:false,run:async ctx=>{
   if(!isEnabled("AI",ctx.env)) return stepResult("ai","ตรวจ AI provider","ฟีเจอร์ AI ปิดอยู่","SKIP");
   const model=ctx.env.OPENROUTER_MODEL;
   const check=await checkOpenRouter(ctx.env.OPENROUTER_API_KEY,model||DEFAULT_MODEL);
   const status=check.state==="PASS"?"PASS":check.state==="FAIL"?"WARN":"UNKNOWN";
   return stepResult("ai","ตรวจ AI provider",check.detail,status,check.fix);
  }},
  {id:"features",label:"เปิดใช้ feature flags",run:ctx=>{
   const on=listFeatures(ctx.env).filter(f=>f.enabled).map(f=>f.name);
   const off=listFeatures(ctx.env).filter(f=>!f.enabled).map(f=>f.name);
   return stepResult("features","เปิดใช้ feature flags",`เปิด: ${on.join(", ")||"ไม่มี"} · ปิด: ${off.join(", ")||"ไม่มี"}`);
  }},
  {id:"security",label:"เตรียมระบบความปลอดภัย",run:ctx=>{
   ctx.state.raid=new RaidDetector({},v=>{
    if(!ctx.db||!v.shouldAct) return;
    ctx.db.prepare("INSERT INTO security_events (guild_id, kind, level, count, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
     .run(v.guildId,v.kind,v.level,v.count,v.reason,new Date().toISOString());
   });
   return stepResult("security","เตรียมระบบความปลอดภัย",`anti-raid พร้อม (หน้าต่าง ${10} วินาที) · API key เก็บเป็น hash เท่านั้น`);
  }},
  {id:"health",label:"health check",run:ctx=>{
   const c=ctx.db?checkDatabase(ctx.db):{state:"UNKNOWN" as const,detail:"ไม่มี database"};
   return c.state==="PASS"
    ? stepResult("health","health check",c.detail)
    : stepResult("health","health check",c.detail,c.state==="FAIL"?"FAIL":"UNKNOWN");
  }},
  {id:"doctor",label:"doctor",run:ctx=>{
   const all=runDoctor(ctx.env);
   const s=summarize(all);
   const failures=all.filter(c=>c.state==="FAIL");
   const status=s.FAIL>0?"FAIL":s.WARN>0?"WARN":"PASS";
   const detail=failures.length
    ? `PASS ${s.PASS} · WARN ${s.WARN} · FAIL ${s.FAIL} · UNKNOWN ${s.UNKNOWN} — ต้องแก้: ${failures.map(f=>f.label).join(", ")}`
    : `PASS ${s.PASS} · WARN ${s.WARN} · FAIL ${s.FAIL} · UNKNOWN ${s.UNKNOWN}`;
   const fix=failures.map(f=>`${f.label}: ${f.fix??"ดูรายละเอียด"}`).join(" | ");
   return stepResult("doctor","doctor",detail,status,fix||undefined);
  }}
 ];
}