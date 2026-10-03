import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoctor } from "../src/setup/doctor.js";
import { validateValue } from "../src/config/env.js";

const persistence=(env:Record<string,string>)=>
 runDoctor({DISCORD_TOKEN:"a.b.c",...env}).find(c=>c.id==="runtime:persistence")!;

test("บน GitHub Actions ยังเป็น FAIL ถ้ายังไม่ได้ประกาศว่ายอมรับ", ()=>{
 const c=persistence({GITHUB_ACTIONS:"true"});
 assert.equal(c.state,"FAIL");
 assert.match(c.detail,/ชั่วคราว/);
 assert.match(c.fix??"",/ACCEPT_EPHEMERAL_STORAGE/);
});

test("ตั้ง flag แล้วเป็น WARN พร้อมบอกว่ายอมรับ ไม่ใช่ PASS", ()=>{
 const c=persistence({GITHUB_ACTIONS:"true",ACCEPT_EPHEMERAL_STORAGE:"true"});
 assert.equal(c.state,"WARN","ต้องไม่เป็น PASS เพราะ disk ยังไม่ถาวรจริง");
 assert.match(c.detail,/ยอมรับไว้แล้ว/);
 assert.equal(c.fix,undefined);
});

test("flag ต้องเป็น true เท่านั้นที่ถือว่ายอมรับ", ()=>{
 assert.equal(persistence({GITHUB_ACTIONS:"true",ACCEPT_EPHEMERAL_STORAGE:"false"}).state,"FAIL");
 assert.equal(persistence({GITHUB_ACTIONS:"true",ACCEPT_EPHEMERAL_STORAGE:"1"}).state,"FAIL");
 assert.equal(persistence({GITHUB_ACTIONS:"true",ACCEPT_EPHEMERAL_STORAGE:"yes"}).state,"FAIL");
});

test("บนเครื่องที่ disk ถาวรไม่เกี่ยวกับ flag", ()=>{
 assert.equal(persistence({}).state,"PASS");
 assert.equal(persistence({ACCEPT_EPHEMERAL_STORAGE:"true"}).state,"PASS");
});

test("validate flag รับเฉพาะ true/false", ()=>{
 assert.equal(validateValue("ACCEPT_EPHEMERAL_STORAGE","true"),null);
 assert.equal(validateValue("ACCEPT_EPHEMERAL_STORAGE","false"),null);
 assert.match(validateValue("ACCEPT_EPHEMERAL_STORAGE","maybe")??"",/true หรือ false/);
});
