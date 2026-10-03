import { ENV_SPECS, validateValue } from "../config/env.js";
import { isEnabled } from "../config/features.js";
import { listMissingInternalSecrets, mask } from "./secret-manager.js";

export type CheckState="PASS"|"WARN"|"FAIL"|"UNKNOWN";
export type Check={ id:string; group:string; label:string; state:CheckState; detail:string; fix?:string };

function checkEnvValues(env:NodeJS.ProcessEnv):Check[]{
 return ENV_SPECS.map(spec=>{
  const value=env[spec.key];
  if(!value){
  if(spec.required) return {id:`env:${spec.key}`,group:"Environment",label:spec.key,state:"FAIL",detail:"ไม่ได้ตั้งค่า (จำเป็น)",fix:`ใส่ ${spec.key} ใน .env หรือ GitHub Secrets`};
 if(spec.autoGenerate) return {id:`env:${spec.key}`,group:"Secrets",label:spec.key,state:"PASS",detail:"ระบบสร้างให้อัตโนมัติ"};
 return {id:`env:${spec.key}`,group:"Environment",label:spec.key,state:"WARN",detail:"ไม่ได้ตั้ง (ไม่จำเป็น)",fix:spec.description};
  }
  const problem=validateValue(spec.key,value);
  return problem
   ? {id:`env:${spec.key}`,group:"Environment",label:spec.key,state:"FAIL",detail:problem,fix:`แก้ค่า ${spec.key} ใน .env`}
   : {id:`env:${spec.key}`,group:"Environment",label:spec.key,state:"PASS",detail:`ตั้งแล้ว ${mask(value)}`};
 });
}

function checkRuntime(env:NodeJS.ProcessEnv):Check[]{
 const onActions=Boolean(env.GITHUB_ACTIONS);
 const nodeMajor=Number(process.versions.node.split(".")[0]);
 const checks:Check[]=[
  {id:"runtime:node",group:"Runtime",label:"Node.js",state:"PASS",detail:`${process.version} (${process.platform}/${process.arch})`},
  {id:"runtime:node-version",group:"Runtime",label:"Node.js >= 22 (ต้องการ node:sqlite)",state:nodeMajor>=22?"PASS":"FAIL",
   detail:nodeMajor>=22?"รองรับ (ต้องการ 22 ขึ้นไป)":`ยังต่ำกว่าที่ต้องใช้ — ได้ ${process.versions.node}`,
   fix:nodeMajor>=22?undefined:"อัปเกรด Node.js เป็น 22 หรือใหม่กว่า"},
  {id:"runtime:persistence",group:"Runtime",label:"Persistent storage",state:onActions?"FAIL":"PASS",
   detail:onActions?"รันบน GitHub Actions — filesystem ชั่วคราว ข้อมูลหายทุกครั้งที่ restart":"filesystem เขียนได้ถาวร",
   fix:onActions?"ย้ายไป Cloudflare Containers, VPS หรือ cloud ที่มี disk ถาวร":undefined},
  {id:"runtime:voice",group:"Runtime",label:"Voice / Music",state:"UNKNOWN",
   detail:onActions?"GitHub Actions ไม่รองรับ UDP voice ของ Discord — เล่นเพลงไม่ได้":"ยังไม่ได้ทดสอบ UDP voice บน runtime นี้",
   fix:onActions?"ปิดฟีเจอร์ MUSIC หรือย้ายไป host ที่รองรับ voice":"ทดสอบด้วย /play เมื่อเปิดฟีเจอร์"},
  {id:"runtime:gateway",group:"Runtime",label:"Outbound WebSocket",state:"UNKNOWN",detail:"ยังไม่ได้เชื่อม Discord Gateway ใน check นี้",fix:"รันบอทแล้วดูว่า gateway เชื่อมได้"}
 ];
 return checks;
}

function checkDiscord(env:NodeJS.ProcessEnv):Check[]{
 if(!env.DISCORD_TOKEN) return [{id:"discord:token",group:"Discord",label:"Bot Token",state:"FAIL",detail:"ไม่ได้ตั้ง DISCORD_TOKEN",fix:"ใส่ DISCORD_TOKEN ใน .env หรือ GitHub Secrets"}];
 if(!env.DISCORD_CLIENT_SECRET) return [{id:"discord:oauth",group:"Discord",label:"OAuth2 (Dashboard login)",state:"UNKNOWN",detail:"ไม่ได้ตั้ง DISCORD_CLIENT_SECRET — ยืนยันไม่ได้",fix:"สร้าง Client Secret ใน Discord Developer Portal แล้วใส่ใน .env"}];
 return [{id:"discord:oauth",group:"Discord",label:"OAuth2 (Dashboard login)",state:"UNKNOWN",detail:"ตั้งค่าแล้ว แต่ยังไม่ได้ทดสอบ token exchange",fix:"รัน /api/doctor หลัง Dashboard ขึ้น"}];
}

function checkAi(env:NodeJS.ProcessEnv):Check[]{
 if(!isEnabled("AI",env)) return [{id:"ai:provider",group:"AI",label:"OpenRouter",state:"UNKNOWN",detail:"ฟีเจอร์ AI ปิดอยู่ (AI_ENABLED=false)"}];
 if(!env.OPENROUTER_API_KEY) return [{id:"ai:provider",group:"AI",label:"OpenRouter",state:"FAIL",detail:"เปิด AI ไว้แต่ไม่ได้ตั้ง OPENROUTER_API_KEY",fix:"ใส่ OPENROUTER_API_KEY หรือตั้ง AI_ENABLED=false"}];
 return [{id:"ai:provider",group:"AI",label:"OpenRouter",state:"UNKNOWN",detail:"ตั้งค่าแล้ว แต่ยังไม่ได้ทดสอบการเรียก API",fix:"ทดสอบด้วย /ai ask"}];
}

function checkSecrets(env:NodeJS.ProcessEnv):Check[]{
 const missing=listMissingInternalSecrets(env);
 if(!missing.length) return [{id:"secret:internal",group:"Secrets",label:"Internal secrets",state:"PASS",detail:"ครบทุกตัวแล้ว"}];
 return [{id:"secret:internal",group:"Secrets",label:"Internal secrets",state:"WARN",
  detail:`ยังไม่มี ${missing.length} ตัว (${missing.join(", ")})`,fix:"ระบบจะสร้างให้เองในไฟล์ .env ตอนบอทเริ่มทำงาน"}];
}

export function runDoctor(env:NodeJS.ProcessEnv=process.env){
 return [...checkRuntime(env),...checkEnvValues(env),...checkSecrets(env),...checkDiscord(env),...checkAi(env)];
}

export function summarize(checks:Check[]){
 return checks.reduce<Record<CheckState,number>>((acc,c)=>({...acc,[c.state]:(acc[c.state]??0)+1}),{PASS:0,WARN:0,FAIL:0,UNKNOWN:0});
}

const ICON:Record<CheckState,string>={PASS:"✓",WARN:"!",FAIL:"✗",UNKNOWN:"?"};

export function formatReport(checks:Check[]){
 const s=summarize(checks);
 const lines=[`ผลรวม: PASS ${s.PASS} · WARN ${s.WARN} · FAIL ${s.FAIL} · UNKNOWN ${s.UNKNOWN}`,""];
 let group="";
 for(const c of checks){
  if(c.group!==group){group=c.group;lines.push(`── ${group} ──`);}
  lines.push(`${ICON[c.state]} ${c.label}: ${c.detail}`);
  if(c.fix&&c.state!=="PASS") lines.push(`    แก้: ${c.fix}`);
 }
 return lines.join("\n");
}