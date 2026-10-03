import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_GENERATED_KEYS, REQUIRED_KEYS, validateValue } from "../src/config/env.js";
import { generateSecret, mask } from "../src/setup/secret-manager.js";
import { listFeatures, isEnabled } from "../src/config/features.js";
import { runDoctor, summarize } from "../src/setup/doctor.js";

test("DISCORD_TOKEN เป็น required และ DISCORD_CLIENT_ID เป็น optional", ()=>{
 assert.ok(REQUIRED_KEYS.includes("DISCORD_TOKEN"));
 assert.ok(!REQUIRED_KEYS.includes("DISCORD_CLIENT_ID"));
});

test("internal secrets ถูกทำเครื่องหมายให้สร้างอัตโนมัติ", ()=>{
 for(const key of ["SESSION_SECRET","COOKIE_SECRET","ENCRYPTION_KEY","INTERNAL_API_SECRET","WEBHOOK_SIGNING_SECRET","BACKUP_ENCRYPTION_KEY"]){
  assert.ok(AUTO_GENERATED_KEYS.includes(key),`${key} ควรถูก generate อัตโนมัติ`);
 }
});

test("generateSecret สุ่มใหม่ทุกครั้งและยาว 64 ตัวอักษร", ()=>{
 const a=generateSecret();
 const b=generateSecret();
 assert.equal(a.length,64);
 assert.notEqual(a,b);
});

test("mask ไม่เผยค่าจริงของ secret", ()=>{
 const secret=generateSecret();
 const masked=mask(secret);
 assert.ok(!masked.includes(secret.slice(0,8)));
 assert.ok(!masked.includes(secret));
 assert.ok(masked.includes("64"));
});

test("mask รายงานว่าว่างเมื่อไม่มีค่า", ()=>{
 assert.equal(mask(""),"(ว่าง)");
});

test("validateValue จับรูปแบบ token ผิด", ()=>{
 assert.equal(validateValue("DISCORD_TOKEN","a.b.c"),null);
 assert.ok(validateValue("DISCORD_TOKEN","not-a-token"));
});

test("validateValue จับ Discord ID ที่ไม่ใช่ตัวเลข", ()=>{
 assert.ok(validateValue("GUILD_ID","abc"));
 assert.equal(validateValue("GUILD_ID","123456789012345678"),null);
});

test("validateValue จับ PORT ที่ผิดช่วง", ()=>{
 assert.ok(validateValue("PORT","70000"));
 assert.equal(validateValue("PORT","3000"),null);
});

test("feature flag อ่านค่า true/false ได้และค่าเริ่มต้นถูกต้อง", ()=>{
 assert.equal(isEnabled("AI",{AI_ENABLED:"true"}),true);
 assert.equal(isEnabled("AI",{AI_ENABLED:"false"}),false);
 assert.equal(isEnabled("AI",{}),true);
 assert.equal(isEnabled("MUSIC",{}),false);
 assert.equal(listFeatures({}).length,13);
});

test("doctor รายงาน FAIL เมื่อไม่มี DISCORD_TOKEN", ()=>{
 const checks=runDoctor({});
 assert.equal(checks.find(c=>c.id==="env:DISCORD_TOKEN")?.state,"FAIL");
});

test("doctor รายงาน UNKNOWN สำหรับ voice เสมอ ไม่ใช่ PASS", ()=>{
 const checks=runDoctor({DISCORD_TOKEN:"a.b.c"});
 assert.equal(checks.find(c=>c.id==="runtime:voice")?.state,"UNKNOWN");
});

test("doctor รายงาน FAIL เมื่อรันบน GitHub Actions เพราะ disk ไม่ถาวร", ()=>{
 const checks=runDoctor({DISCORD_TOKEN:"a.b.c",GITHUB_ACTIONS:"true"});
 assert.equal(checks.find(c=>c.id==="runtime:persistence")?.state,"FAIL");
});

test("doctor รายงาน UNKNOWN เมื่อ AI เปิดแต่ไม่มี API key", ()=>{
 const checks=runDoctor({DISCORD_TOKEN:"a.b.c",AI_ENABLED:"true"});
 assert.equal(checks.find(c=>c.id==="ai:provider")?.state,"FAIL");
 const off=runDoctor({DISCORD_TOKEN:"a.b.c",AI_ENABLED:"false"});
 assert.equal(off.find(c=>c.id==="ai:provider")?.state,"UNKNOWN");
});

test("doctor ไม่มี internal secret ต้องเป็น WARN ไม่ใช่ FAIL", ()=>{
 const checks=runDoctor({DISCORD_TOKEN:"a.b.c"});
 assert.equal(checks.find(c=>c.id==="secret:internal")?.state,"WARN");
});

test("summarize นับผลรวมถูกต้อง", ()=>{
 const s=summarize(runDoctor({DISCORD_TOKEN:"a.b.c"}));
 assert.equal(Object.values(s).reduce((a,b)=>a+b,0),runDoctor({DISCORD_TOKEN:"a.b.c"}).length);
 assert.ok(s.FAIL>=0&&s.PASS>0);
});